import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { acquireManifestMutationLock, recoverTechnicalStackTransition, TECHNICAL_TRANSITION_JOURNAL } from './scaffold/technical-stack.transaction'
import type { SaaSFoundryManifest } from './types'

interface FileIdentity {
  dev: string
  ino: string
}

export interface ManifestFileSnapshot {
  path: string
  bytes: Buffer
  mode: number
  identity: FileIdentity
  rootIdentity: FileIdentity
}

export interface ReplaceManifestFileOptions {
  /** Test seam for identity-race regression coverage; production callers omit it. */
  beforeCommitValidation?: () => void | Promise<void>
}

function identity(stat: { dev: bigint | number; ino: bigint | number }): FileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino) }
}

function sameIdentity(expected: FileIdentity, stat: { dev: bigint | number; ino: bigint | number }): boolean {
  return expected.dev === String(stat.dev) && expected.ino === String(stat.ino)
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Read a manifest without following links or accepting hard-linked storage. */
export async function readManifestFileSafe(path = '.saasfoundry.json'): Promise<ManifestFileSnapshot> {
  const absolute = resolve(path)
  const root = dirname(absolute)
  const rootBefore = await lstat(root, { bigint: true })
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) throw new Error('The manifest parent must be a real project directory.')
  const before = await lstat(absolute, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error('The project manifest must be a regular, non-linked file.')
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat({ bigint: true })
    const bytes = await handle.readFile()
    const [after, rootAfter] = await Promise.all([lstat(absolute, { bigint: true }), lstat(root, { bigint: true })])
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.nlink !== 1n ||
      !sameIdentity(identity(before), opened) ||
      !sameIdentity(identity(opened), after) ||
      !sameIdentity(identity(rootBefore), rootAfter)
    ) {
      throw new Error('The project manifest changed while it was being read.')
    }
    return { path: absolute, bytes, mode: Number(opened.mode) & 0o777, identity: identity(opened), rootIdentity: identity(rootBefore) }
  } finally {
    await handle.close()
  }
}

/** Compare-and-swap a manifest through a durable same-directory rename. */
export async function replaceManifestFileSafe(before: ManifestFileSnapshot, bytes: Buffer, options: ReplaceManifestFileOptions = {}): Promise<ManifestFileSnapshot> {
  const current = await readManifestFileSafe(before.path)
  if (!sameIdentity(before.identity, { dev: BigInt(current.identity.dev), ino: BigInt(current.identity.ino) }) || !current.bytes.equals(before.bytes)) {
    throw new Error('The project manifest changed during the update. Existing changes were preserved; retry the command.')
  }
  if (!sameIdentity(before.rootIdentity, { dev: BigInt(current.rootIdentity.dev), ino: BigInt(current.rootIdentity.ino) })) {
    throw new Error('The project directory changed during the update.')
  }

  const temporary = `${before.path}.${randomUUID()}.tmp`
  let temporaryIdentity: FileIdentity | undefined
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), before.mode)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
      temporaryIdentity = identity(await handle.stat({ bigint: true }))
    } finally {
      await handle.close()
    }
    await options.beforeCommitValidation?.()
    const latest = await readManifestFileSafe(before.path)
    if (!sameIdentity(before.identity, { dev: BigInt(latest.identity.dev), ino: BigInt(latest.identity.ino) }) || !latest.bytes.equals(before.bytes)) {
      throw new Error('The project manifest changed before commit. Existing changes were preserved; retry the command.')
    }
    if (!sameIdentity(before.rootIdentity, { dev: BigInt(latest.rootIdentity.dev), ino: BigInt(latest.rootIdentity.ino) })) {
      throw new Error('The project directory changed before the manifest commit.')
    }
    await rename(temporary, before.path)
    await syncDirectory(dirname(before.path))
    const committed = await readManifestFileSafe(before.path)
    if (!sameIdentity(before.rootIdentity, { dev: BigInt(committed.rootIdentity.dev), ino: BigInt(committed.rootIdentity.ino) })) {
      throw new Error('The project directory changed during the manifest commit.')
    }
    return committed
  } finally {
    const found = await lstat(temporary, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (found && temporaryIdentity && sameIdentity(temporaryIdentity, found)) await unlink(temporary)
  }
}

/**
 * Serialize a project-manifest mutation with technical transitions and commit
 * only the fields derived from a fresh, safely opened snapshot.
 */
export async function mutateProjectManifestSafe(
  projectRoot: string,
  mutate: (manifest: SaaSFoundryManifest) => SaaSFoundryManifest | void | Promise<SaaSFoundryManifest | void>
): Promise<SaaSFoundryManifest> {
  const root = resolve(projectRoot)
  const journal = await lstat(resolve(root, TECHNICAL_TRANSITION_JOURNAL)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (journal) await recoverTechnicalStackTransition(root)

  const lock = await acquireManifestMutationLock(root)
  try {
    const pendingJournal = await lstat(resolve(root, TECHNICAL_TRANSITION_JOURNAL)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (pendingJournal) throw new Error('A technical stack transition requires recovery before the project manifest can be changed.')

    const snapshot = await readManifestFileSafe(resolve(root, '.saasfoundry.json'))
    const current = JSON.parse(snapshot.bytes.toString('utf8')) as SaaSFoundryManifest
    const replacement = (await mutate(current)) ?? current
    await replaceManifestFileSafe(snapshot, Buffer.from(`${JSON.stringify(replacement, null, 2)}\n`))
    return replacement
  } finally {
    await lock.close()
  }
}
