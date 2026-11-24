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

const KNOWN_KEYS: readonly string[] = ['version', 'kinds', 'boundaries', 'holds', 'ladders', 'log']
type Section = 'kinds' | 'boundaries' | 'holds' | 'ladders'

/**
 * What the file holds that this CLI does not read (#1309): a provider, a task kind, a key or a log action a
 * newer CLI wrote, or an entry whose shape this CLI does not know. The worktrees of one clone share the
 * file, so two CLI versions reading it is the normal state during a delivery that changes the routing: the
 * older one skips these entries, applies the rest, and writes them back untouched.
 */
interface ForeignParts {
  top: Record<string, unknown>
  sections: Record<Section, Record<string, unknown>>
  log: Record<string, unknown>[]
}

const emptyForeign = (): ForeignParts => ({ top: {}, sections: { kinds: {}, boundaries: {}, holds: {}, ladders: {} }, log: [] })

/** The layer this CLI applies, what it skipped (named by path) and the skipped parts, kept for the next write. */
interface ParsedLocalRouting {
  state: LocalRouting
  skipped: string[]
  foreign: ForeignParts
}

const isHold = (hold: unknown): boolean => object(hold) && typeof hold.reason === 'string' && typeof hold.since === 'string' && ISO_MILLIS.test(hold.since)
const isLadderEntry = (entry: unknown): boolean =>
  object(entry) && typeof entry.candidate === 'string' && typeof entry.since === 'string' && ISO_MILLIS.test(entry.since) && ['new', 'accepted'].includes(String(entry.status))
const isAdjustment = (entry: unknown): boolean =>
  object(entry) &&
  typeof entry.tier === 'string' &&
  TIER.test(entry.tier) &&
  typeof entry.from === 'string' &&
  TIER.test(entry.from) &&
  ['escalate', 'deescalate'].includes(String(entry.action)) &&
  typeof entry.at === 'string' &&
  ISO_MILLIS.test(entry.at) &&
  object(entry.evidence)
const isBoundary = (at: unknown): boolean => typeof at === 'string' && ISO_MILLIS.test(at)

/**
 * Parse the layer. Only a file that cannot be the layer at all is refused: not JSON, another version, or
 * without its sections. An entry this CLI does not know is skipped, never the whole file (#1309).
 */
