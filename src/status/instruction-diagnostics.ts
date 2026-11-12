import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

import type { HarnessAgent } from '../harness/agent-registry'
import { readAgentSupport } from '../harness/agent-support'
import { MAX_FILE_BYTES, measureCodexInstructions, readProjectCodexDocLimit, type CodexInstructionSize } from '../harness/codex-instruction-size'
import { findClaudeMdReferences, isMigrationMarker, resolveClaudeMdReference } from '../harness/instruction-references'

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
  /** The `project_doc_max_bytes` the project's `.codex/config.toml` sets; absent when it sets none (#1154). */
  codexLimit?: number
  /** Mentions in an AGENTS.md of a CLAUDE.md that is not there (#1152); absent when the declaration could not be read. */
  staleReferences?: StaleInstructionReference[]
}

export interface StaleInstructionReference {
  /** The AGENTS.md that holds the mention, relative to the project root. */
  file: string
  line: number
  /** The path as written in the file. */
  reference: string
  /** The file it names, relative to the project root. */
  target: string
}

export interface ClaudeCodeVersion {
  /** The parsed `x.y.z`, or undefined when `claude` is missing or printed no version. */
  version?: string
  /** Why no version was read. */
  reason?: string
}

// The measurement is shared with the harness refresh, which raises the limit (#1154).
export { CODEX_INSTRUCTION_LIMIT, importsOf, measureCodexInstructions } from '../harness/codex-instruction-size'
export type { CodexInstructionSize } from '../harness/codex-instruction-size'

/** First Claude Code release that reads AGENTS.md (#937). */
export const MIN_CLAUDE_CODE_VERSION = '2.1.277'

const SHADOWING_FILES = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']
const VERSION_TIMEOUT_MS = 3000

export async function collectInstructionDiagnostics(projectRoot: string, appDirs: string[], gitRoot: string | null): Promise<InstructionDiagnostics> {
  const agents = await declaredAgents(projectRoot)
  if (!agents) return { shadowing: [] }
  const diagnostics: InstructionDiagnostics = { agents, shadowing: [] }
  if (agents.includes('claude-code')) {
    diagnostics.shadowing = findShadowingFiles(projectRoot, appDirs)
    diagnostics.claudeCode = await readClaudeCodeVersion(projectRoot)
  }
  if (agents.includes('codex')) {
    diagnostics.codexSizes = measureCodexInstructions(projectRoot, appDirs, gitRoot)
    const limit = readProjectCodexDocLimit(projectRoot)
    if (limit !== undefined) diagnostics.codexLimit = limit
  }
  diagnostics.staleReferences = findStaleClaudeMdReferences(projectRoot, appDirs)
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
 * The AGENTS.md of the project and of each app that names a CLAUDE.md the project does not hold (#1152).
 * The v3 → v4 migration deletes the CLAUDE.md files and, until it rewrote the references in the sections it
 * moved, left lines such as `apps/api/CLAUDE.md` behind; a project migrated by that release still has them.
 * The mentions the migration writes itself, to say where a block came from, are not references.
 */
export function findStaleClaudeMdReferences(projectRoot: string, appDirs: string[]): StaleInstructionReference[] {
  const root = path.resolve(projectRoot)
  const stale: StaleInstructionReference[] = []
  for (const dir of ['', ...appDirs]) {
    const file = dir ? `${dir}/AGENTS.md` : 'AGENTS.md'
    const absolute = path.join(root, file)
    if (!isFile(absolute) || fs.statSync(absolute).size > MAX_FILE_BYTES) continue
    const lines = fs.readFileSync(absolute, 'utf8').split('\n')
    lines.forEach((text, index) => {
      if (isMigrationMarker(text)) return
      for (const reference of findClaudeMdReferences(text)) {
        const target = resolveClaudeMdReference(dir, reference)
        if (target !== undefined && !isFile(path.join(root, target))) stale.push({ file, line: index + 1, reference: reference.text, target })
      }
    })
  }
  return stale
}

/**
 * Asked of the binary itself, locally: `claude --version` makes no network call. The path on
 * disk cannot be trusted for this — a terminal's launcher shim resolves to a file whose path
 * carries no version. The probe is bounded by `timeoutMs`; the tests pass their own, because a
 * stub that answers in milliseconds idle can take seconds to start on a loaded machine (#1171).
 */
export function readClaudeCodeVersion(cwd: string, timeoutMs: number = VERSION_TIMEOUT_MS): Promise<ClaudeCodeVersion> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { cwd, env: process.env, timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => {
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

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Semver precedence of two prerelease tags: numeric identifiers by value and before the others, a longer tag after its prefix. */
function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  // A release outranks every prerelease of the same version.
  if (a === undefined) return 1
  if (b === undefined) return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue
    const leftNumeric = /^\d+$/.test(left[i])
    const rightNumeric = /^\d+$/.test(right[i])
    if (leftNumeric && rightNumeric) return Number(left[i]) - Number(right[i])
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left[i] < right[i] ? -1 : 1
  }
  return left.length - right.length
}

/**
 * Negative, zero or positive as CLI version `a` is older than, equal to or newer than `b`, or
 * undefined when either is not a semver string. Unlike `compareVersions`, it reads a prerelease
 * (`1.1.0-rc.1` is older than `1.1.0`) instead of returning NaN: a CLI version is whatever the
 * package or a release candidate carries.
 */
export function compareCliVersions(a: string, b: string): number | undefined {
  const left = SEMVER.exec(a.trim())
  const right = SEMVER.exec(b.trim())
  if (!left || !right) return undefined
  for (let i = 1; i <= 3; i++) {
    const difference = Number(left[i]) - Number(right[i])
    if (difference !== 0) return difference
  }
  return comparePrerelease(left[4], right[4])
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}
