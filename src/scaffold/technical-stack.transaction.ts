import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, readFile, rename, rmdir, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  normalizePortableRelativePath,
  planTechnicalStackAdoption,
  sha256,
  technicalOwnershipHashes,
  type TechnicalStackAdoptionPlan,
  type TechnicalStackPathSnapshot
} from './technical-stack.planner'
import { runManifestMigrations } from '../migrations/manifest/registry'
import type { SaaSFoundryManifest } from '../types'
import { inspectGitAgentScope, NotGitRepositoryError } from '../harness/git-agent-scope'

export const TECHNICAL_TRANSITION_LOCK = '.saasfoundry-transition.lock'
export const TECHNICAL_TRANSITION_RECOVERY_LOCK = '.saasfoundry-transition.recovery.lock'
export const TECHNICAL_TRANSITION_JOURNAL = '.saasfoundry-transition.journal.json'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface FileIdentity {
  dev: string
  ino: string
}

interface AncestorIdentity extends FileIdentity {
  path: string
}

interface CreatedEntry extends FileIdentity {
  path: string
  sha256?: string
  temporaryPath?: string
  recordPath?: string
  ancestors?: AncestorIdentity[]
}

interface PendingEntry {
  kind: 'file' | 'directory'
  path: string
  sha256?: string
  temporaryPath?: string
  temporaryIdentity?: FileIdentity
  recordPath?: string
}

interface TransitionJournal {
  version: 1
  sequence: number
  transactionId: string
  planFingerprint: string
  state: 'applying' | 'committing' | 'committed' | 'rollback-needed'
  root: FileIdentity
  manifest: {
    path: string
    beforeSha256: string
    afterSha256: string
    temporaryPath?: string
    temporaryIdentity?: FileIdentity
  }
  createdFiles: CreatedEntry[]
  createdDirectories: CreatedEntry[]
  protectedDirectories?: AncestorIdentity[]
  plannedFiles?: PendingEntry[]
  plannedDirectories?: PendingEntry[]
  pending?: PendingEntry
  unresolved?: string[]
}

export type TechnicalStackFailurePhase = 'after-lock' | 'after-journal' | 'after-directory' | 'after-file' | 'before-manifest' | 'after-manifest'

export interface ApplyTechnicalStackTransitionOptions {
  projectRoot: string
  candidateRoot: string
  approvedPlan: TechnicalStackAdoptionPlan
  expectedManifest: Buffer
  nextManifest: Buffer
  manifestPath?: string
  excludedPaths?: string[]
  onPhase?: (phase: TechnicalStackFailurePhase, path?: string) => void | Promise<void>
}

export interface TechnicalStackTransitionResult {
  mutated: boolean
  created: string[]
  compatible: string[]
  manifestSha256: string
  recoveredCommittedTransaction: boolean
}

export interface TechnicalStackRecoveryResult {
  status: 'none' | 'rolled-back' | 'committed'
  unresolved: string[]
}

export class TechnicalStackRecoveryError extends Error {
  constructor(readonly unresolved: string[]) {
    super(`Technical stack recovery requires manual inspection: ${unresolved.join(', ')}`)
    this.name = 'TechnicalStackRecoveryError'
  }
}

function identity(stat: { dev: bigint | number; ino: bigint | number }): FileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino) }
}

function sameIdentity(left: FileIdentity, right: { dev: bigint | number; ino: bigint | number }): boolean {
  return left.dev === String(right.dev) && left.ino === String(right.ino)
}

async function statRoot(root: string): Promise<FileIdentity> {
  const stat = await lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The project root must be a real directory, not a link.')
  return identity(stat)
}

async function assertRoot(root: string, expected: FileIdentity): Promise<void> {
  const stat = await lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(expected, stat)) throw new Error('The project root changed during the technical stack transaction.')
}

function absolutePath(root: string, relativePath: string): string {
  const normalized = normalizePortableRelativePath(relativePath)
  return join(root, ...normalized.split('/'))
}

