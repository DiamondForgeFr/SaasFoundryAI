import fs from 'fs'
import path from 'path'

/**
 * What Codex loads of the project instructions, and the limit it loads them under (#939, #1154).
 *
 * Codex concatenates the AGENTS.md (or AGENTS.override.md) of every directory from the Git root down
 * to its working directory and stops adding files once the combined size reaches
 * `project_doc_max_bytes` (32 KiB by default). `sf status` reports the chains that do not fit; the
 * harness refresh raises the project's `project_doc_max_bytes` in `.codex/config.toml` when a
 * declared Codex agent would otherwise lose the end of them.
 *
 * This module reads files only: it is shared by the status report and the instruction planner, and
 * imports neither.
 */

export interface CodexInstructionSize {
  /** Directory, relative to the project root ('.' for the root). */
  directory: string
  /** Bytes of every AGENTS.md from the Git root down to `directory`, imports included. */
  bytes: number
  /** The files counted, relative to the project root. */
  files: string[]
}

/** Codex's default `project_doc_max_bytes`: instructions past this are silently cut. */
export const CODEX_INSTRUCTION_LIMIT = 32 * 1024
/** The project-scoped Codex configuration, loaded by Codex only when it trusts the project. */
export const CODEX_CONFIG_PATH = '.codex/config.toml'
export const CODEX_DOC_LIMIT_KEY = 'project_doc_max_bytes'

/** Claude Code follows imports five hops deep; so does the count. */
const MAX_IMPORT_DEPTH = 5
/** Files above this size are skipped, never read. */
export const MAX_FILE_BYTES = 1024 * 1024
/** A raised limit is rounded up to this step, after the margin. */
const LIMIT_STEP = 16 * 1024
/** Room left above the largest chain, so the next few instruction edits still fit. */
const LIMIT_MARGIN = 1.25

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const IMPORT = /(?:^|\s)@([^\s`]+)/g

/** Content of files that are about to be written, by absolute path: measured in place of the disk. */
export type PendingFiles = ReadonlyMap<string, Buffer>

/** The directories that may hold their own AGENTS.md: a monorepo's apps, or a multirepo's app checkouts. */
export function instructionAppDirs(manifest: { structure?: string; projectName?: string } | null | undefined): string[] {
  if (!manifest || !manifest.structure || manifest.structure === 'cli') return []
  if (manifest.structure === 'monorepo') return [path.join('apps', 'api'), path.join('apps', 'web')]
  return [path.join('apps', `${manifest.projectName}-api`), path.join('apps', `${manifest.projectName}-web`)]
}

/** The nearest directory at or above `startDir` that holds a `.git` entry, or null. */
export function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * What Codex loads when started in each directory holding an AGENTS.md: it concatenates the
 * AGENTS.md (or AGENTS.override.md) of every directory from the Git root down to the working
 * directory, and stops at `project_doc_max_bytes`. `pending` files are measured as they will be
 * once written.
 */
export function measureCodexInstructions(projectRoot: string, appDirs: string[], gitRoot: string | null, pending: PendingFiles = new Map()): CodexInstructionSize[] {
  const files = new FileView(pending)
  const root = path.resolve(projectRoot)
  const top = gitRoot && isWithin(root, path.resolve(gitRoot)) ? path.resolve(gitRoot) : root
  const sizes: CodexInstructionSize[] = []
  for (const dir of ['.', ...appDirs]) {
    const target = path.join(root, dir)
    if (!files.instructionFileIn(target)) continue
    const chain: string[] = []
    for (let current = target; ; current = path.dirname(current)) {
      const file = files.instructionFileIn(current)
      if (file) chain.unshift(file)
      if (current === top || path.dirname(current) === current) break
    }
    const counted = new Set<string>()
    for (const file of chain) collectImports(files, file, root, counted, 0)
    let bytes = 0
    for (const file of counted) bytes += files.size(file)
    sizes.push({ directory: dir, bytes, files: [...counted].map((file) => path.relative(root, file) || file) })
  }
  return sizes
}

/** `@path` references outside fenced blocks and inline code, as Claude Code reads them. */
export function importsOf(content: string): string[] {
  const imports: string[] = []
  let fence: string | undefined
  for (const line of content.split('\n')) {
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      continue
    }
    if (fence) continue
    for (const match of line.replace(/`[^`]*`/g, '').matchAll(IMPORT)) imports.push(match[1].replace(/[.,;:!?)\]]+$/, ''))
  }
  return imports
}

/** The limit written for a chain of `bytes`: the margin added, rounded up to a 16 KiB step. */
export function codexDocLimitFor(bytes: number): number {
  return Math.ceil((bytes * LIMIT_MARGIN) / LIMIT_STEP) * LIMIT_STEP
}

