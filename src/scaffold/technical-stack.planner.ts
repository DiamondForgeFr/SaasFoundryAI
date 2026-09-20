import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export type TechnicalStackPathAction = 'add' | 'compatible' | 'conflict' | 'unsupported'

export type TechnicalStackPathReason =
  | 'different-content'
  | 'incompatible-mode'
  | 'leaf-type-mismatch'
  | 'unsafe-candidate-path'
  | 'unsafe-candidate-type'
  | 'unsafe-candidate-hardlink'
  | 'unsafe-existing-type'
  | 'unsafe-existing-hardlink'
  | 'ancestor-not-directory'
  | 'case-alias'
  | 'overlapping-roots'

export interface TechnicalStackPathSnapshot {
  sha256: string
  size: number
  mode: number
}

export interface TechnicalStackPlanEntry {
  /** Project-root-relative POSIX path. */
  path: string
  action: TechnicalStackPathAction
  reason?: TechnicalStackPathReason
  candidate?: TechnicalStackPathSnapshot
  current?: TechnicalStackPathSnapshot
}

export interface TechnicalStackAdoptionPlan {
  version: 1
  entries: TechnicalStackPlanEntry[]
  summary: Record<TechnicalStackPathAction, number>
  canApply: boolean
  /** Stable digest of the normalized, sorted plan; excludes absolute host paths. */
  fingerprint: string
}

export interface TechnicalStackDryRunReport {
  version: 1
  mutated: false
  topology: 'monorepo' | 'multirepo'
  canApply: boolean
  summary: Record<TechnicalStackPathAction, number>
  paths: Array<Pick<TechnicalStackPlanEntry, 'path' | 'action' | 'reason'>>
}

export interface PlanTechnicalStackAdoptionOptions {
  projectRoot: string
  candidateRoot: string
  /** Exact paths or directory prefixes omitted from the technical candidate. */
  excludedPaths?: string[]
}

interface CandidateFile {
  path: string
  snapshot: TechnicalStackPathSnapshot
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_FORBIDDEN = /[<>:"|?*\u0000-\u001f]/

export const DEFAULT_TECHNICAL_ADOPTION_EXCLUSIONS = [
  '.git',
  '.saasfoundry.json',
  '.saasfoundry-transition.lock',
  '.saasfoundry-transition.recovery.lock',
  '.saasfoundry-transition.journal.json',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.claude',
  '.agents',
  '.codex',
  '.gemini',
  '.qwen'
] as const

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function foldPath(path: string): string {
  return path.normalize('NFKC').toLowerCase()
}

/** Reject paths whose meaning changes across POSIX and Windows hosts. */
export function normalizePortableRelativePath(input: string): string {
  if (!input || input.includes('\\') || input.startsWith('/') || /^[a-zA-Z]:/.test(input) || input.startsWith('//')) throw new Error(`Unsafe relative path: ${input}`)
  const parts = input.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || WINDOWS_FORBIDDEN.test(part) || WINDOWS_RESERVED.test(part))) {
    throw new Error(`Unsafe relative path: ${input}`)
  }
  return parts.join('/')
}

function isExcluded(path: string, exclusions: string[]): boolean {
  return exclusions.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))
}

async function readRegularFile(path: string): Promise<{ content: Buffer; snapshot: TechnicalStackPathSnapshot; identity: { dev: number; ino: number; nlink: number } }> {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('unsafe-type')
  if (before.nlink > 1) throw new Error('unsafe-hardlink')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const content = await handle.readFile()
    const after = await lstat(path)
    if (!after.isFile() || after.isSymbolicLink() || after.nlink > 1 || opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error('unsafe-type')
    }
    return {
      content,
      snapshot: { sha256: sha256(content), size: content.length, mode: opened.mode & 0o777 },
      identity: { dev: opened.dev, ino: opened.ino, nlink: opened.nlink }
    }
  } finally {
    await handle.close()
  }
}