async function captureAncestors(root: string, relativePath: string, expectedRoot?: FileIdentity): Promise<AncestorIdentity[]> {
  if (expectedRoot) await assertRoot(root, expectedRoot)
  const segments = normalizePortableRelativePath(relativePath).split('/').slice(0, -1)
  const result: AncestorIdentity[] = []
  for (let index = 1; index <= segments.length; index += 1) {
    const path = segments.slice(0, index).join('/')
    const stat = await lstat(absolutePath(root, path), { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe technical stack ancestor: ${path}`)
    result.push({ path, ...identity(stat) })
  }
  if (expectedRoot) await assertRoot(root, expectedRoot)
  return result
}

async function ancestorsMatch(root: string, relativePath: string, expected: AncestorIdentity[] | undefined, rootIdentity: FileIdentity): Promise<boolean> {
  if (!expected) return false
  try {
    const current = await captureAncestors(root, relativePath, rootIdentity)
    return current.length === expected.length && current.every((entry, index) => entry.path === expected[index].path && entry.dev === expected[index].dev && entry.ino === expected[index].ino)
  } catch {
    return false
  }
}

async function safeUnrecordedPath(root: string, relativePath: string, rootIdentity: FileIdentity): Promise<Awaited<ReturnType<typeof lstat>> | undefined | null> {
  try {
    await assertRoot(root, rootIdentity)
    const segments = normalizePortableRelativePath(relativePath).split('/')
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = await lstat(absolutePath(root, segments.slice(0, index).join('/'))).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!ancestor) return undefined
      if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) return null
    }
    return await lstat(absolutePath(root, relativePath)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
  } catch {
    return null
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeExclusive(path: string, content: Buffer, mode: number): Promise<FileIdentity> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode)
  try {
    let offset = 0
    while (offset < content.length) {
      const { bytesWritten } = await handle.write(content, offset, content.length - offset, offset)
      if (bytesWritten === 0) throw new Error(`Writing stopped before completion: ${path}`)
      offset += bytesWritten
    }
    await handle.truncate(content.length)
    await handle.chmod(mode)
    await handle.sync()
    const stat = await handle.stat({ bigint: true })
    return identity(stat)
  } finally {
    await handle.close()
  }
}

async function replaceJournal(projectRoot: string, journal: TransitionJournal, firstWrite = false): Promise<void> {
  const journalPath = join(projectRoot, TECHNICAL_TRANSITION_JOURNAL)
  if (firstWrite) {
    await writeExclusive(journalPath, Buffer.from(`${JSON.stringify({ ...journal, createdFiles: [] }, null, 2)}\n`), 0o600)
  } else {
    journal.sequence += 1
    const temporary = `${journalPath}.${journal.transactionId}.tmp`
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    const updated = Buffer.from(`${JSON.stringify({ ...journal, createdFiles: [] }, null, 2)}\n`)
    await writeExclusive(temporary, updated, 0o600)
    await rename(temporary, journalPath)
  }
  await syncDirectory(projectRoot)
}

function createdRecordName(transactionId: string, kind: 'file' | 'directory', index: number): string {
  return `.saasfoundry-transition.${transactionId}.${kind}-${index}.created.json`
}

async function writeCreatedRecord(projectRoot: string, journal: TransitionJournal, entry: CreatedEntry): Promise<void> {
  if (!entry.recordPath) throw new Error(`Missing recovery record path for ${entry.path}`)
  const bytes = Buffer.from(`${JSON.stringify({ version: 1, transactionId: journal.transactionId, entry })}\n`)
  await writeExclusive(absolutePath(projectRoot, entry.recordPath), bytes, 0o600)
  await syncDirectory(projectRoot)
}

async function loadCreatedRecords(projectRoot: string, journal: TransitionJournal): Promise<void> {
  const prefix = `.saasfoundry-transition.${journal.transactionId}.`
  const suffix = '.created.json'
  const files: CreatedEntry[] = []
  const directories: CreatedEntry[] = []
  const planned = new Map([...(journal.plannedFiles ?? []), ...(journal.plannedDirectories ?? [])].filter((entry) => entry.recordPath).map((entry) => [entry.recordPath!, entry]))
  for (const name of await readdir(projectRoot)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
    const current = await currentFile(join(projectRoot, name))
    if (!current) continue
    const parsed = JSON.parse(current.bytes.toString('utf8')) as { version?: number; transactionId?: string; entry?: CreatedEntry }
    const intent = planned.get(name)
    if (
      parsed.version !== 1 ||
      parsed.transactionId !== journal.transactionId ||
      !parsed.entry ||
      parsed.entry.recordPath !== name ||
      !intent ||
      parsed.entry.path !== intent.path ||
      parsed.entry.temporaryPath !== intent.temporaryPath ||
      parsed.entry.sha256 !== intent.sha256
    ) {
      throw new Error(`Damaged technical transition recovery record: ${name}`)
    }
    normalizePortableRelativePath(parsed.entry.path)
    if (parsed.entry.temporaryPath) normalizePortableRelativePath(parsed.entry.temporaryPath)
    if (intent.kind === 'directory') directories.push(parsed.entry)
    else files.push(parsed.entry)
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  directories.sort((left, right) => left.path.localeCompare(right.path))
  journal.createdFiles = files
  journal.createdDirectories = directories
}

async function removeCreatedRecords(projectRoot: string, journal: TransitionJournal): Promise<void> {
  for (const entry of [...journal.createdFiles, ...journal.createdDirectories]) {
    if (!entry.recordPath) continue
    const path = absolutePath(projectRoot, entry.recordPath)
    const record = await currentFile(path)
    if (!record) continue
    const parsed = JSON.parse(record.bytes.toString('utf8')) as { transactionId?: string; entry?: CreatedEntry }
    if (parsed.transactionId !== journal.transactionId || parsed.entry?.path !== entry.path || parsed.entry?.dev !== entry.dev || parsed.entry?.ino !== entry.ino) {
      throw new TechnicalStackRecoveryError([entry.recordPath])
    }
    await unlink(path)
  }
  await syncDirectory(projectRoot)
}

async function readJournal(projectRoot: string): Promise<TransitionJournal | undefined> {
  const path = join(projectRoot, TECHNICAL_TRANSITION_JOURNAL)
  const main = await currentFile(path)
  if (!main) return undefined
  let journal = JSON.parse(main.bytes.toString('utf8')) as TransitionJournal
  if (journal.version !== 1 || !Number.isSafeInteger(journal.sequence) || !UUID.test(journal.transactionId) || !journal.manifest?.path) {
    throw new Error('Unsupported or damaged technical transition journal.')
  }
  const temporaryPath = `${path}.${journal.transactionId}.tmp`
  const temporary = await currentFile(temporaryPath)
  if (temporary) {
    const candidate = JSON.parse(temporary.bytes.toString('utf8')) as TransitionJournal
    if (candidate.version !== 1 || candidate.transactionId !== journal.transactionId || candidate.sequence !== journal.sequence + 1) {
      throw new Error('Damaged technical transition journal update requires inspection.')
    }
    await rename(temporaryPath, path)
    await syncDirectory(projectRoot)
    journal = candidate
  }
  await loadCreatedRecords(projectRoot, journal)
  return journal
}

async function currentFile(path: string): Promise<{ bytes: Buffer; stat: Awaited<ReturnType<typeof lstat>> } | undefined> {
  const before = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!before) return undefined
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) throw new Error(`Unsafe regular file: ${path}`)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const bytes = await handle.readFile()
    const after = await lstat(path)
    if (!after.isFile() || after.isSymbolicLink() || after.nlink > 1 || opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error(`Unsafe regular file: ${path}`)
    }
    return { bytes, stat: opened as Awaited<ReturnType<typeof lstat>> }
  } finally {
    await handle.close()
  }
}

interface LockMetadata {
  version: 1
  pid: number
  hostname: string
  createdAt: string
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function removeDeadOwnerLock(projectRoot: string): Promise<void> {
  const lockPath = join(projectRoot, TECHNICAL_TRANSITION_LOCK)
  const recoveryPath = join(projectRoot, TECHNICAL_TRANSITION_RECOVERY_LOCK)
  let recovery
  try {
    recovery = await open(recoveryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Technical transition recovery is already in progress or ${TECHNICAL_TRANSITION_RECOVERY_LOCK} requires inspection.`)
    throw error
  }

  try {
    const before = await lstat(lockPath, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error('The technical transition lock is not a safe regular file; inspect it manually.')
    const bytes = await readFile(lockPath)
    let metadata: LockMetadata
    try {
      metadata = JSON.parse(bytes.toString('utf8')) as LockMetadata
    } catch {
      throw new Error('The technical transition lock metadata is damaged; inspect it manually.')
    }
    if (metadata.version !== 1 || metadata.hostname !== hostname() || processIsAlive(metadata.pid)) {
      throw new Error(`Another technical transition holds ${TECHNICAL_TRANSITION_LOCK}, or its owner cannot be proven dead.`)
    }
    const after = await lstat(lockPath, { bigint: true })
    if (!sameIdentity(identity(before), after) || !(await readFile(lockPath)).equals(bytes)) throw new Error('The technical transition lock changed during recovery.')
    await unlink(lockPath)
    await syncDirectory(projectRoot)
  } finally {
    await recovery.close()
    await unlink(recoveryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await syncDirectory(projectRoot)
  }
}

async function acquireLock(projectRoot: string, recoveredStaleLock = false): Promise<{ close: () => Promise<void>; lockIdentity: FileIdentity }> {
  const lockPath = join(projectRoot, TECHNICAL_TRANSITION_LOCK)
  let handle
  try {
    handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && !recoveredStaleLock) {
      await removeDeadOwnerLock(projectRoot)
      return acquireLock(projectRoot, true)
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another technical transition holds ${TECHNICAL_TRANSITION_LOCK}. Inspect a surviving journal before retrying.`)
    throw error
  }
  const metadata: LockMetadata = { version: 1, pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() }
  const bytes = Buffer.from(`${JSON.stringify(metadata)}\n`)
  await handle.writeFile(bytes)
  await handle.sync()
  const lockIdentity = identity(await handle.stat({ bigint: true }))
  await syncDirectory(projectRoot)
  return {
    lockIdentity,
    close: async () => {
      await handle.close()
      const current = await lstat(lockPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (current && sameIdentity(lockIdentity, current)) {
        await unlink(lockPath)
        await syncDirectory(projectRoot)
      }
    }
  }
}

export async function acquireManifestMutationLock(projectRoot: string, recoveredStaleLock = false): Promise<{ close: () => Promise<void> }> {
  let lockPath: string
  try {
    const git = await inspectGitAgentScope(projectRoot)
    const lockDirectory = join(git.gitDir, 'saasfoundry')
    await mkdir(lockDirectory, { recursive: true })
    lockPath = join(lockDirectory, 'agents.lock')
  } catch (error) {
    if (!(error instanceof NotGitRepositoryError)) throw error
    lockPath = join(projectRoot, '.saasfoundry.agents.lock')
  }
  let handle
  try {
    handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && !recoveredStaleLock) {
      const current = await currentFile(lockPath)
      let metadata: (LockMetadata & { owner?: string }) | undefined
      try {
        metadata = current ? (JSON.parse(current.bytes.toString('utf8')) as LockMetadata & { owner?: string }) : undefined
      } catch {
        metadata = undefined
      }
      if (current && metadata?.owner === 'technical-transition' && metadata.version === 1 && metadata.hostname === hostname() && !processIsAlive(metadata.pid)) {
        const again = await lstat(lockPath, { bigint: true })
        if (!sameIdentity(identity(current.stat), again)) throw new Error('The shared manifest lock changed during stale-owner recovery.')
        await unlink(lockPath)
        await syncDirectory(dirname(lockPath))
        return acquireManifestMutationLock(projectRoot, true)
      }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another manifest or agent configuration update is in progress; retry when it finishes.')
    throw error
  }
  await handle.writeFile(`${JSON.stringify({ version: 1, owner: 'technical-transition', pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() })}\n`)
  const lockIdentity = identity(await handle.stat({ bigint: true }))
  await handle.sync()
  await syncDirectory(dirname(lockPath))
  return {
    close: async () => {
      await handle.close()
      const current = await lstat(lockPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (current && sameIdentity(lockIdentity, current)) {
        await unlink(lockPath)
        await syncDirectory(dirname(lockPath))
      }
    }
  }
}

async function readCandidate(candidateRoot: string, path: string, expected: TechnicalStackPathSnapshot): Promise<Buffer> {
  const absolute = absolutePath(candidateRoot, path)
  const before = await lstat(absolute, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1n) throw new Error(`Candidate changed before apply: ${path}`)
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat({ bigint: true })
    const content = await handle.readFile()
    const after = await lstat(absolute, { bigint: true })
    if (!sameIdentity(identity(before), opened) || !sameIdentity(identity(opened), after) || content.length !== expected.size || sha256(content) !== expected.sha256) {
      throw new Error(`Candidate changed before apply: ${path}`)
    }
    return content
  } finally {
    await handle.close()
  }
}

async function planMissingDirectories(projectRoot: string, additions: TechnicalStackAdoptionPlan['entries']): Promise<string[]> {
  const paths = new Set<string>()
  for (const entry of additions) {
    const segments = normalizePortableRelativePath(entry.path).split('/').slice(0, -1)
    for (let index = 1; index <= segments.length; index += 1) paths.add(segments.slice(0, index).join('/'))
  }

  const missing: string[] = []
  for (const path of [...paths].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    const found = await lstat(absolutePath(projectRoot, path), { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!found) missing.push(path)
    else if (!found.isDirectory() || found.isSymbolicLink()) throw new Error(`Unsafe technical stack parent: ${path}`)
  }
  return missing
}

async function captureTransactionDirectoryBaseline(projectRoot: string, rootIdentity: FileIdentity, additions: TechnicalStackAdoptionPlan['entries']): Promise<AncestorIdentity[]> {
  const paths = new Set<string>()
  for (const entry of additions) {
    const segments = normalizePortableRelativePath(entry.path).split('/').slice(0, -1)
    for (let index = 1; index <= segments.length; index += 1) paths.add(segments.slice(0, index).join('/'))
  }

  const baseline: AncestorIdentity[] = []
  for (const path of [...paths].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
    await assertRoot(projectRoot, rootIdentity)
    const found = await lstat(absolutePath(projectRoot, path), { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!found) continue
    if (!found.isDirectory() || found.isSymbolicLink()) throw new Error(`Unsafe technical stack parent: ${path}`)
    baseline.push({ path, ...identity(found) })
  }
  await assertRoot(projectRoot, rootIdentity)
  return baseline
}

async function assertTransactionDirectoryBaseline(projectRoot: string, journal: TransitionJournal): Promise<void> {
  await assertRoot(projectRoot, journal.root)
  for (const entry of [...(journal.protectedDirectories ?? []), ...journal.createdDirectories]) {
    const found = await lstat(absolutePath(projectRoot, entry.path), { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!found || !found.isDirectory() || found.isSymbolicLink() || !sameIdentity(entry, found)) {
      throw new Error(`Technical stack directory identity changed during apply: ${entry.path}`)
    }
  }
  await assertRoot(projectRoot, journal.root)
}

async function createPlannedDirectories(projectRoot: string, rootIdentity: FileIdentity, journal: TransitionJournal, onPhase?: ApplyTechnicalStackTransitionOptions['onPhase']): Promise<void> {
  for (const planned of journal.plannedDirectories ?? []) {
    await assertTransactionDirectoryBaseline(projectRoot, journal)
    if (!planned.recordPath) throw new Error(`Missing durable directory intent for ${planned.path}`)
    const current = absolutePath(projectRoot, planned.path)
    const ancestors = await captureAncestors(projectRoot, planned.path, rootIdentity)
    const parent = dirname(current)
    const parentBefore = await lstat(parent, { bigint: true })
    if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error(`Unsafe technical stack parent: ${planned.path}`)
    const found = await lstat(current, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (found) throw new Error(`Technical stack parent changed before apply: ${planned.path}`)
    await mkdir(current, { mode: 0o755 })
    if (!(await ancestorsMatch(projectRoot, planned.path, ancestors, rootIdentity))) throw new Error(`Technical stack ancestors changed during apply: ${planned.path}`)
    const created = await lstat(current, { bigint: true })
    if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`Unsafe created directory: ${planned.path}`)
    const parentAfter = await lstat(parent, { bigint: true })
    if (!sameIdentity(identity(parentBefore), parentAfter) || !parentAfter.isDirectory() || parentAfter.isSymbolicLink()) {
      throw new Error(`Technical stack parent changed during apply: ${planned.path}`)
    }
    await syncDirectory(parent)
    const evidence: CreatedEntry = { path: planned.path, recordPath: planned.recordPath, ancestors, ...identity(created) }
    await writeCreatedRecord(projectRoot, journal, evidence)
    journal.createdDirectories.push(evidence)
    await onPhase?.('after-directory', planned.path)
    await assertTransactionDirectoryBaseline(projectRoot, journal)
  }
}

async function createPlannedFile(
  projectRoot: string,
  candidateRoot: string,
  rootIdentity: FileIdentity,
  path: string,
  snapshot: TechnicalStackPathSnapshot,
  index: number,
  journal: TransitionJournal,
  onPhase?: ApplyTechnicalStackTransitionOptions['onPhase']
): Promise<void> {
  await assertTransactionDirectoryBaseline(projectRoot, journal)
  const destination = absolutePath(projectRoot, path)
  const ancestors = await captureAncestors(projectRoot, path, rootIdentity)
  const parent = dirname(destination)
  const parentBefore = await lstat(parent, { bigint: true })
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error(`Unsafe destination parent: ${path}`)
  const content = await readCandidate(candidateRoot, path, snapshot)
  const planned = journal.plannedFiles?.[index]
  if (!planned || planned.path !== path || planned.sha256 !== snapshot.sha256 || !planned.temporaryPath || !planned.recordPath) throw new Error(`Missing durable creation intent for ${path}`)
  const { temporaryPath, recordPath } = planned
  const temporary = absolutePath(projectRoot, temporaryPath)
  const temporaryIdentity = await writeExclusive(temporary, content, snapshot.mode || 0o644)
  if (!(await ancestorsMatch(projectRoot, path, ancestors, rootIdentity))) throw new Error(`Destination ancestors changed during apply: ${path}`)
  const evidence: CreatedEntry = { path, sha256: snapshot.sha256, temporaryPath, recordPath, ancestors, ...temporaryIdentity }
  await writeCreatedRecord(projectRoot, journal, evidence)
  journal.createdFiles.push(evidence)

  const parentNow = await lstat(parent, { bigint: true })
  if (!sameIdentity(identity(parentBefore), parentNow) || !parentNow.isDirectory() || parentNow.isSymbolicLink()) throw new Error(`Destination parent changed during apply: ${path}`)
  if (!(await ancestorsMatch(projectRoot, path, ancestors, rootIdentity))) throw new Error(`Destination ancestors changed before publication: ${path}`)
  await link(temporary, destination).catch((error: NodeJS.ErrnoException) => {
    if (['EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code ?? ''))
      throw new Error(`The project filesystem does not support safe exclusive publication for ${path}; use a local NTFS, APFS, ext4, or WSL filesystem.`)
    throw error
  })
  const created = await lstat(destination, { bigint: true })
  if (!(await ancestorsMatch(projectRoot, path, ancestors, rootIdentity))) throw new Error(`Destination ancestors changed during publication: ${path}`)
  if (!created.isFile() || created.isSymbolicLink() || !sameIdentity(temporaryIdentity, created)) throw new Error(`Exclusive creation could not be verified: ${path}`)
  await unlink(temporary)
  const published = await lstat(destination, { bigint: true })
  if (
    !published.isFile() ||
    published.isSymbolicLink() ||
    published.nlink !== 1n ||
    !sameIdentity(temporaryIdentity, published) ||
    (await hashRegularFileAllowLinks(destination)) !== snapshot.sha256
  ) {
    throw new Error(`Published file identity changed before journaling completed: ${path}`)
  }
  await syncDirectory(parent)
  await onPhase?.('after-file', path)
  await assertTransactionDirectoryBaseline(projectRoot, journal)
}

async function hashRegularFile(path: string): Promise<string | undefined> {
  const current = await currentFile(path).catch(() => undefined)
  return current ? sha256(current.bytes) : undefined
}

async function removePending(projectRoot: string, pending: PendingEntry, unresolved: string[]): Promise<void> {
  if (pending.kind === 'directory') {
    const path = absolutePath(projectRoot, pending.path)
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (stat) unresolved.push(pending.path)
    return
  }
  if (!pending.temporaryPath || !pending.sha256) {
    unresolved.push(pending.path)
    return
  }
  if (!pending.temporaryIdentity) {
    const [destination, temporary] = await Promise.all(
      [pending.path, pending.temporaryPath].map((relativePath) =>
        lstat(absolutePath(projectRoot, relativePath)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
      )
    )
    if (!destination && !temporary) return
    unresolved.push(pending.path)
    return
  }
  for (const relativePath of [pending.path, pending.temporaryPath]) {
    const absolute = absolutePath(projectRoot, relativePath)
    const stat = await lstat(absolute, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) continue
    const digest = stat.isFile() && !stat.isSymbolicLink() ? await hashRegularFileAllowLinks(absolute) : undefined
    if (!stat.isFile() || stat.isSymbolicLink() || !sameIdentity(pending.temporaryIdentity, stat) || digest !== pending.sha256) {
      unresolved.push(relativePath)
      continue
    }
    await unlink(absolute)
  }
}

async function hashRegularFileAllowLinks(path: string): Promise<string | undefined> {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) return undefined
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const bytes = await handle.readFile()
    const after = await lstat(path)
    if (!after.isFile() || after.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== opened.dev || after.ino !== opened.ino) return undefined
    return sha256(bytes)
  } finally {
    await handle.close()
  }
}

function sameSnapshot(left: TechnicalStackPathSnapshot | undefined, right: TechnicalStackPathSnapshot | undefined): boolean {
  return Boolean(left && right && left.sha256 === right.sha256 && left.size === right.size && left.mode === right.mode)
}

async function revalidateAppliedPlan(projectRoot: string, candidateRoot: string, approvedPlan: TechnicalStackAdoptionPlan, journal: TransitionJournal, excludedPaths?: string[]): Promise<void> {
  await assertTransactionDirectoryBaseline(projectRoot, journal)
  const fresh = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths })
  if (fresh.entries.length !== approvedPlan.entries.length) throw new Error('The technical stack changed during apply; the manifest was not committed.')
  const byPath = new Map(fresh.entries.map((entry) => [entry.path, entry]))
  const created = new Map(journal.createdFiles.map((entry) => [entry.path, entry]))
  for (const approved of approvedPlan.entries) {
    const current = byPath.get(approved.path)
    if (!current || current.action !== 'compatible' || !sameSnapshot(current.candidate, approved.candidate)) {
      throw new Error(`The technical stack changed during apply: ${approved.path}`)
    }
    if (approved.action === 'add') {
      if (!sameSnapshot(current.current, approved.candidate)) throw new Error(`A created technical file changed before commit: ${approved.path}`)
      const evidence = created.get(approved.path)
      const stat = await lstat(absolutePath(projectRoot, approved.path), { bigint: true })
      if (!evidence || !sameIdentity(evidence, stat)) throw new Error(`A created technical file identity changed before commit: ${approved.path}`)
    } else if (approved.action === 'compatible' && !sameSnapshot(current.current, approved.current)) {
      throw new Error(`A compatible user file changed before commit: ${approved.path}`)
    }
  }
  await assertTransactionDirectoryBaseline(projectRoot, journal)
}

function validateManifestTransition(approvedPlan: TechnicalStackAdoptionPlan, expectedBytes: Buffer, nextBytes: Buffer): void {
  let expected: Record<string, unknown>
  let next: Record<string, unknown>
  try {
    const parsedExpected = JSON.parse(expectedBytes.toString('utf8')) as SaaSFoundryManifest
    // Only the trusted registry may define which legacy deltas can be folded
    // into the atomic profile commit. Callers cannot supply an alternate
    // preservation baseline.
    expected = runManifestMigrations(parsedExpected).manifest as unknown as Record<string, unknown>
    const parsedNext = JSON.parse(nextBytes.toString('utf8')) as SaaSFoundryManifest
    next = runManifestMigrations(parsedNext).manifest as unknown as Record<string, unknown>
  } catch {
    throw new Error('The technical stack transition requires valid JSON manifests.')
  }
  const preserved = ['projectName', 'generatedAt', '$schema', 'manifestVersion', 'language', 'workflow', 'aiRules', 'tools', 'skillsAccounts']
  for (const key of preserved) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(next[key])) throw new Error(`The technical stack transition cannot change preserved manifest field ${key}.`)
  }
  const expectedModules = (expected.modules ?? {}) as Record<string, unknown>
  const nextModules = (next.modules ?? {}) as Record<string, unknown>
  for (const key of ['harness', 'advancedSkills']) {
    if (JSON.stringify(expectedModules[key]) !== JSON.stringify(nextModules[key])) throw new Error(`The technical stack transition cannot change preserved module field ${key}.`)
  }
  if (expected.projectName !== undefined) {
    if (!['monorepo', 'multirepo'].includes(String(next.structure))) throw new Error('The technical stack manifest must declare a supported full-project topology.')
    for (const key of ['email', 's3Setup', 'dbSetup', 'includeAnalytics', 'advancedSkills']) {
      if (!(key in nextModules)) throw new Error(`The technical stack manifest is missing technical module field ${key}.`)
    }
    if (typeof next.ports !== 'object' || next.ports === null) throw new Error('The technical stack manifest is missing its port allocation.')
  }
  const beforeHashes = (expected.fileHashes ?? {}) as Record<string, string>
  const afterHashes = (next.fileHashes ?? {}) as Record<string, string>
  for (const [path, digest] of Object.entries(beforeHashes)) {
    if (afterHashes[path] !== digest) throw new Error(`The technical stack transition cannot replace existing ownership for ${path}.`)
  }
  const technicalHashes = technicalOwnershipHashes(approvedPlan)
  for (const [path, digest] of Object.entries(technicalHashes)) {
    if (afterHashes[path] !== digest) throw new Error(`The technical stack manifest is missing ownership evidence for ${path}.`)
  }
  for (const entry of approvedPlan.entries.filter((candidate) => candidate.action === 'compatible')) {
    if (!(entry.path in beforeHashes) && entry.path in afterHashes) throw new Error(`Compatible user file ${entry.path} must remain unowned.`)
  }
  const expectedUnmanaged = new Set(Array.isArray(expected.unmanagedPaths) ? (expected.unmanagedPaths as string[]) : [])
  for (const entry of approvedPlan.entries.filter((candidate) => candidate.candidate && !(candidate.path in beforeHashes) && !(candidate.path in technicalHashes))) expectedUnmanaged.add(entry.path)
  const afterUnmanaged = Array.isArray(next.unmanagedPaths) ? [...(next.unmanagedPaths as string[])].sort() : []
  if (JSON.stringify(afterUnmanaged) !== JSON.stringify([...expectedUnmanaged].sort())) {
    throw new Error('The technical stack manifest must preserve every compatible user-owned path as unmanaged.')
  }
  const allowedHashes = [...new Set([...Object.keys(beforeHashes), ...Object.keys(technicalHashes)])].sort()
  if (JSON.stringify(Object.keys(afterHashes).sort()) !== JSON.stringify(allowedHashes)) throw new Error('The technical stack manifest contains ownership outside the approved plan.')
}

function assertDurablePlatform(): void {
  if (process.platform === 'win32')
    throw new Error('Safe technical profile transitions require Linux, macOS, or WSL on Windows because native Windows does not provide the required directory durability guarantees.')
}

async function rollbackCreated(projectRoot: string, journal: TransitionJournal): Promise<string[]> {
  const unresolved: string[] = []
  if (journal.pending) await removePending(projectRoot, journal.pending, unresolved)

  const evidenced = new Set(journal.createdFiles.map((entry) => entry.path))
  for (const planned of journal.plannedFiles ?? []) {
    if (evidenced.has(planned.path)) continue
    for (const relativePath of [planned.path, planned.temporaryPath].filter((path): path is string => Boolean(path))) {
      const found = await safeUnrecordedPath(projectRoot, relativePath, journal.root)
      if (found === null) {
        unresolved.push(relativePath)
        continue
      }
      if (found) unresolved.push(relativePath)
    }
  }

  const evidencedDirectories = new Set(journal.createdDirectories.map((entry) => entry.path))
  for (const planned of journal.plannedDirectories ?? []) {
    if (evidencedDirectories.has(planned.path)) continue
    const found = await safeUnrecordedPath(projectRoot, planned.path, journal.root)
    if (found === null) {
      unresolved.push(planned.path)
      continue
    }
    if (found) unresolved.push(planned.path)
  }

  for (const entry of [...journal.createdFiles].reverse()) {
    for (const relativePath of [entry.path, entry.temporaryPath].filter((path): path is string => Boolean(path))) {
      if (!(await ancestorsMatch(projectRoot, relativePath, entry.ancestors, journal.root))) {
        unresolved.push(relativePath)
        continue
      }
      const path = absolutePath(projectRoot, relativePath)
      const stat = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!stat) continue
      const digest = stat.isFile() && !stat.isSymbolicLink() && stat.nlink <= 2n ? await hashRegularFileAllowLinks(path) : undefined
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 2n || !sameIdentity(entry, stat) || digest !== entry.sha256) {
        unresolved.push(relativePath)
        continue
      }
      await unlink(path)
      await syncDirectory(dirname(path))
    }
  }

  for (const entry of [...journal.createdDirectories].reverse()) {
    if (!(await ancestorsMatch(projectRoot, entry.path, entry.ancestors, journal.root))) {
      unresolved.push(entry.path)
      continue
    }
    const path = absolutePath(projectRoot, entry.path)
    const stat = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) continue
    const contents = stat.isDirectory() && !stat.isSymbolicLink() ? await readdir(path) : []
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(entry, stat) || contents.length > 0) {
      if (contents.length > 0 && unresolved.some((candidate) => candidate.startsWith(`${entry.path}/`))) continue
      unresolved.push(entry.path)
      continue
    }
    await rmdir(path)
    await syncDirectory(dirname(path))
  }
  if (unresolved.length === 0) await removeCreatedRecords(projectRoot, journal)
  return [...new Set(unresolved)].sort()
}

async function removeManifestTemporary(projectRoot: string, journal: TransitionJournal, unresolved: string[]): Promise<void> {
  const temporaryPath = journal.manifest.temporaryPath
  if (!temporaryPath) return
  const path = absolutePath(projectRoot, temporaryPath)
  const stat = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return
  const digest = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n ? await hashRegularFileAllowLinks(path) : undefined
  if (
    !journal.manifest.temporaryIdentity ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    !sameIdentity(journal.manifest.temporaryIdentity, stat) ||
    digest !== journal.manifest.afterSha256
  ) {
    unresolved.push(temporaryPath)
    return
  }
  await unlink(path)
  await syncDirectory(dirname(path))
}

async function recoverWithLock(projectRoot: string): Promise<TechnicalStackRecoveryResult> {
  const journal = await readJournal(projectRoot)
  if (!journal) return { status: 'none', unresolved: [] }
  const rootIdentity = await statRoot(projectRoot)
  if (!sameIdentity(journal.root, { dev: BigInt(rootIdentity.dev), ino: BigInt(rootIdentity.ino) })) throw new TechnicalStackRecoveryError(['project-root-identity'])
  const manifestPath = absolutePath(projectRoot, journal.manifest.path)
  const manifestHash = await hashRegularFile(manifestPath)

  if (manifestHash === journal.manifest.afterSha256) {
    const unresolved: string[] = []
    await removeManifestTemporary(projectRoot, journal, unresolved)
    if (unresolved.length > 0) throw new TechnicalStackRecoveryError(unresolved)
    await removeCreatedRecords(projectRoot, journal)
    await unlink(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))
    await syncDirectory(projectRoot)
    return { status: 'committed', unresolved: [] }
  }
  if (manifestHash !== journal.manifest.beforeSha256) {
    journal.state = 'rollback-needed'
    journal.unresolved = ['manifest']
    await replaceJournal(projectRoot, journal)
    throw new TechnicalStackRecoveryError(['manifest'])
  }

  const unresolved = await rollbackCreated(projectRoot, journal)
  await removeManifestTemporary(projectRoot, journal, unresolved)
  if (unresolved.length > 0) {
    journal.state = 'rollback-needed'
    journal.unresolved = unresolved
    await replaceJournal(projectRoot, journal)
    throw new TechnicalStackRecoveryError(unresolved)
  }
  await unlink(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))
  await syncDirectory(projectRoot)
  return { status: 'rolled-back', unresolved: [] }
}

export async function recoverTechnicalStackTransition(projectRoot: string): Promise<TechnicalStackRecoveryResult> {
  assertDurablePlatform()
  const root = resolve(projectRoot)
  const lock = await acquireLock(root)
  let manifestLock: Awaited<ReturnType<typeof acquireManifestMutationLock>> | undefined
  try {
    manifestLock = await acquireManifestMutationLock(root)
    return await recoverWithLock(root)
  } finally {
    await manifestLock?.close()
    await lock.close()
  }
}

async function commitManifest(projectRoot: string, expectedManifest: Buffer, nextManifest: Buffer, journal: TransitionJournal): Promise<void> {
  const manifestPath = absolutePath(projectRoot, journal.manifest.path)
  const current = await currentFile(manifestPath)
  if (!current || !current.bytes.equals(expectedManifest)) throw new Error('The manifest changed before the technical stack commit.')
  const originalIdentity = identity(current.stat)
  const temporaryPath = journal.manifest.temporaryPath
  if (!temporaryPath) throw new Error('The manifest temporary path was not journaled before apply.')
  const temporary = absolutePath(projectRoot, temporaryPath)
  journal.manifest.temporaryIdentity = await writeExclusive(temporary, nextManifest, Number(current.stat.mode) & 0o777)
  journal.state = 'committing'
  await replaceJournal(projectRoot, journal)

  const beforeRename = await lstat(manifestPath, { bigint: true })
  const beforeBytes = await readFile(manifestPath)
  if (!sameIdentity(originalIdentity, beforeRename) || !beforeBytes.equals(expectedManifest)) throw new Error('The manifest changed during the technical stack commit.')
  await rename(temporary, manifestPath)
  await syncDirectory(projectRoot)
  journal.state = 'committed'
  delete journal.manifest.temporaryPath
  delete journal.manifest.temporaryIdentity
  await replaceJournal(projectRoot, journal)
}

/** Apply only an approved, revalidated additive plan; the manifest is committed last. */
export async function applyTechnicalStackTransition(options: ApplyTechnicalStackTransitionOptions): Promise<TechnicalStackTransitionResult> {
  assertDurablePlatform()
  const projectRoot = resolve(options.projectRoot)
  const candidateRoot = resolve(options.candidateRoot)
  const manifestPath = normalizePortableRelativePath(options.manifestPath ?? '.saasfoundry.json')
  const lock = await acquireLock(projectRoot)
  let manifestLock: Awaited<ReturnType<typeof acquireManifestMutationLock>> | undefined
  let journal: TransitionJournal | undefined
  try {
    manifestLock = await acquireManifestMutationLock(projectRoot)
    await options.onPhase?.('after-lock')
    const previousRecovery = await recoverWithLock(projectRoot)
    const manifest = await currentFile(absolutePath(projectRoot, manifestPath))
    if (!manifest || !manifest.bytes.equals(options.expectedManifest)) throw new Error('The manifest changed after the transition preview.')

    const currentPlan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: options.excludedPaths })
    if (!currentPlan.canApply) throw new Error('The technical stack plan now contains conflicts or unsupported paths.')
    if (currentPlan.fingerprint !== options.approvedPlan.fingerprint) throw new Error('The technical stack plan changed after preview; review a fresh plan before applying.')
    validateManifestTransition(currentPlan, options.expectedManifest, options.nextManifest)
    const additions = currentPlan.entries.filter((entry) => entry.action === 'add')
    const compatible = currentPlan.entries.filter((entry) => entry.action === 'compatible').map((entry) => entry.path)
    if (additions.length === 0 && options.expectedManifest.equals(options.nextManifest)) {
      return { mutated: false, created: [], compatible, manifestSha256: sha256(options.nextManifest), recoveredCommittedTransaction: previousRecovery.status === 'committed' }
    }
    if (additions.length > 0 && options.expectedManifest.equals(options.nextManifest)) {
      throw new Error('A mutating technical transition requires a distinct manifest commit marker.')
    }

    const transactionId = randomUUID()
    const rootIdentity = await statRoot(projectRoot)
    const missingDirectories = await planMissingDirectories(projectRoot, additions)
    const protectedDirectories = await captureTransactionDirectoryBaseline(projectRoot, rootIdentity, additions)
    journal = {
      version: 1,
      sequence: 0,
      transactionId,
      planFingerprint: currentPlan.fingerprint,
      state: 'applying',
      root: rootIdentity,
      manifest: {
        path: manifestPath,
        beforeSha256: sha256(options.expectedManifest),
        afterSha256: sha256(options.nextManifest),
        temporaryPath: `${manifestPath}.${transactionId}.tmp`
      },
      createdFiles: [],
      createdDirectories: [],
      protectedDirectories,
      plannedFiles: additions.map((entry, index) => ({
        kind: 'file',
        path: entry.path,
        sha256: entry.candidate!.sha256,
        temporaryPath: `${entry.path}.saasfoundry-${transactionId}-${index}.tmp`,
        recordPath: createdRecordName(transactionId, 'file', index)
      })),
      plannedDirectories: missingDirectories.map((path, index) => ({
        kind: 'directory',
        path,
        recordPath: createdRecordName(transactionId, 'directory', index)
      }))
    }
    await replaceJournal(projectRoot, journal, true)
    await options.onPhase?.('after-journal')
    await createPlannedDirectories(projectRoot, journal.root, journal, options.onPhase)

    for (let index = 0; index < additions.length; index += 1) {
      const entry = additions[index]
      if (!entry.candidate) throw new Error(`Missing candidate evidence for ${entry.path}`)
      await createPlannedFile(projectRoot, candidateRoot, journal.root, entry.path, entry.candidate, index, journal, options.onPhase)
    }

    await options.onPhase?.('before-manifest')
    await revalidateAppliedPlan(projectRoot, candidateRoot, currentPlan, journal, options.excludedPaths)
    await commitManifest(projectRoot, options.expectedManifest, options.nextManifest, journal)
    await options.onPhase?.('after-manifest')
    await removeCreatedRecords(projectRoot, journal)
    await unlink(join(projectRoot, TECHNICAL_TRANSITION_JOURNAL))
    await syncDirectory(projectRoot)
    return {
      mutated: additions.length > 0 || !options.expectedManifest.equals(options.nextManifest),
      created: additions.map((entry) => entry.path),
      compatible,
      manifestSha256: journal.manifest.afterSha256,
      recoveredCommittedTransaction: previousRecovery.status === 'committed'
    }
  } catch (error) {
    if (journal) {
      try {
        const recovery = await recoverWithLock(projectRoot)
        if (recovery.status === 'committed') {
          return {
            mutated: true,
            created: journal.createdFiles.map((entry) => entry.path),
            compatible: options.approvedPlan.entries.filter((entry) => entry.action === 'compatible').map((entry) => entry.path),
            manifestSha256: journal.manifest.afterSha256,
            recoveredCommittedTransaction: true
          }
        }
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], 'Technical stack apply failed and automatic rollback requires recovery.')
      }
    }
    throw error
  } finally {
    await manifestLock?.close()
    await lock.close()
  }
}
