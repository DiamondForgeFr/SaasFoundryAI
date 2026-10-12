import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

import type { HarnessAgent } from '../harness/agent-registry'
import { readAgentSupport } from '../harness/agent-support'

/**
 * Facts about the instruction files the declared coding agents will load (#939).
 *
 * Since #937 AGENTS.md is the one instruction file, and three things quietly defeat it: a
 * CLAUDE.md that Claude Code reads instead, a Claude Code too old to read AGENTS.md at all,
 * and an AGENTS.md larger than Codex is willing to load. None of them fails loudly in the
 * host — the agent simply works without the project's rules.
 */
export interface InstructionDiagnostics {
  /** The effective agent declaration (shared and local), or undefined when it could not be read. */
  agents?: HarnessAgent[]
  /** Absolute paths of Claude-only instruction files in the project, its app directories or a parent. */
  shadowing: string[]
  /** Claude Code on PATH; absent when Claude Code is not declared. */
  claudeCode?: ClaudeCodeVersion
  /** What Codex loads for each directory holding an AGENTS.md; absent when Codex is not declared. */
  codexSizes?: CodexInstructionSize[]
}

export interface ClaudeCodeVersion {
  /** The parsed `x.y.z`, or undefined when `claude` is missing or printed no version. */
  version?: string
  /** Why no version was read. */
  reason?: string
}

export interface CodexInstructionSize {
  /** Directory, relative to the project root ('.' for the root). */
  directory: string
  /** Bytes of every AGENTS.md from the Git root down to `directory`, imports included. */
  bytes: number
  /** The files counted, relative to the project root. */
  files: string[]
}

/** First Claude Code release that reads AGENTS.md (#937). */
export const MIN_CLAUDE_CODE_VERSION = '2.1.277'
/** Codex's default `project_doc_max_bytes`: instructions past this are silently cut. */
export const CODEX_INSTRUCTION_LIMIT = 32 * 1024

const SHADOWING_FILES = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']
const VERSION_TIMEOUT_MS = 3000
/** Claude Code follows imports five hops deep; so does the count. */
const MAX_IMPORT_DEPTH = 5
const MAX_FILE_BYTES = 1024 * 1024

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const IMPORT = /(?:^|\s)@([^\s`]+)/g

export async function collectInstructionDiagnostics(projectRoot: string, appDirs: string[], gitRoot: string | null): Promise<InstructionDiagnostics> {
  const agents = await declaredAgents(projectRoot)
  if (!agents) return { shadowing: [] }
  const diagnostics: InstructionDiagnostics = { agents, shadowing: [] }
  if (agents.includes('claude-code')) {
    diagnostics.shadowing = findShadowingFiles(projectRoot, appDirs)
    diagnostics.claudeCode = await readClaudeCodeVersion(projectRoot)
  }
  if (agents.includes('codex')) diagnostics.codexSizes = measureCodexInstructions(projectRoot, appDirs, gitRoot)
  return diagnostics
}

/** The effective declaration, or undefined on a project with no instruction file to diagnose. */
async function declaredAgents(projectRoot: string): Promise<HarnessAgent[] | undefined> {
  try {
    return (await readAgentSupport(projectRoot)).configuredAgents
  } catch {
    return undefined
  }
}

/**
 * Claude Code reads a CLAUDE.md in the working directory or any parent in place of AGENTS.md,
 * so a single leftover file — or one in a directory above the checkout — hides every rule.
 */
export function findShadowingFiles(projectRoot: string, appDirs: string[]): string[] {
  const root = path.resolve(projectRoot)
  const dirs = [...appDirs.map((dir) => path.join(root, dir))]
  for (let dir = root; ; dir = path.dirname(dir)) {
    dirs.push(dir)
    if (path.dirname(dir) === dir) break
  }
  const found: string[] = []
  for (const dir of dirs) {
    for (const file of SHADOWING_FILES) {
      const candidate = path.join(dir, file)
      if (isFile(candidate)) found.push(candidate)
    }
  }
  return found
}

/**
 * Asked of the binary itself, locally: `claude --version` makes no network call. The path on
 * disk cannot be trusted for this — a terminal's launcher shim resolves to a file whose path
 * carries no version.
 */
export function readClaudeCodeVersion(cwd: string): Promise<ClaudeCodeVersion> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { cwd, env: process.env, timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code
        resolve({ reason: code === 'ENOENT' ? '`claude` not found on PATH' : '`claude --version` did not answer' })
        return
      }
      const version = /\b(\d+\.\d+\.\d+)\b/.exec(stdout)?.[1]
      resolve(version ? { version } : { reason: '`claude --version` printed no version' })
    })
  })
}

/** Negative, zero or positive as `a` is older than, equal to or newer than `b` (`x.y.z`). */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}

/**
 * What Codex loads when started in each directory holding an AGENTS.md: it concatenates the
 * AGENTS.md (or AGENTS.override.md) of every directory from the Git root down to the working
 * directory, and stops at `project_doc_max_bytes`.
 */
export function measureCodexInstructions(projectRoot: string, appDirs: string[], gitRoot: string | null): CodexInstructionSize[] {
  const root = path.resolve(projectRoot)
  const top = gitRoot && isWithin(root, path.resolve(gitRoot)) ? path.resolve(gitRoot) : root
  const sizes: CodexInstructionSize[] = []
  for (const dir of ['.', ...appDirs]) {
    const target = path.join(root, dir)
    if (!instructionFileIn(target)) continue
    const chain: string[] = []
    for (let current = target; ; current = path.dirname(current)) {
      const file = instructionFileIn(current)
      if (file) chain.unshift(file)
      if (current === top || path.dirname(current) === current) break
    }
    const counted = new Set<string>()
    for (const file of chain) collectImports(file, root, counted, 0)
    let bytes = 0
    for (const file of counted) bytes += fs.statSync(file).size
    sizes.push({ directory: dir, bytes, files: [...counted].map((file) => path.relative(root, file) || file) })
  }
  return sizes
}

function instructionFileIn(dir: string): string | undefined {
  return ['AGENTS.override.md', 'AGENTS.md'].map((name) => path.join(dir, name)).find(isFile)
}

/** Add `file` and, recursively, every `@path` it imports that stays inside the project. */
function collectImports(file: string, projectRoot: string, counted: Set<string>, depth: number): void {
  if (counted.has(file)) return
  counted.add(file)
  if (depth >= MAX_IMPORT_DEPTH || fs.statSync(file).size > MAX_FILE_BYTES) return
  for (const target of importsOf(fs.readFileSync(file, 'utf8'))) {
    const resolved = path.resolve(path.dirname(file), target)
    if (isWithin(resolved, projectRoot) && isFile(resolved)) collectImports(resolved, projectRoot, counted, depth + 1)
  }
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

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