const KEY_LINE = new RegExp(`^\\s*${CODEX_DOC_LIMIT_KEY}\\s*=`)
const VALUE_LINE = new RegExp(`^(\\s*${CODEX_DOC_LIMIT_KEY}\\s*=\\s*)([0-9][0-9_]*)(\\s*(?:#.*)?)$`)
const TABLE_HEADER = /^\s*\[/

/**
 * The top-level `project_doc_max_bytes` of a Codex `config.toml`. `undefined` when the key is absent
 * from the root table, `NaN` when it is there but not an integer this reader can rewrite.
 */
export function readCodexDocLimit(toml: string): number | undefined {
  const line = rootKeyLine(toml.split('\n'))
  if (line === undefined) return undefined
  const value = VALUE_LINE.exec(line.text)?.[2]
  return value === undefined ? NaN : Number(value.replace(/_/g, ''))
}

/**
 * `toml` with its top-level `project_doc_max_bytes` set to `bytes`, every other line kept as it is.
 * The key is added to the root table (before the first table header) when absent.
 */
export function withCodexDocLimit(toml: string | undefined, bytes: number): { content: string } | { error: string } {
  const comment = `# Raised by SaaSFoundry: the AGENTS.md files Codex loads exceed its ${CODEX_INSTRUCTION_LIMIT / 1024} KiB default.`
  const entry = `${CODEX_DOC_LIMIT_KEY} = ${bytes}`
  if (toml === undefined || toml.trim() === '') return { content: `${comment}\n${entry}\n` }
  const lines = toml.split('\n')
  const existing = rootKeyLine(lines)
  if (existing) {
    const match = VALUE_LINE.exec(existing.text)
    if (!match) return { error: `${CODEX_CONFIG_PATH}: ${CODEX_DOC_LIMIT_KEY} is not a plain integer and was left as it is` }
    lines[existing.index] = `${match[1]}${bytes}${match[3]}`
    return { content: lines.join('\n') }
  }
  const header = firstTableHeader(lines)
  if (header === undefined) {
    const body = toml.endsWith('\n') ? toml : `${toml}\n`
    return { content: `${body}\n${comment}\n${entry}\n` }
  }
  lines.splice(header, 0, comment, entry, '')
  return { content: lines.join('\n') }
}

export interface CodexDocLimitChange {
  /** The full `.codex/config.toml` to write. */
  content: string
  /** The value the file held before, if any. */
  from?: number
  /** The value written. */
  to: number
  /** The longest chain, the one the new limit covers. */
  largest: CodexInstructionSize
}

/**
 * What `.codex/config.toml` needs for Codex to load the longest chain in `sizes`, or undefined when
 * every chain fits the limit the file already sets (or the default). A value already larger than what
 * the chain needs is never lowered: it is the project's own choice.
 */
export function planCodexDocLimit(sizes: CodexInstructionSize[], toml: string | undefined): CodexDocLimitChange | { error: string } | undefined {
  const largest = sizes.reduce<CodexInstructionSize | undefined>((max, size) => (!max || size.bytes > max.bytes ? size : max), undefined)
  if (!largest) return undefined
  const current = toml === undefined ? undefined : readCodexDocLimit(toml)
  if (current !== undefined && Number.isNaN(current)) return { error: `${CODEX_CONFIG_PATH}: ${CODEX_DOC_LIMIT_KEY} is not a plain integer and was left as it is` }
  if (largest.bytes <= (current ?? CODEX_INSTRUCTION_LIMIT)) return undefined
  const to = codexDocLimitFor(largest.bytes)
  const rendered = withCodexDocLimit(toml, to)
  if ('error' in rendered) return rendered
  return { content: rendered.content, ...(current !== undefined ? { from: current } : {}), to, largest }
}

/** The limit `.codex/config.toml` sets at `projectRoot`, or undefined when it sets none (or is unreadable). */
export function readProjectCodexDocLimit(projectRoot: string): number | undefined {
  try {
    const limit = readCodexDocLimit(fs.readFileSync(path.join(projectRoot, CODEX_CONFIG_PATH), 'utf8'))
    return limit === undefined || Number.isNaN(limit) ? undefined : limit
  } catch {
    return undefined
  }
}

/** The root table ends at the first table header; multi-line strings are skipped. */
function rootKeyLine(lines: string[]): { index: number; text: string } | undefined {
  const end = firstTableHeader(lines) ?? lines.length
  let inString = false
  for (let index = 0; index < end; index++) {
    const text = lines[index]
    if (!inString && KEY_LINE.test(text)) return { index, text }
    if (multilineDelimiters(text) % 2 === 1) inString = !inString
  }
  return undefined
}

function firstTableHeader(lines: string[]): number | undefined {
  let inString = false
  for (let index = 0; index < lines.length; index++) {
    if (!inString && TABLE_HEADER.test(lines[index])) return index
    if (multilineDelimiters(lines[index]) % 2 === 1) inString = !inString
  }
  return undefined
}

function multilineDelimiters(line: string): number {
  return (line.match(/"""|'''/g) ?? []).length
}

/** The disk, with the files about to be written read from memory. */
class FileView {
  constructor(private readonly pending: PendingFiles) {}

  isFile(candidate: string): boolean {
    if (this.pending.has(candidate)) return true
    try {
      return fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  }

  size(file: string): number {
    return this.pending.get(file)?.length ?? fs.statSync(file).size
  }

  read(file: string): string {
    return this.pending.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8')
  }

  instructionFileIn(dir: string): string | undefined {
    return ['AGENTS.override.md', 'AGENTS.md'].map((name) => path.join(dir, name)).find((candidate) => this.isFile(candidate))
  }
}

/** Add `file` and, recursively, every `@path` it imports that stays inside the project. */
function collectImports(files: FileView, file: string, projectRoot: string, counted: Set<string>, depth: number): void {
  if (counted.has(file)) return
  counted.add(file)
  if (depth >= MAX_IMPORT_DEPTH || files.size(file) > MAX_FILE_BYTES) return
  for (const target of importsOf(files.read(file))) {
    const resolved = path.resolve(path.dirname(file), target)
    if (isWithin(resolved, projectRoot) && files.isFile(resolved)) collectImports(files, resolved, projectRoot, counted, depth + 1)
  }
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
