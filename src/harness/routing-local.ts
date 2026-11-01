import { randomUUID } from 'crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'fs/promises'
import { join } from 'path'

import { withLock } from './delegation-ledger'
import { isRoutingProvider, ROUTING_PROVIDERS, TASK_KINDS, type AutoKinds, type RoutingOverrides, type RoutingProvider, type TaskKind } from './routing-grid'
import { renderTierAgents } from './tier-agents'
import type { HarnessAgent } from '../types'

/**
 * The local routing layer (#1035): the moves the automatic adjustment made in this clone, with their
 * evidence. It sits between the developer's shared overrides and the shipped grid:
 *
 *   `modules.harness.routing` in `.saasfoundry.json`  >  this layer  >  the shipped grid
 *
 * It lives in the Git common directory like the ledger it is computed from, so it applies at once to
 * every worktree of the clone and is never committed. `sf agents routing promote` is the only way a
 * move reaches the shared manifest, as a reviewable change. Nothing here is hand-edited.
 */
export const LOCAL_ROUTING_FILE = 'routing.json'
const LOCK_NAME = 'routing.lock'
const LOCAL_VERSION = 1
/** How many entries the log keeps (moves, holds that changed, adoptions); older ones fall off, the current moves do not. */
export const ROUTING_LOG_LIMIT = 100
/** A candidate that appeared on the ladder stays "new" (tried by itself, within the trial share) for at most this long. */
export const NEW_CANDIDATE_DAYS = 60

const TIER = /^[a-z][a-z0-9-]*$/
const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** What a move rested on: the rule, the window it counted, the expected feature cost it compared and the runs behind it. */
export interface AdjustmentEvidence {
  rule: string
  from: { tier: string; candidate: string }
  to: { tier: string; candidate: string }
  window: { rated: number; successes: number; failures: number }
  /** Expected cost of delivering the work on each candidate, failures included; null where a candidate has no priced run. */
  expectedFeatureCost: { from: string | null; to: string | null; currency: 'USD' }
  durationP95Ms: { from: number | null; to: number | null }
  /** Ledger run ids, at most 30. */
  runs: string[]
}

export type AdjustmentAction = 'escalate' | 'deescalate'

export interface LocalAdjustment {
  tier: string
  from: string
  action: AdjustmentAction
  at: string
  evidence: AdjustmentEvidence
}

/** `hold`: the adjustment looked at a kind and left it where it is, for this reason (logged when the reason changes). `adopt`: a new candidate proved itself. */
export type LogAction = AdjustmentAction | 'reset' | 'promote' | 'hold' | 'adopt'
const LOG_ACTIONS: readonly string[] = ['escalate', 'deescalate', 'reset', 'promote', 'hold', 'adopt']

export interface LocalLogEntry {
  at: string
  action: LogAction
  kind: TaskKind
  provider: RoutingProvider | null
  from: string
  to: string
  evidence: AdjustmentEvidence | null
  note: string | null
}

/** Why the adjustment last left a kind where it is, and since when. */
export interface LocalHold {
  reason: string
  since: string
}

/**
 * A tier's candidate as the adjustment last saw it. `new`: it appeared after the first evaluation (a grid
 * bump, a project declaration), so a cheaper or a stronger neighbour of the routed tier is tried by itself,
 * within the trial share, until the expected-cost rule adopts it.
 */
export interface LocalLadderEntry {
  candidate: string
  since: string
  status: 'new' | 'accepted'
}

export interface LocalRouting {
  version: 1
  kinds: Partial<Record<TaskKind, Partial<Record<RoutingProvider, LocalAdjustment>>>>
  /** Per kind and provider, when the evidence started over: a move, a reset or a promotion. Runs before it are not counted again. */
  boundaries: Partial<Record<TaskKind, Partial<Record<RoutingProvider, string>>>>
  /** Per kind and provider, the reason it was last held; a hold that did not change is not logged again. */
  holds: Partial<Record<TaskKind, Partial<Record<RoutingProvider, LocalHold>>>>
  /** Per provider and tier, the candidate last seen: what tells a new candidate from a known one. */
  ladders: Partial<Record<RoutingProvider, Record<string, LocalLadderEntry>>>
  log: LocalLogEntry[]
}