function parseLocalRouting(text: string, path: string): ParsedLocalRouting {
  const fail = (detail: string): never => {
    throw new Error(`Invalid local routing in ${path} (${detail}). It only caches the automatic moves of this clone: delete the file to start over.`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('not JSON')
  }
  if (object(value) && typeof value.version === 'number' && value.version > LOCAL_VERSION) {
    throw new Error(`The local routing in ${path} was written by a newer CLI (version ${value.version}; this CLI reads version ${LOCAL_VERSION}). Upgrade this CLI to apply it.`)
  }
  if (!object(value) || value.version !== LOCAL_VERSION) return fail(`expected version ${LOCAL_VERSION}`)
  if (!object(value.kinds) || !object(value.boundaries) || !Array.isArray(value.log)) return fail('kinds, boundaries and log are required')
  // A layer written before holds and ladders existed has neither: both start empty.
  const holds = value.holds === undefined ? {} : value.holds
  const ladders = value.ladders === undefined ? {} : value.ladders
  if (!object(holds) || !object(ladders)) return fail('holds and ladders must be objects')

  const foreign = emptyForeign()
  const skipped: string[] = []
  for (const key of Object.keys(value)) {
    if (KNOWN_KEYS.includes(key)) continue
    foreign.top[key] = value[key]
    skipped.push(key)
  }

  /** Keep the known entries of a two-level section (`outer.inner`); set the others aside, by path. */
  const section = (
    name: Section,
    raw: Record<string, unknown>,
    isOuter: (key: string) => boolean,
    isInner: (key: string) => boolean,
    valid: (entry: unknown) => boolean
  ): Record<string, Record<string, unknown>> => {
    const kept: Record<string, Record<string, unknown>> = {}
    for (const [outer, inner] of Object.entries(raw)) {
      if (!isOuter(outer) || !object(inner)) {
        foreign.sections[name][outer] = inner
        skipped.push(`${name}.${outer}`)
        continue
      }
      for (const [key, entry] of Object.entries(inner)) {
        if (isInner(key) && valid(entry)) {
          ;(kept[outer] ??= {})[key] = entry
          continue
        }
        const aside = (foreign.sections[name][outer] ??= {}) as Record<string, unknown>
        aside[key] = entry
        skipped.push(`${name}.${outer}.${key}`)
      }
    }
    return kept
  }

  const state: LocalRouting = {
    version: LOCAL_VERSION,
    kinds: section('kinds', value.kinds, isKind, isRoutingProvider, isAdjustment) as LocalRouting['kinds'],
    boundaries: section('boundaries', value.boundaries, isKind, isRoutingProvider, isBoundary) as LocalRouting['boundaries'],
    holds: section('holds', holds, isKind, isRoutingProvider, isHold) as LocalRouting['holds'],
    ladders: section('ladders', ladders, isRoutingProvider, (tier) => TIER.test(tier), isLadderEntry) as LocalRouting['ladders'],
    log: []
  }
  for (const entry of value.log) {
    if (object(entry) && isKind(entry.kind) && typeof entry.at === 'string' && LOG_ACTIONS.includes(String(entry.action))) {
      state.log.push(entry as unknown as LocalLogEntry)
      continue
    }
    // A log line kept for the next write needs its time, to stay in order; one without it is dropped there.
    if (object(entry)) foreign.log.push(entry)
    skipped.push('log entry')
  }
  return { state, skipped: [...new Set(skipped)], foreign }
}

async function readParsedLocalRouting(dir: string): Promise<ParsedLocalRouting> {
  const path = localRoutingPath(dir)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file for the local routing layer, not a link or directory: ${path}`)
    return parseLocalRouting(await readFile(path, 'utf8'), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyLocalRouting(), skipped: [], foreign: emptyForeign() }
    throw error
  }
}

/** The clone's local layer; an absent file is an empty layer. Entries this CLI does not know are left out (see `readLocalRoutingWithSkipped`). */
export async function readLocalRouting(dir: string): Promise<LocalRouting> {
  return (await readParsedLocalRouting(dir)).state
}

/** The clone's local layer, and the paths of the entries this CLI left out because it does not know them. */
export async function readLocalRoutingWithSkipped(dir: string): Promise<{ local: LocalRouting; skipped: string[] }> {
  const { state, skipped } = await readParsedLocalRouting(dir)
  return { local: state, skipped }
}

/** The one-line notice naming what an older CLI skipped in the layer; undefined when it skipped nothing. */
export function skippedLocalRoutingNotice(skipped: readonly string[]): string | undefined {
  if (!skipped.length) return undefined
  const shown = skipped.slice(0, 5).join(', ')
  const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : ''
  return `the local routing cache holds entries this CLI does not know (${shown}${more}), probably written by a newer CLI: they are kept, not applied.`
}

/** The layer to write: `state`, with the parts this CLI did not read put back where they were; what `state` says wins. */
function withForeign(state: LocalRouting, foreign: ForeignParts): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...state, ...foreign.top }
  for (const name of ['kinds', 'boundaries', 'holds', 'ladders'] as const) {
    const aside = foreign.sections[name]
    if (!Object.keys(aside).length) continue
    const out: Record<string, unknown> = { ...aside }
    for (const [outer, inner] of Object.entries(state[name] as Record<string, Record<string, unknown>>)) {
      const kept = aside[outer]
      out[outer] = object(kept) ? { ...kept, ...inner } : inner
    }
    merged[name] = out
  }
  if (foreign.log.length) {
    const lines = [...state.log, ...foreign.log.filter((entry) => typeof entry.at === 'string')] as { at: string }[]
    // Stable: entries of one time keep their order, known ones first.
    merged.log = lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-ROUTING_LOG_LIMIT)
  }
  return merged
}

async function writeLocalRouting(dir: string, state: Record<string, unknown>): Promise<void> {
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
 * each other's move. `change` returns the next state, or undefined to leave the file as it is. The entries
 * this CLI does not know are written back as they were (#1309): a newer CLI sharing the clone keeps them.
 */
export async function updateLocalRouting<T>(dir: string, change: (state: LocalRouting) => { next?: LocalRouting; result: T } | Promise<{ next?: LocalRouting; result: T }>): Promise<T> {
  return withLock(
    dir,
    async () => {
      const { state, foreign } = await readParsedLocalRouting(dir)
      const { next, result } = await change(state)
      if (next) await writeLocalRouting(dir, withForeign(next, foreign))
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
