import { randomUUID } from 'crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'fs/promises'
import { join } from 'path'

import { resolveGitCommonDir } from './git-agent-scope'
import type { SaaSFoundryManifest } from '../types'

/**
 * Consent to delegate ticket delivery to background agents, each in its own worktree (#1026).
 *
 * Two layers, asked at most once each:
 * - the **shared** answer, `modules.harness.delegation` in `.saasfoundry.json`, is the team's
 *   default: it applies to every clone, teammate and CI run that has not said otherwise;
 * - a **local** answer, kept in the Git directory of one clone, overrides the shared one for that
 *   clone alone. It is never tracked, so a teammate's `decline` does not become the team's.
 *
 * Only `sf agents delegation` writes either layer: the coding agent never hand-edits them. A
 * missing layer means the developer was not asked yet.
 */
export const TICKET_DELIVERY_DECISIONS = ['allowed', 'declined'] as const
export type TicketDeliveryDecision = (typeof TICKET_DELIVERY_DECISIONS)[number]

export const DELEGATION_SCOPES = ['shared', 'local'] as const
export type DelegationScope = (typeof DELEGATION_SCOPES)[number]

/** One recorded answer, as kept in the manifest (`modules.harness.delegation`) or in the clone. */
export interface HarnessDelegation {
  ticketDelivery: TicketDeliveryDecision
  /** ISO-8601 time of the developer's answer. */
  decidedAt: string
}

/** What one layer says: its recorded answer, or `not-asked`. */
export interface DelegationLayer {
  ticketDelivery: TicketDeliveryDecision | 'not-asked'
  decidedAt?: string
}

/**
 * What a reader gets. `ticketDelivery` is the effective value the session acts on: the clone's
 * override when it has one, else the team's. `unavailable` means the project has no harness block
 * to carry an answer, which is not the same as "not asked yet".
 */
export interface DelegationState {
  ticketDelivery: TicketDeliveryDecision | 'not-asked' | 'unavailable'
  decidedAt?: string
  /** Which layer the effective value comes from; `none` while nobody answered or when unavailable. */
  source: 'local' | 'shared' | 'none'
  shared: DelegationLayer
  local: DelegationLayer
  /** Why the state is `unavailable`. */
  reason?: string
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const isTicketDeliveryDecision = (value: unknown): value is TicketDeliveryDecision => (TICKET_DELIVERY_DECISIONS as readonly unknown[]).includes(value)

export const isDelegationScope = (value: unknown): value is DelegationScope => (DELEGATION_SCOPES as readonly unknown[]).includes(value)

/** Validate a recorded block; the message names the field so a hand edit is easy to find. */
export function validateDelegation(value: unknown): asserts value is HarnessDelegation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid manifest harness delegation: expected an object.')
  const record = value as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => key !== 'ticketDelivery' && key !== 'decidedAt')
  if (extra.length) throw new Error(`Invalid manifest harness delegation: unknown key ${extra.join(', ')}.`)
  if (!isTicketDeliveryDecision(record.ticketDelivery)) throw new Error(`Invalid manifest harness delegation: ticketDelivery must be ${TICKET_DELIVERY_DECISIONS.join(' or ')}.`)
  if (typeof record.decidedAt !== 'string' || !ISO_DATE_TIME.test(record.decidedAt) || Number.isNaN(Date.parse(record.decidedAt)))
    throw new Error('Invalid manifest harness delegation: decidedAt must be an ISO-8601 date-time.')
}

const layer = (delegation: HarnessDelegation | undefined): DelegationLayer =>
  delegation ? { ticketDelivery: delegation.ticketDelivery, decidedAt: delegation.decidedAt } : { ticketDelivery: 'not-asked' }

/** The local answer wins over the shared one; with neither, nobody was asked. */
export function resolveDelegation(shared: HarnessDelegation | undefined, local?: HarnessDelegation): DelegationState {
  const effective = local ?? shared
  return {
    ticketDelivery: effective?.ticketDelivery ?? 'not-asked',
    ...(effective ? { decidedAt: effective.decidedAt } : {}),
    source: local ? 'local' : shared ? 'shared' : 'none',
    shared: layer(shared),
    local: layer(local)
  }
}

export const unavailableDelegation = (reason: string): DelegationState => ({
  ticketDelivery: 'unavailable',
  source: 'none',
  shared: { ticketDelivery: 'not-asked' },
  local: { ticketDelivery: 'not-asked' },
  reason
})

export const NO_HARNESS_REASON = 'modules.harness is missing from .saasfoundry.json, so this project has no harness block to carry the answer'

// --- the local layer: one file in the Git directory shared by every worktree of the clone -------

const LOCAL_DIR = 'saasfoundry'
const LOCAL_FILE = 'delegation.json'
const LOCAL_VERSION = 1

async function localFile(root: string): Promise<string | undefined> {
  const commonDir = await resolveGitCommonDir(root)
  return commonDir ? join(commonDir, LOCAL_DIR, LOCAL_FILE) : undefined
}

function parseLocal(text: string, path: string): HarnessDelegation {
  const fail = (detail: string): never => {
    throw new Error(`Invalid local delegation answer in ${path} (${detail}). Remove it with sf agents delegation clear.`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('not JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('expected an object')
  const record = value as Record<string, unknown>
  if (record.version !== LOCAL_VERSION) return fail(`expected version ${LOCAL_VERSION}`)
  const extra = Object.keys(record).filter((key) => !['version', 'ticketDelivery', 'decidedAt'].includes(key))
  if (extra.length) return fail(`unknown key ${extra.join(', ')}`)
  const recorded = { ticketDelivery: record.ticketDelivery, decidedAt: record.decidedAt }
  try {
    validateDelegation(recorded)
  } catch (error) {
    return fail((error as Error).message.replace('Invalid manifest harness delegation: ', ''))
  }
  return recorded as unknown as HarnessDelegation
}

/** The clone's own answer, or undefined when it never gave one or this is not a Git checkout. */
export async function readLocalDelegation(root: string): Promise<HarnessDelegation | undefined> {
  const path = await localFile(root)
  if (!path) return undefined
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file for the local delegation answer, not a link or directory: ${path}`)
    return parseLocal(await readFile(path, 'utf8'), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Atomic replacement inside the clone's Git directory; nothing in the working tree changes. */
export async function writeLocalDelegation(root: string, delegation: HarnessDelegation): Promise<void> {
  const path = await localFile(root)
  if (!path) throw new Error('A local delegation answer is kept in the Git directory of the clone: run this from a Git checkout, or record the shared answer instead.')
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ version: LOCAL_VERSION, ...delegation }, null, 2) + '\n')
      await handle.sync()
    } finally {
      await handle.close()
    }
    const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Expected a regular file for the local delegation answer, not a link or directory: ${path}`)
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/** Drop the clone's override so the shared answer applies again. False when there was none. */
export async function clearLocalDelegation(root: string): Promise<boolean> {
  const path = await localFile(root)
  if (!path) return false
  try {
    await unlink(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Both layers and the effective value for a project whose manifest is already read. */
export async function loadDelegationState(root: string, manifest: Pick<SaaSFoundryManifest, 'modules'>): Promise<DelegationState> {
  const harness = manifest.modules?.harness
  if (!harness) return unavailableDelegation(NO_HARNESS_REASON)
  return resolveDelegation(harness.delegation, await readLocalDelegation(root))
}