export const emptyLocalRouting = (): LocalRouting => ({ version: LOCAL_VERSION, kinds: {}, boundaries: {}, holds: {}, ladders: {}, log: [] })

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isKind = (value: unknown): value is TaskKind => typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value)

export function localRoutingPath(dir: string): string {
  return join(dir, LOCAL_ROUTING_FILE)
}

function parseLocalRouting(text: string, path: string): LocalRouting {
  const fail = (detail: string): never => {
    throw new Error(`Invalid local routing in ${path} (${detail}). It only caches the automatic moves of this clone: delete the file to start over.`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('not JSON')
  }
  if (!object(value) || value.version !== LOCAL_VERSION) return fail(`expected version ${LOCAL_VERSION}`)
  if (Object.keys(value).some((key) => !['version', 'kinds', 'boundaries', 'holds', 'ladders', 'log'].includes(key))) return fail('unknown key')
  if (!object(value.kinds) || !object(value.boundaries) || !Array.isArray(value.log)) return fail('kinds, boundaries and log are required')
  // A layer written before holds and ladders existed has neither: both start empty.
  if (value.holds === undefined) value.holds = {}
  if (value.ladders === undefined) value.ladders = {}
  if (!object(value.holds) || !object(value.ladders)) return fail('holds and ladders must be objects')
  for (const [kind, providers] of Object.entries(value.holds)) {
    if (!isKind(kind) || !object(providers)) return fail(`holds.${kind}`)
    for (const [provider, hold] of Object.entries(providers)) {
      if (!isRoutingProvider(provider) || !object(hold) || typeof hold.reason !== 'string' || typeof hold.since !== 'string' || !ISO_MILLIS.test(hold.since)) return fail(`holds.${kind}.${provider}`)
    }
  }
  for (const [provider, tiers] of Object.entries(value.ladders)) {
    if (!isRoutingProvider(provider) || !object(tiers)) return fail(`ladders.${provider}`)
    for (const [tier, entry] of Object.entries(tiers)) {
      if (
        !TIER.test(tier) ||
        !object(entry) ||
        typeof entry.candidate !== 'string' ||
        typeof entry.since !== 'string' ||
        !ISO_MILLIS.test(entry.since) ||
        !['new', 'accepted'].includes(String(entry.status))
      )
        return fail(`ladders.${provider}.${tier}`)
    }
  }
  for (const [kind, providers] of Object.entries(value.kinds)) {
    if (!isKind(kind) || !object(providers)) return fail(`kinds.${kind}`)
    for (const [provider, entry] of Object.entries(providers)) {
      if (!isRoutingProvider(provider) || !object(entry)) return fail(`kinds.${kind}.${provider}`)
      if (typeof entry.tier !== 'string' || !TIER.test(entry.tier) || typeof entry.from !== 'string' || !TIER.test(entry.from)) return fail(`kinds.${kind}.${provider}.tier`)
      if (!['escalate', 'deescalate'].includes(String(entry.action)) || typeof entry.at !== 'string' || !ISO_MILLIS.test(entry.at) || !object(entry.evidence)) return fail(`kinds.${kind}.${provider}`)
    }
  }
  for (const [kind, providers] of Object.entries(value.boundaries)) {
    if (!isKind(kind) || !object(providers)) return fail(`boundaries.${kind}`)
    for (const [provider, at] of Object.entries(providers)) if (!isRoutingProvider(provider) || typeof at !== 'string' || !ISO_MILLIS.test(at)) return fail(`boundaries.${kind}.${provider}`)
  }
  for (const entry of value.log) {
    if (!object(entry) || !isKind(entry.kind) || typeof entry.at !== 'string' || !LOG_ACTIONS.includes(String(entry.action))) return fail('log entry')
  }
  return value as unknown as LocalRouting
}

/** The clone's local layer; an absent file is an empty layer. */
export async function readLocalRouting(dir: string): Promise<LocalRouting> {
  const path = localRoutingPath(dir)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file for the local routing layer, not a link or directory: ${path}`)
    return parseLocalRouting(await readFile(path, 'utf8'), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLocalRouting()
    throw error
  }
}

async function writeLocalRouting(dir: string, state: LocalRouting): Promise<void> {
  const path = localRoutingPath(dir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/**
 * Read, change and write the layer under its own lock, so two hooks that finish together cannot lose
 * each other's move. `change` returns the next state, or undefined to leave the file as it is.
 */
export async function updateLocalRouting<T>(dir: string, change: (state: LocalRouting) => { next?: LocalRouting; result: T } | Promise<{ next?: LocalRouting; result: T }>): Promise<T> {
  return withLock(
    dir,
    async () => {
      const { next, result } = await change(await readLocalRouting(dir))
      if (next) await writeLocalRouting(dir, next)
      return result
    },
    LOCK_NAME
  )
}

/** The automatic moves of one provider, in the shape `resolveRoute` takes. */
export function autoKindsFor(local: LocalRouting, provider: RoutingProvider): AutoKinds {
  const auto: AutoKinds = {}
  for (const kind of TASK_KINDS) {
    const entry = local.kinds[kind]?.[provider]
    if (entry) auto[kind] = { tier: entry.tier }
  }
  return auto
}

/** The moves of the layer as a flat list, in task-kind order. */
export function listLocalAdjustments(local: LocalRouting): { kind: TaskKind; provider: RoutingProvider; adjustment: LocalAdjustment }[] {
  return TASK_KINDS.flatMap((kind) => ROUTING_PROVIDERS.flatMap((provider) => (local.kinds[kind]?.[provider] ? [{ kind, provider, adjustment: local.kinds[kind]![provider]! }] : [])))
}

/** The holds of the layer as a flat list, in task-kind order. */
export function listLocalHolds(local: LocalRouting): { kind: TaskKind; provider: RoutingProvider; hold: LocalHold }[] {
  return TASK_KINDS.flatMap((kind) => ROUTING_PROVIDERS.flatMap((provider) => (local.holds[kind]?.[provider] ? [{ kind, provider, hold: local.holds[kind]![provider]! }] : [])))
}

/** Append to the bounded log, newest last. */
export function withLogEntry(state: LocalRouting, entry: LocalLogEntry): LocalRouting {
  return { ...state, log: [...state.log, entry].slice(-ROUTING_LOG_LIMIT) }
}

/**
 * The tier agents whose text would change if the local moves were applied: they are rendered from the
 * shared routing (a tracked file must not change with one clone's measurements), so a local move leaves
 * their "use for / do not use for" lines behind until it is promoted and the agents are refreshed.
 * `sf agents route` is the authority either way.
 */
export function staleTierAgentPaths(agents: readonly HarnessAgent[], shared: RoutingOverrides | undefined, local: LocalRouting): string[] {
  const declared = ROUTING_PROVIDERS.filter((candidate) => agents.includes(candidate))
  const auto = Object.fromEntries(declared.map((provider) => [provider, autoKindsFor(local, provider)]))
  if (!Object.values(auto).some((kinds) => Object.keys(kinds).length)) return []
  const committed = new Map(renderTierAgents(declared, shared).map((file) => [file.path, file.content]))
  const effective = new Map(renderTierAgents(declared, shared, auto).map((file) => [file.path, file.content]))
  const paths = new Set([...committed.keys(), ...effective.keys()])
  return [...paths].filter((path) => committed.get(path) !== effective.get(path)).sort()
}