async function inspectRoot(path: string): Promise<string> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe project root: ${path}`)
  return realpath(path)
}

async function inventoryCandidate(root: string, exclusions: string[]): Promise<{ files: CandidateFile[]; unsupported: TechnicalStackPlanEntry[] }> {
  const files: CandidateFile[] = []
  const unsupported: TechnicalStackPlanEntry[] = []

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
    for (const entry of entries) {
      const rawPath = prefix ? `${prefix}/${entry.name}` : entry.name
      let path: string
      try {
        path = normalizePortableRelativePath(rawPath)
      } catch {
        unsupported.push({ path: rawPath.split(sep).join('/'), action: 'unsupported', reason: 'unsafe-candidate-path' })
        continue
      }
      if (isExcluded(path, exclusions)) continue
      const absolute = join(root, ...path.split('/'))
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        unsupported.push({ path, action: 'unsupported', reason: 'unsafe-candidate-type' })
      } else if (stat.isDirectory()) {
        await walk(absolute, path)
      } else if (stat.nlink > 1) {
        unsupported.push({ path, action: 'unsupported', reason: 'unsafe-candidate-hardlink' })
      } else {
        try {
          const { snapshot } = await readRegularFile(absolute)
          files.push({ path, snapshot })
        } catch (error) {
          unsupported.push({ path, action: 'unsupported', reason: error instanceof Error && error.message === 'unsafe-hardlink' ? 'unsafe-candidate-hardlink' : 'unsafe-candidate-type' })
        }
      }
    }
  }

  await walk(root, '')
  return { files, unsupported }
}

async function findCaseAlias(parent: string, segment: string, cache: Map<string, Map<string, string[]>>): Promise<string | undefined> {
  const expected = foldPath(segment)
  let folded = cache.get(parent)
  if (!folded) {
    folded = new Map<string, string[]>()
    for (const entry of await readdir(parent)) folded.set(foldPath(entry), [...(folded.get(foldPath(entry)) ?? []), entry])
    cache.set(parent, folded)
  }
  return folded.get(expected)?.find((entry) => entry !== segment)
}

async function classifyLivePath(projectRoot: string, file: CandidateFile, directoryCache: Map<string, Map<string, string[]>>): Promise<TechnicalStackPlanEntry> {
  const segments = file.path.split('/')
  let parent = projectRoot

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const alias = await findCaseAlias(parent, segment, directoryCache)
    if (alias) return { path: file.path, action: 'unsupported', reason: 'case-alias', candidate: file.snapshot }

    const absolute = join(parent, segment)
    const current = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const leaf = index === segments.length - 1
    if (!current) return { path: file.path, action: 'add', candidate: file.snapshot }
    if (!leaf) {
      if (!current.isDirectory() || current.isSymbolicLink()) return { path: file.path, action: 'unsupported', reason: 'ancestor-not-directory', candidate: file.snapshot }
      parent = absolute
      continue
    }
    if (current.isDirectory() && !current.isSymbolicLink()) return { path: file.path, action: 'conflict', reason: 'leaf-type-mismatch', candidate: file.snapshot }
    if (!current.isFile() || current.isSymbolicLink()) return { path: file.path, action: 'unsupported', reason: 'unsafe-existing-type', candidate: file.snapshot }
    if (current.nlink > 1) return { path: file.path, action: 'unsupported', reason: 'unsafe-existing-hardlink', candidate: file.snapshot }

    try {
      const { snapshot } = await readRegularFile(absolute)
      if (snapshot.sha256 === file.snapshot.sha256 && snapshot.size === file.snapshot.size && Boolean(snapshot.mode & 0o111) === Boolean(file.snapshot.mode & 0o111)) {
        return { path: file.path, action: 'compatible', candidate: file.snapshot, current: snapshot }
      }
      return {
        path: file.path,
        action: 'conflict',
        reason: snapshot.sha256 === file.snapshot.sha256 && snapshot.size === file.snapshot.size ? 'incompatible-mode' : 'different-content',
        candidate: file.snapshot,
        current: snapshot
      }
    } catch (error) {
      return {
        path: file.path,
        action: 'unsupported',
        reason: error instanceof Error && error.message === 'unsafe-hardlink' ? 'unsafe-existing-hardlink' : 'unsafe-existing-type',
        candidate: file.snapshot
      }
    }
  }

  return { path: file.path, action: 'unsupported', reason: 'unsafe-existing-type', candidate: file.snapshot }
}

function markCandidateCaseAliases(entries: TechnicalStackPlanEntry[]): void {
  const prefixes = new Map<string, Set<string>>()
  for (const entry of entries) {
    const segments = entry.path.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index + 1).join('/')
      const variants = prefixes.get(foldPath(prefix)) ?? new Set<string>()
      variants.add(prefix)
      prefixes.set(foldPath(prefix), variants)
    }
  }
  for (const variants of prefixes.values()) {
    if (variants.size < 2) continue
    for (const entry of entries.filter(({ path }) => [...variants].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))) {
      entry.action = 'unsupported'
      entry.reason = 'case-alias'
      delete entry.current
    }
  }
}

function finalize(entries: TechnicalStackPlanEntry[]): TechnicalStackAdoptionPlan {
  entries.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
  const summary: Record<TechnicalStackPathAction, number> = { add: 0, compatible: 0, conflict: 0, unsupported: 0 }
  for (const entry of entries) summary[entry.action] += 1
  const serialized = JSON.stringify({ version: 1, entries, summary })
  return {
    version: 1,
    entries,
    summary,
    canApply: summary.conflict === 0 && summary.unsupported === 0,
    fingerprint: sha256(Buffer.from(serialized))
  }
}

/** Build a deterministic, read-only initial-adoption plan. */
export async function planTechnicalStackAdoption({
  projectRoot,
  candidateRoot,
  excludedPaths = [...DEFAULT_TECHNICAL_ADOPTION_EXCLUSIONS]
}: PlanTechnicalStackAdoptionOptions): Promise<TechnicalStackAdoptionPlan> {
  const project = resolve(projectRoot)
  const candidate = resolve(candidateRoot)
  const [projectReal, candidateReal] = await Promise.all([inspectRoot(project), inspectRoot(candidate)])
  const projectToCandidate = relative(projectReal, candidateReal)
  const candidateToProject = relative(candidateReal, projectReal)
  const nested = (path: string) => path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  if (nested(projectToCandidate) || nested(candidateToProject)) {
    return finalize([{ path: '.', action: 'unsupported', reason: 'overlapping-roots' }])
  }

  const exclusions = excludedPaths.map(normalizePortableRelativePath).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
  const { files, unsupported } = await inventoryCandidate(candidate, exclusions)
  const classified: TechnicalStackPlanEntry[] = [...unsupported]
  const directoryCache = new Map<string, Map<string, string[]>>()
  for (const file of files) classified.push(await classifyLivePath(project, file, directoryCache))
  markCandidateCaseAliases(classified)
  return finalize(classified)
}

/** Only newly created paths become SaaSFoundry-owned during initial adoption. */
export function technicalOwnershipHashes(plan: TechnicalStackAdoptionPlan): Record<string, string> {
  const ignoredSegments = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.env', '.env.test', 'package-lock.json', '.saasfoundry.json', '.DS_Store'])
  return Object.fromEntries(
    plan.entries
      .filter((entry) => entry.action === 'add' && entry.candidate)
      .filter((entry) => !entry.path.split('/').some((segment) => ignoredSegments.has(segment) || segment.endsWith('.saasfoundry.new')))
      .map((entry) => [entry.path, entry.candidate!.sha256])
  )
}

/** Public preview projection: deterministic paths and actions, never bytes or hashes. */
export function technicalStackDryRunReport(plan: TechnicalStackAdoptionPlan, topology: 'monorepo' | 'multirepo'): TechnicalStackDryRunReport {
  return {
    version: 1,
    mutated: false,
    topology,
    canApply: plan.canApply,
    summary: { ...plan.summary },
    paths: plan.entries.map(({ path, action, reason }) => ({ path, action, ...(reason ? { reason } : {}) }))
  }
}
