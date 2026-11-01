import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { lstat, mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'

import { costOfUsage, type ModelPrice, type PricedCost, type TokenUsage } from './model-prices'
import { resolveGitCommonDir } from './git-agent-scope'
import { ROUTING_PROVIDERS, TASK_KINDS, tierRank, type RoutingProvider, type TaskKind } from './routing-grid'
import { CHECKS, OUTCOMES, SECRET_LIKE, type ExecutionActualOutcomeCode } from '../execution/calibration'
import { ExactRational, exactCostEvidence } from '../execution/exact-cost'

/**
 * The delegation ledger (#1035, FR-AEX-014): one append-only JSONL file that records what every routed
 * delegation cost and whether it did the job. The routing adjusts itself from it, so it has to be
 * trustworthy more than clever:
 *
 * - it lives in the Git **common** directory, so every worktree of a clone (one per delegated ticket,
 *   #1026) appends to and reads the same history, and Git never tracks it;
 * - it is only ever appended to, under a lock, with mode 0600; a later signal (rework, a Human Testing
 *   defect) is a new line, never an edit of an old one;
 * - a measurement that is missing is recorded as `outcome-unknown`: it is censored, never a success;
 * - what the delegate declares about itself is not what the routing acts on: the task kind, the tier,
 *   the ticket and whether the run is a trial come from the **route record** `sf agents route` issued,
 *   which the delegate only echoes.
 *
 * Five kinds of line: `run` (one per stop of an agent: a resumed agent adds a segment), `route` (a route
 * issued, which doubles as the reservation of a trial), `detail` (what the host's tool result adds to a
 * run), `signal` (a later verdict) and `status` (a ticket changed status, for the duration of a ticket).
 *
 * It reuses the outcome codes, check codes and secret filter of the execution calibration library
 * (`src/execution/calibration.ts`), whose records need a planner binding a harness delegation does not
 * have: faking those fingerprints would produce evidence that looks authenticated and is not.
 */
export const LEDGER_VERSION = 1
export const LEDGER_DIR = 'saasfoundry'
export const LEDGER_FILE = 'delegations.jsonl'
const SPOOL_DIR = 'delegations.spool'
const LOCK_FILE = 'delegations.lock'
const LOCK_WAIT_MS = 5_000
/** A lock older than this is broken even when its pid looks alive (the pid may have been reused). */
const LOCK_HARD_STALE_MS = 10 * 60_000

export const LEDGER_HOSTS = ['claude-code', 'codex', 'manual'] as const
export type LedgerHost = (typeof LEDGER_HOSTS)[number]
export const COMPLEXITIES = ['bug', 'low', 'medium', 'complex'] as const
export type Complexity = (typeof COMPLEXITIES)[number]
export const NATURES = ['user-facing', 'internal', 'bundled-pr'] as const
export type Nature = (typeof NATURES)[number]
export const OUTCOME_SIGNALS = ['rework', 'human-defect'] as const
export type OutcomeSignal = (typeof OUTCOME_SIGNALS)[number]
export const METERING_STATES = ['complete', 'partial', 'unknown'] as const
export type Metering = (typeof METERING_STATES)[number]

/**
 * How long a route stays reserved for a run that has not been recorded yet. A delegated ticket runs for hours,
 * perhaps across sessions, and its first stop must not find its reservation gone: seven days. A route nobody used
 * by then was abandoned, and a first stop that lands after it is censored (`route-expired`).
 */
export const ROUTE_RESERVATION_MS = 7 * 24 * 60 * 60_000

const OUTCOME_ALIASES: Record<string, ExecutionActualOutcomeCode> = { pass: 'success', fail: 'validation-failed' }
const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TIER = /^[a-z][a-z0-9-]*$/
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const EFFORT = /^[a-z]{1,16}$/
const ID = /^[0-9a-f]{20}$/
const AGENT_ID = /^[0-9a-f]{16}$/
const SAFE_TEXT = /^[^\0\r\n\u001b]{1,200}$/
const MAX_REFS = 32
const MAX_TOKENS = 1e12
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_OFFSET = 2 ** 50

export interface DelegationRunRecord {
  v: 1
  type: 'run'
  /** Stable for a host event (the same stop seen twice is one run), random for a manual record. */
  id: string
  /** The host's own key of the event, when it has one: what makes a repeated capture idempotent. */
  eventKey: string | null
  /** When the delegation stopped, ISO-8601 with milliseconds. */
  at: string
  host: LedgerHost
  /** The host's agent id, hashed: every stop of one agent, a resumed one included, carries the same. */
  agentId: string | null
  /** The bytes of the agent's transcript this stop accounts for; the next stop of the agent starts where this one ended. */
  segment: { from: number; to: number } | null
  /** The earlier segment of the same agent this stop resumes. */
  continues: string | null
  /** The earlier run (or route) this run retries on a higher tier. */
  retryOf: string | null
  /** The route record the delegate echoed: where the task kind, the ticket and the trial flag come from. */
  route: string | null
  ticket: number | null
  /** Null when no route says what the delegate was doing: the run is kept, but censored. */
  taskKind: TaskKind | null
  complexity: Complexity | null
  nature: Nature | null
  provider: RoutingProvider
  tier: string
  candidate: { model: string | null; effort: string | null }
  /** The route offered this tier as a sample of a cheaper (or a new) candidate than the one the kind is routed to. */
  trial: boolean
  /** Active time of this stop: the time the agent worked, the idle time between a stop and its resume left out. */
  durationMs: number | null
  tokens: TokenUsage | null
  cost: PricedCost | null
  metering: Metering
  outcome: ExecutionActualOutcomeCode
  checks: string[]
  evidenceRefs: string[]
}

export interface DelegationSignalRecord {
  v: 1
  type: 'signal'
  id: string
  at: string
  /** A run by id, or the runs of a ticket (optionally of one task kind) that were done by then. */
  target: { run: string } | { ticket: number; taskKind: TaskKind | null }
  signal: OutcomeSignal
  note: string | null
}

/** A route `sf agents route` issued for a ticket: the delegate echoes its id, and until a run claims it the route reserves its trial. */
export interface DelegationRouteRecord {
  v: 1
  type: 'route'
  id: string
  at: string
  expiresAt: string
  taskKind: TaskKind
  provider: RoutingProvider
  tier: string
  trial: boolean
  ticket: number | null
  complexity: Complexity | null
  nature: Nature | null
  retryOf: string | null
}

/** What the host's tool result says about an agent (its own measure of the duration, the resolved model, a failed status). */
export interface DelegationDetailRecord {
  v: 1
  type: 'detail'
  id: string
  at: string
  host: LedgerHost
  agentId: string
  durationMs: number | null
  model: string | null
  status: string | null
}

/** A ticket changed status: the duration of a ticket runs from its first In progress to its first Human Testing. */
export interface TicketStatusRecord {
  v: 1
  type: 'status'
  id: string
  at: string
  ticket: number
  status: string
}

export type LedgerEntry = DelegationRunRecord | DelegationSignalRecord | DelegationRouteRecord | DelegationDetailRecord | TicketStatusRecord

export class LedgerValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid delegation record: ${issues.join('; ')}`)
    this.name = 'LedgerValidationError'
    this.issues = [...issues]
  }
}

export class LedgerLockTimeout extends Error {
  constructor() {
    super('The delegation ledger is locked by another process (delegations.lock). Retry in a moment.')
    this.name = 'LedgerLockTimeout'
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isTaskKind = (value: unknown): value is TaskKind => typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value)
const isProvider = (value: unknown): value is RoutingProvider => typeof value === 'string' && (ROUTING_PROVIDERS as readonly string[]).includes(value)
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
const count = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
const safeText = (value: unknown): value is string => typeof value === 'string' && SAFE_TEXT.test(value) && !SECRET_LIKE.test(value)
const iso = (value: unknown): value is string => typeof value === 'string' && ISO_MILLIS.test(value) && !Number.isNaN(Date.parse(value))
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const newId = (): string => randomUUID().replace(/-/g, '').slice(0, 20)

/** The 16-hex token an agent id is stored as: a host id is never recorded as it came. */
export const agentToken = (hostAgentId: string): string => hash(`agent:${hostAgentId}`).slice(0, 16)

function checkList(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length > CHECKS.length || value.some((entry) => !isOneOf(CHECKS, entry)) || new Set(value).size !== value.length)
    issues.push(`${label} must list distinct check codes (${CHECKS.join(', ')})`)
}

function refList(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length > MAX_REFS || value.some((entry) => !safeText(entry))) issues.push(`${label} must list at most ${MAX_REFS} short, non-secret references`)
}

const RUN_FIELDS = [
  'v',
  'type',
  'id',
  'eventKey',
  'at',
  'host',
  'agentId',
  'segment',
  'continues',
  'retryOf',
  'route',
  'ticket',
  'taskKind',
  'complexity',
  'nature',
  'provider',
  'tier',
  'candidate',
  'trial',
  'durationMs',
  'tokens',
  'cost',
  'metering',
  'outcome',
  'checks',
  'evidenceRefs'
]
/** Fields a line written before they existed may lack: they read as null. */
const OPTIONAL_RUN_FIELDS = ['agentId', 'segment', 'continues', 'retryOf', 'route']

/** Validate a run as it is written or read; throws every issue at once. */
export function assertRunRecord(value: unknown): asserts value is DelegationRunRecord {
  const issues: string[] = []
  if (!object(value)) throw new LedgerValidationError(['a run must be an object'])
  const extra = Object.keys(value).filter((key) => !RUN_FIELDS.includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'run') issues.push(`a run is { v: ${LEDGER_VERSION}, type: 'run' }`)
  if (typeof value.id !== 'string' || !ID.test(value.id)) issues.push('id must be 20 hex characters')
  if (value.eventKey !== null && !safeText(value.eventKey)) issues.push('eventKey must be null or a short, non-secret key')
  if (!iso(value.at)) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!isOneOf(LEDGER_HOSTS, value.host)) issues.push(`host must be ${LEDGER_HOSTS.join(', ')}`)
  if (value.agentId !== null && value.agentId !== undefined && !(typeof value.agentId === 'string' && AGENT_ID.test(value.agentId))) issues.push('agentId must be null or 16 hex characters')
  const segment = value.segment
  if (
    segment !== null &&
    segment !== undefined &&
    !(object(segment) && Object.keys(segment).length === 2 && count(segment.from, MAX_OFFSET) && count(segment.to, MAX_OFFSET) && Number(segment.to) >= Number(segment.from))
  )
    issues.push('segment must be null or { from, to } byte offsets')
  for (const key of ['continues', 'route'] as const)
    if (value[key] !== null && value[key] !== undefined && !(typeof value[key] === 'string' && ID.test(value[key]))) issues.push(`${key} must be null or an id`)
  if (value.retryOf !== null && value.retryOf !== undefined && !(typeof value.retryOf === 'string' && ID.test(value.retryOf))) issues.push('retryOf must be null or an id')
  if (value.ticket !== null && !(typeof value.ticket === 'number' && Number.isSafeInteger(value.ticket) && value.ticket > 0)) issues.push('ticket must be null or a positive integer')
  if (value.taskKind !== null && !isTaskKind(value.taskKind)) issues.push(`taskKind must be null or one of ${TASK_KINDS.join(', ')}`)
  if (value.complexity !== null && !isOneOf(COMPLEXITIES, value.complexity)) issues.push(`complexity must be null or one of ${COMPLEXITIES.join(', ')}`)
  if (value.nature !== null && !isOneOf(NATURES, value.nature)) issues.push(`nature must be null or one of ${NATURES.join(', ')}`)
  if (!isProvider(value.provider)) issues.push(`provider must be a routed coding agent (${ROUTING_PROVIDERS.join(', ')})`)
  if (typeof value.tier !== 'string' || !TIER.test(value.tier)) issues.push('tier must be a lowercase identifier')
  const candidate = value.candidate
  if (!object(candidate) || Object.keys(candidate).some((key) => key !== 'model' && key !== 'effort')) issues.push('candidate must be { model, effort }')
  else {
    if (candidate.model !== null && !(typeof candidate.model === 'string' && MODEL_ID.test(candidate.model))) issues.push('candidate.model must be null or a model identifier')
    if (candidate.effort !== null && !(typeof candidate.effort === 'string' && EFFORT.test(candidate.effort))) issues.push('candidate.effort must be null or an effort name')
  }
  if (typeof value.trial !== 'boolean') issues.push('trial must be a boolean')
  if (value.durationMs !== null && !count(value.durationMs, MAX_DURATION_MS)) issues.push('durationMs must be null or a bounded non-negative integer')
  if (value.tokens !== null) {
    const tokens = value.tokens
    if (!object(tokens) || Object.keys(tokens).length !== 4 || !(['input', 'output', 'cacheRead', 'cacheWrite'] as const).every((key) => count(tokens[key], MAX_TOKENS)))
      issues.push('tokens must be null or { input, output, cacheRead, cacheWrite } counts')
  }
  if (value.cost !== null) {
    const cost = value.cost
    if (!object(cost) || Object.keys(cost).length !== 2 || typeof cost.amount !== 'string' || !/^\d+(?:\.\d{1,12})?$/.test(cost.amount) || cost.currency !== 'USD')
      issues.push('cost must be null or { amount: decimal string, currency: USD }')
  }
  if (!isOneOf(METERING_STATES, value.metering)) issues.push(`metering must be ${METERING_STATES.join(', ')}`)
  if (!isOneOf(OUTCOMES as readonly string[], value.outcome)) issues.push(`outcome must be one of ${OUTCOMES.join(', ')}`)
  checkList(value.checks, 'checks', issues)
  refList(value.evidenceRefs, 'evidenceRefs', issues)
  if (issues.length) throw new LedgerValidationError(issues)
}

export function assertSignalRecord(value: unknown): asserts value is DelegationSignalRecord {
  const issues: string[] = []
  if (!object(value)) throw new LedgerValidationError(['a signal must be an object'])
  const extra = Object.keys(value).filter((key) => !['v', 'type', 'id', 'at', 'target', 'signal', 'note'].includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'signal') issues.push(`a signal is { v: ${LEDGER_VERSION}, type: 'signal' }`)
  if (typeof value.id !== 'string' || !ID.test(value.id)) issues.push('id must be 20 hex characters')
  if (!iso(value.at)) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!isOneOf(OUTCOME_SIGNALS, value.signal)) issues.push(`signal must be ${OUTCOME_SIGNALS.join(' or ')}`)
  if (value.note !== null && !safeText(value.note)) issues.push('note must be null or a short, non-secret text')
  const target = value.target
  if (!object(target)) issues.push('target must be { run } or { ticket, taskKind }')
  else if ('run' in target) {
    if (Object.keys(target).length !== 1 || typeof target.run !== 'string' || !ID.test(target.run)) issues.push('target.run must be a run id')
  } else if (Object.keys(target).some((key) => key !== 'ticket' && key !== 'taskKind') || !(typeof target.ticket === 'number' && Number.isSafeInteger(target.ticket) && target.ticket > 0)) {
    issues.push('target must be { run } or { ticket, taskKind }')
  } else if (target.taskKind !== null && !isTaskKind(target.taskKind)) issues.push('target.taskKind must be null or a task kind')
  if (issues.length) throw new LedgerValidationError(issues)
}

export function assertRouteRecord(value: unknown): asserts value is DelegationRouteRecord {
  const issues: string[] = []
  if (!object(value)) throw new LedgerValidationError(['a route must be an object'])
  const fields = ['v', 'type', 'id', 'at', 'expiresAt', 'taskKind', 'provider', 'tier', 'trial', 'ticket', 'complexity', 'nature', 'retryOf']
  const extra = Object.keys(value).filter((key) => !fields.includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'route') issues.push(`a route is { v: ${LEDGER_VERSION}, type: 'route' }`)
  if (typeof value.id !== 'string' || !ID.test(value.id)) issues.push('id must be 20 hex characters')
  if (!iso(value.at) || !iso(value.expiresAt)) issues.push('at and expiresAt must be ISO-8601 UTC times with milliseconds')
  if (!isTaskKind(value.taskKind)) issues.push(`taskKind must be one of ${TASK_KINDS.join(', ')}`)
  if (!isProvider(value.provider)) issues.push(`provider must be a routed coding agent (${ROUTING_PROVIDERS.join(', ')})`)
  if (typeof value.tier !== 'string' || !TIER.test(value.tier)) issues.push('tier must be a lowercase identifier')
  if (typeof value.trial !== 'boolean') issues.push('trial must be a boolean')
  if (value.ticket !== null && !(typeof value.ticket === 'number' && Number.isSafeInteger(value.ticket) && value.ticket > 0)) issues.push('ticket must be null or a positive integer')
  if (value.complexity !== null && !isOneOf(COMPLEXITIES, value.complexity)) issues.push(`complexity must be null or one of ${COMPLEXITIES.join(', ')}`)
  if (value.nature !== null && !isOneOf(NATURES, value.nature)) issues.push(`nature must be null or one of ${NATURES.join(', ')}`)
  if (value.retryOf !== null && !(typeof value.retryOf === 'string' && ID.test(value.retryOf))) issues.push('retryOf must be null or an id')
  if (issues.length) throw new LedgerValidationError(issues)
}

export function assertDetailRecord(value: unknown): asserts value is DelegationDetailRecord {
  const issues: string[] = []
  if (!object(value)) throw new LedgerValidationError(['a detail must be an object'])
  const extra = Object.keys(value).filter((key) => !['v', 'type', 'id', 'at', 'host', 'agentId', 'durationMs', 'model', 'status'].includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'detail') issues.push(`a detail is { v: ${LEDGER_VERSION}, type: 'detail' }`)
  if (typeof value.id !== 'string' || !ID.test(value.id)) issues.push('id must be 20 hex characters')
  if (!iso(value.at)) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!isOneOf(LEDGER_HOSTS, value.host)) issues.push(`host must be ${LEDGER_HOSTS.join(', ')}`)
  if (!(typeof value.agentId === 'string' && AGENT_ID.test(value.agentId))) issues.push('agentId must be 16 hex characters')
  if (value.durationMs !== null && !count(value.durationMs, MAX_DURATION_MS)) issues.push('durationMs must be null or a bounded non-negative integer')
  if (value.model !== null && !(typeof value.model === 'string' && MODEL_ID.test(value.model))) issues.push('model must be null or a model identifier')
  if (value.status !== null && !(typeof value.status === 'string' && /^[a-z_-]{1,40}$/.test(value.status))) issues.push('status must be null or a short status name')
  if (issues.length) throw new LedgerValidationError(issues)
}

export function assertStatusRecord(value: unknown): asserts value is TicketStatusRecord {
  const issues: string[] = []
  if (!object(value)) throw new LedgerValidationError(['a status must be an object'])
  const extra = Object.keys(value).filter((key) => !['v', 'type', 'id', 'at', 'ticket', 'status'].includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'status') issues.push(`a status is { v: ${LEDGER_VERSION}, type: 'status' }`)
  if (typeof value.id !== 'string' || !ID.test(value.id)) issues.push('id must be 20 hex characters')
  if (!iso(value.at)) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!(typeof value.ticket === 'number' && Number.isSafeInteger(value.ticket) && value.ticket > 0)) issues.push('ticket must be a positive integer')
  if (!(typeof value.status === 'string' && /^[a-z][a-z -]{0,40}$/.test(value.status))) issues.push('status must be a lowercase status name')
  if (issues.length) throw new LedgerValidationError(issues)
}

/** What a caller says about a run; everything not said is recorded as unknown. */
export interface RunInput {
  eventKey?: string | null
  at?: string
  host: LedgerHost
  agentId?: string | null
  segment?: { from: number; to: number } | null
  continues?: string | null
  retryOf?: string | null
  route?: string | null
  ticket?: number | null
  taskKind?: string | null
  complexity?: string | null
  nature?: string | null
  provider: string
  tier: string
  model?: string | null
  effort?: string | null
  trial?: boolean
  durationMs?: number | null
  tokens?: Partial<TokenUsage> | null
  /** The usage of each API call, when the host lists them: a model with a long-prompt rate is priced call by call. */
  calls?: readonly TokenUsage[] | null
  /** A library outcome code, or `pass` / `fail`. Absent means the outcome was not measured. */
  outcome?: string | null
  checks?: readonly string[]
  evidenceRefs?: readonly string[]
}

export interface BuildOptions {
  prices?: Record<string, ModelPrice>
  now?: () => Date
}

const runId = (eventKey: string | null): string => (eventKey ? hash(`run:${eventKey}`).slice(0, 20) : newId())

/** Turn what a host or a person said into a validated run: derive the metering and the cost, never invent a measurement. */
export function buildRunRecord(input: RunInput, options: BuildOptions = {}): DelegationRunRecord {
  const eventKey = input.eventKey ?? null
  const tokensGiven = input.tokens !== undefined && input.tokens !== null && (input.tokens.input !== undefined || input.tokens.output !== undefined)
  const tokens: TokenUsage | null = tokensGiven
    ? { input: input.tokens!.input ?? 0, output: input.tokens!.output ?? 0, cacheRead: input.tokens!.cacheRead ?? 0, cacheWrite: input.tokens!.cacheWrite ?? 0 }
    : null
  // A cost needs both sides of the usage: pricing half a count would understate the run.
  const tokensComplete = tokensGiven && input.tokens!.input !== undefined && input.tokens!.output !== undefined
  // A span the host measured longer than a week is a clock or a resume gap, not work: it is clamped, never dropped.
  // A negative one is no measurement at all and is refused.
  const durationMs = input.durationMs === undefined || input.durationMs === null ? null : Math.min(Math.trunc(input.durationMs), MAX_DURATION_MS)
  const model = input.model ?? null
  const priced = tokensComplete ? costOfUsage(model, { tokens, calls: input.calls }, options.prices) : { cost: null, partial: false }
  const outcome = input.outcome === undefined || input.outcome === null ? 'outcome-unknown' : (OUTCOME_ALIASES[input.outcome] ?? input.outcome)
  const record: DelegationRunRecord = {
    v: LEDGER_VERSION,
    type: 'run',
    id: runId(eventKey),
    eventKey,
    at: input.at ?? (options.now?.() ?? new Date()).toISOString(),
    host: input.host,
    agentId: input.agentId ?? null,
    segment: input.segment ?? null,
    continues: input.continues ?? null,
    retryOf: input.retryOf ?? null,
    route: input.route ?? null,
    ticket: input.ticket ?? null,
    taskKind: (input.taskKind ?? null) as TaskKind | null,
    complexity: (input.complexity ?? null) as Complexity | null,
    nature: (input.nature ?? null) as Nature | null,
    provider: input.provider as RoutingProvider,
    tier: input.tier,
    candidate: { model, effort: input.effort ?? null },
    trial: input.trial ?? false,
    durationMs,
    tokens,
    cost: priced.cost,
    metering: tokensComplete && durationMs !== null && !priced.partial ? 'complete' : tokens !== null || durationMs !== null ? 'partial' : 'unknown',
    outcome: outcome as ExecutionActualOutcomeCode,
    checks: [...(input.checks ?? [])],
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])]
  }
  assertRunRecord(record)
  return record
}

export function buildSignalRecord(input: { target: DelegationSignalRecord['target']; signal: string; note?: string | null; at?: string }, now: () => Date = () => new Date()): DelegationSignalRecord {
  const record: DelegationSignalRecord = {
    v: LEDGER_VERSION,
    type: 'signal',
    id: newId(),
    at: input.at ?? now().toISOString(),
    target: input.target,
    signal: input.signal as OutcomeSignal,
    note: input.note ?? null
  }
  assertSignalRecord(record)
  return record
}

export function buildRouteRecord(input: {
  taskKind: TaskKind
  provider: RoutingProvider
  tier: string
  trial: boolean
  ticket?: number | null
  complexity?: string | null
  nature?: string | null
  retryOf?: string | null
  now?: Date
}): DelegationRouteRecord {
  const now = input.now ?? new Date()
  const record: DelegationRouteRecord = {
    v: LEDGER_VERSION,
    type: 'route',
    id: newId(),
    at: now.toISOString(),
    expiresAt: new Date(now.getTime() + ROUTE_RESERVATION_MS).toISOString(),
    taskKind: input.taskKind,
    provider: input.provider,
    tier: input.tier,
    trial: input.trial,
    ticket: input.ticket ?? null,
    complexity: (input.complexity ?? null) as Complexity | null,
    nature: (input.nature ?? null) as Nature | null,
    retryOf: input.retryOf ?? null
  }
  assertRouteRecord(record)
  return record
}

/** Deterministic id: the same tool result seen twice is one detail. */
export function buildDetailRecord(
  input: { host: LedgerHost; agentId: string; durationMs?: number | null; model?: string | null; status?: string | null; at?: string },
  now: () => Date = () => new Date()
): DelegationDetailRecord {
  const durationMs = input.durationMs === undefined || input.durationMs === null ? null : Math.min(Math.trunc(input.durationMs), MAX_DURATION_MS)
  const record: DelegationDetailRecord = {
    v: LEDGER_VERSION,
    type: 'detail',
    id: hash(`detail:${input.host}:${input.agentId}:${durationMs}:${input.model ?? ''}:${input.status ?? ''}`).slice(0, 20),
    at: input.at ?? now().toISOString(),
    host: input.host,
    agentId: input.agentId,
    durationMs,
    model: input.model ?? null,
    status: input.status ?? null
  }
  assertDetailRecord(record)
  return record
}

export function buildStatusRecord(input: { ticket: number; status: string; at?: string }, now: () => Date = () => new Date()): TicketStatusRecord {
  const record: TicketStatusRecord = { v: LEDGER_VERSION, type: 'status', id: newId(), at: input.at ?? now().toISOString(), ticket: input.ticket, status: input.status.trim().toLowerCase() }
  assertStatusRecord(record)
  return record
}

// --- folding: what the append-only history says ----------------------------------------------------

export interface LedgerRun extends DelegationRunRecord {
  /** Later signals tied to this run. */
  signals: { signal: OutcomeSignal; at: string; note: string | null }[]
  /** A run that retried this one on a higher tier: this one did not do the job. */
  escalated: boolean
  /** A later stop of the same agent exists: this segment is part of the agent's work, and only the last segment is counted. */
  superseded: boolean
  /** Segments of the agent up to and including this one. */
  chainSegments: number
  /** The outcome the rates use: the agent's latest verdict, and a success the session reworked, a Human Testing defect or a retry on a higher tier is a failure. */
  effectiveOutcome: ExecutionActualOutcomeCode
  /** What a rate counts for this run: the cost of every segment of the agent (null when one has none), the active time of all of them. */
  countedCost: PricedCost | null
  countedDurationMs: number | null
  /** No usable outcome, no route to say what it was, or superseded: kept and reported, never counted as a success or a failure. */
  censored: boolean
  /** Counts toward the adjustment: rated, and recorded by a host hook (a run recorded by hand asks the routing nothing). */
  decisive: boolean
}

export interface LedgerRoute extends DelegationRouteRecord {
  /** The run that echoed this route, once there is one. */
  consumedBy: string | null
}

export interface LedgerState {
  runs: LedgerRun[]
  routes: LedgerRoute[]
  statuses: TicketStatusRecord[]
  /** Lines that were not valid records (a torn write, a hand edit): skipped, counted. */
  skipped: number
  /** Signals that matched no run. */
  unmatchedSignals: number
}

/** A rate counts a run only when its outcome is a verdict on the tier. An unavailable candidate says nothing about quality. */
export const RATED_OUTCOMES: readonly ExecutionActualOutcomeCode[] = ['success', 'execution-failed', 'validation-failed']

const rankMetering = (state: Metering): number => METERING_STATES.length - METERING_STATES.indexOf(state)
/** A verdict beats a tool status, which beats nothing: the same facts give the same outcome in any order. */
const OUTCOME_RANK: Record<string, number> = { success: 4, 'validation-failed': 4, 'candidate-unavailable': 3, 'execution-failed': 2, cancelled: 1, 'outcome-unknown': 0 }

/** Two sightings of one event, merged by facts, not by arrival: the order of the arguments does not change the result. */
function mergeRuns(first: DelegationRunRecord, second: DelegationRunRecord): DelegationRunRecord {
  const [base, later] = [first, second].sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : JSON.stringify(left) < JSON.stringify(right) ? -1 : 1))
  // A better-ranked outcome wins; two verdicts (or two unknowns) keep the earlier sighting's, in whichever order they arrive.
  const better = OUTCOME_RANK[later.outcome] > OUTCOME_RANK[base.outcome] ? later : base
  return {
    ...base,
    agentId: base.agentId ?? later.agentId,
    segment: base.segment ?? later.segment,
    continues: base.continues ?? later.continues,
    retryOf: base.retryOf ?? later.retryOf,
    route: base.route ?? later.route,
    ticket: base.ticket ?? later.ticket,
    taskKind: base.taskKind ?? later.taskKind,
    complexity: base.complexity ?? later.complexity,
    nature: base.nature ?? later.nature,
    candidate: { model: base.candidate.model ?? later.candidate.model, effort: base.candidate.effort ?? later.candidate.effort },
    trial: base.trial || later.trial,
    durationMs: base.durationMs ?? later.durationMs,
    tokens: base.tokens ?? later.tokens,
    cost: base.cost ?? later.cost,
    metering: rankMetering(base.metering) >= rankMetering(later.metering) ? base.metering : later.metering,
    outcome: better.outcome,
    checks: [...new Set([...base.checks, ...later.checks])],
    evidenceRefs: [...new Set([...base.evidenceRefs, ...later.evidenceRefs])]
  }
}

/** True when `later` adds a fact `base` lacks: otherwise a repeated event is a replay and nothing is appended. */
function addsInformation(base: DelegationRunRecord, later: DelegationRunRecord): boolean {
  const merged = mergeRuns(base, later)
  return JSON.stringify({ ...merged, at: base.at, id: base.id }) !== JSON.stringify(base)
}

function sumCosts(costs: (PricedCost | null)[]): PricedCost | null {
  if (!costs.length || costs.some((cost) => cost === null)) return null
  const total = costs.reduce((sum, cost) => sum.add(ExactRational.decimal(cost!.amount)), new ExactRational(0n))
  return { amount: exactCostEvidence(total, 'USD', 8).amount, currency: 'USD' }
}

const byTime = (left: { at: string; id: string }, right: { at: string; id: string }): number => (left.at < right.at ? -1 : left.at > right.at ? 1 : left.id.localeCompare(right.id))
const FAILED_TOOL_STATUS = new Set(['failed', 'error', 'timeout', 'timed_out'])
const CANCELLED_TOOL_STATUS = new Set(['killed', 'cancelled', 'canceled'])

export function foldLedger(entries: readonly LedgerEntry[], skipped = 0): LedgerState {
  const records = new Map<string, DelegationRunRecord>()
  const routeRecords = new Map<string, DelegationRouteRecord>()
  const details = new Map<string, DelegationDetailRecord>()
  const statuses = new Map<string, TicketStatusRecord>()
  const signals: DelegationSignalRecord[] = []
  for (const entry of entries) {
    if (entry.type === 'run') {
      const previous = records.get(entry.id)
      records.set(entry.id, previous ? mergeRuns(previous, entry) : entry)
    } else if (entry.type === 'route') routeRecords.set(entry.id, entry)
    else if (entry.type === 'detail') details.set(entry.id, entry)
    else if (entry.type === 'status') statuses.set(entry.id, entry)
    else signals.push(entry)
  }
  const runs: LedgerRun[] = [...records.values()].map((record) => ({
    ...record,
    signals: [],
    escalated: false,
    superseded: false,
    chainSegments: 1,
    effectiveOutcome: record.outcome,
    countedCost: record.cost,
    countedDurationMs: record.durationMs,
    censored: false,
    decisive: false
  }))
  runs.sort(byTime)
  const byId = new Map(runs.map((run) => [run.id, run]))

  // The stops of one agent are one piece of work: every segment keeps its own cost, the last one carries the sum.
  const chains = new Map<string, LedgerRun[]>()
  for (const run of runs) {
    if (!run.agentId) continue
    const key = `${run.host}:${run.agentId}`
    const chain = chains.get(key)
    if (chain) chain.push(run)
    else chains.set(key, [run])
  }
  for (const chain of chains.values()) chain.sort((left, right) => (left.segment?.to ?? 0) - (right.segment?.to ?? 0) || byTime(left, right))

  // What the host's tool result adds goes to the first segment, whichever line arrived first.
  for (const detail of [...details.values()].sort(byTime)) {
    const first = chains.get(`${detail.host}:${detail.agentId}`)?.[0]
    if (!first) continue
    if (detail.durationMs !== null) {
      first.durationMs = detail.durationMs
      first.countedDurationMs = detail.durationMs
    }
    if (detail.model && !first.candidate.model) first.candidate = { ...first.candidate, model: detail.model }
    if (detail.status && first.outcome === 'outcome-unknown') {
      if (FAILED_TOOL_STATUS.has(detail.status)) first.outcome = 'execution-failed'
      else if (CANCELLED_TOOL_STATUS.has(detail.status)) first.outcome = 'cancelled'
      first.effectiveOutcome = first.outcome
    }
  }

  const finals = new Map<string, LedgerRun>()
  for (const chain of chains.values()) {
    const last = chain[chain.length - 1]
    for (const run of chain) finals.set(run.id, last)
    last.chainSegments = chain.length
    if (chain.length === 1) continue
    for (const run of chain.slice(0, -1)) run.superseded = true
    // The agent's latest verdict is its outcome, and its cost is every segment's.
    last.effectiveOutcome = [...chain].reverse().find((run) => run.outcome !== 'outcome-unknown')?.outcome ?? last.outcome
    last.countedCost = sumCosts(chain.map((run) => run.cost))
    const spans = chain.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs]))
    last.countedDurationMs = spans.length ? spans.reduce((sum, span) => sum + span, 0) : null
  }
  const final = (run: LedgerRun): LedgerRun => finals.get(run.id) ?? run

  // A signal reaches the agent's final segment: by id, or the latest run of each kind of a ticket that was done by then.
  const byTicket = new Map<number, LedgerRun[]>()
  for (const run of runs) {
    if (run.ticket === null || run.taskKind === null || run.superseded) continue
    const list = byTicket.get(run.ticket)
    if (list) list.push(run)
    else byTicket.set(run.ticket, [run])
  }
  let unmatchedSignals = 0
  for (const signal of signals.sort(byTime)) {
    let matched: LedgerRun[] = []
    if ('run' in signal.target) {
      const target = byId.get(signal.target.run)
      matched = target ? [final(target)] : []
    } else {
      const latest = new Map<string, LedgerRun>()
      for (const run of byTicket.get(signal.target.ticket) ?? []) {
        if (run.at > signal.at || (signal.target.taskKind !== null && run.taskKind !== signal.target.taskKind)) continue
        latest.set(`${run.taskKind}/${run.provider}`, run)
      }
      matched = [...latest.values()]
    }
    if (!matched.length) unmatchedSignals++
    for (const run of matched) run.signals.push({ signal: signal.signal, at: signal.at, note: signal.note })
  }

  // A run that retries another on a higher tier says the other did not do the job. Only a link says so.
  const byRoute = new Map<string, LedgerRun>()
  for (const run of runs) if (run.route) byRoute.set(run.route, final(run))
  for (const run of runs) {
    if (!run.retryOf) continue
    const target = byId.has(run.retryOf) ? final(byId.get(run.retryOf)!) : byRoute.get(run.retryOf)
    if (target && target.provider === run.provider && tierRank(target.tier) >= 0 && tierRank(run.tier) > tierRank(target.tier)) target.escalated = true
  }

  for (const run of runs) {
    const retried = run.escalated || run.signals.length > 0
    run.effectiveOutcome = run.effectiveOutcome === 'success' && retried ? 'validation-failed' : run.effectiveOutcome
    run.censored = run.taskKind === null || run.superseded || !RATED_OUTCOMES.includes(run.effectiveOutcome)
    run.decisive = !run.censored && run.host !== 'manual'
  }

  const consumed = new Map<string, string>()
  for (const run of runs) if (run.route) consumed.set(run.route, run.id)
  const routes: LedgerRoute[] = [...routeRecords.values()].sort(byTime).map((route) => ({ ...route, consumedBy: consumed.get(route.id) ?? null }))
  return { runs, routes, statuses: [...statuses.values()].sort(byTime), skipped, unmatchedSignals }
}

// --- the file ---------------------------------------------------------------------------------------

export interface LedgerLocation {
  /** The directory the clone keeps its private harness state in: `<git-common-dir>/saasfoundry`. */
  dir: string
  file: string
}

export function ledgerLocation(dir: string): LedgerLocation {
  return { dir, file: join(dir, LEDGER_FILE) }
}

/** The ledger of the clone `root` belongs to, or undefined outside a Git checkout. */
export async function resolveLedgerDir(root: string): Promise<string | undefined> {
  const commonDir = await resolveGitCommonDir(root)
  return commonDir ? join(commonDir, LEDGER_DIR) : undefined
}

export async function requireLedgerDir(root: string): Promise<string> {
  const dir = await resolveLedgerDir(root)
  if (!dir) throw new Error('The delegation ledger is kept in the Git directory of the clone: run this from a Git checkout.')
  return dir
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A lock is broken only when its holder is gone: a dead pid, or a hold so old the pid must have been reused. */
async function lockIsStale(path: string): Promise<boolean> {
  const [content, info] = await Promise.all([readFile(path, 'utf8').catch(() => undefined), stat(path).catch(() => undefined)])
  if (content === undefined || !info) return false
  const pid = Number(content.split(':')[0])
  if (Date.now() - info.mtimeMs > LOCK_HARD_STALE_MS) return true
  return Number.isInteger(pid) && pid > 0 && !alive(pid)
}

/**
 * Remove a lock whose holder is gone. One breaker at a time (a guard file taken exclusively), and the
 * lock is judged stale again once the guard is held: a lock is never removed on a judgement another
 * breaker has already acted on, so a lock a writer has just taken is never freed from under it.
 */
async function breakStaleLock(path: string): Promise<void> {
  const guard = `${path}.breaking`
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(guard, 'wx', 0o600)
  } catch {
    // Another writer is breaking it; a guard its owner died holding is cleared after a while.
    const info = await stat(guard).catch(() => undefined)
    if (info && Date.now() - info.mtimeMs > 30_000) await unlink(guard).catch(() => undefined)
    return
  }
  try {
    if (await lockIsStale(path)) await unlink(path).catch(() => undefined)
  } finally {
    await handle.close()
    await unlink(guard).catch(() => undefined)
  }
}

/**
 * Run `action` holding an exclusive lock file in the clone-private directory. The ledger and the local
 * routing layer each take their own lock (`name`), so appending a run never waits for an adjustment to
 * be written. The lock names its holder (`pid:token`): a lock is broken only when that pid is gone (or the
 * hold is so old the pid must have been reused), and a holder releases only the lock that still carries its
 * own token, so a late release never frees somebody else's lock. A writer that cannot get the lock in
 * `waitMs` gets a `LedgerLockTimeout`.
 */
export async function withLock<T>(dir: string, action: () => Promise<T>, name = LOCK_FILE, waitMs = LOCK_WAIT_MS): Promise<T> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, name)
  const token = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try {
        await handle.writeFile(token)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await lockIsStale(path)) {
        await breakStaleLock(path)
        continue
      }
      if (Date.now() > deadline) throw new LedgerLockTimeout()
      await sleep(15 + Math.floor(Math.random() * 25))
    }
  }
  try {
    return await action()
  } finally {
    const held = await readFile(path, 'utf8').catch(() => undefined)
    if (held === token) await unlink(path).catch(() => undefined)
  }
}

async function regularFileText(file: string): Promise<string | undefined> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file for the delegation ledger, not a link or directory: ${file}`)
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseEntry(line: string): LedgerEntry | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (!object(value)) return undefined
    if (value.type === 'signal') assertSignalRecord(value)
    else if (value.type === 'route') assertRouteRecord(value)
    else if (value.type === 'detail') assertDetailRecord(value)
    else if (value.type === 'status') assertStatusRecord(value)
    else {
      // A line written before the segment fields existed reads them as null.
      for (const key of OPTIONAL_RUN_FIELDS) if (!(key in value)) value[key] = null
      assertRunRecord(value)
    }
    return value as unknown as LedgerEntry
  } catch {
    return undefined
  }
}

function parseLines(text: string | undefined): { entries: LedgerEntry[]; skipped: number } {
  const entries: LedgerEntry[] = []
  let skipped = 0
  if (!text) return { entries, skipped }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const entry = parseEntry(line)
    if (entry) entries.push(entry)
    else skipped++
  }
  return { entries, skipped }
}

/** The lines a writer left in the spool because the lock stayed taken: read by everyone, appended by the next lock holder. */
async function spooled(dir: string): Promise<{ entries: LedgerEntry[]; files: string[] }> {
  const spool = join(dir, SPOOL_DIR)
  const names = await readdir(spool).catch(() => [] as string[])
  const entries: LedgerEntry[] = []
  const files: string[] = []
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const entry = parseEntry(await readFile(join(spool, name), 'utf8').catch(() => ''))
    files.push(join(spool, name))
    if (entry) entries.push(entry)
  }
  return { entries, files }
}

/** The folded history of the ledger in `dir`; an absent ledger is an empty one. */
export async function readLedger(dir: string): Promise<LedgerState> {
  const { entries, skipped } = parseLines(await regularFileText(join(dir, LEDGER_FILE)))
  return foldLedger([...entries, ...(await spooled(dir)).entries], skipped)
}

async function appendLines(file: string, entries: readonly LedgerEntry[]): Promise<void> {
  if (!entries.length) return
  const handle = await open(file, 'a', 0o600)
  try {
    await handle.appendFile(entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''))
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export interface LedgerTransaction {
  /** The folded history as the lock holder sees it, spooled lines included. */
  state: LedgerState
  /** The lines behind it, for a what-if fold. */
  entries: readonly LedgerEntry[]
  /** Append a line; one that is already there (same type and id) is not appended twice, except a run, whose repeat is merged by the fold. */
  append(entry: LedgerEntry): void
}

const keyOf = (entry: LedgerEntry): string => `${entry.type}:${entry.id}`

/**
 * Read the ledger, decide, and append, all under the lock: a decision that depends on the history (a
 * trial share, a replayed event) cannot be taken on a history another writer is changing. The lines the
 * action appends are written together; spooled lines are merged first.
 */
export async function transact<T>(dir: string, action: (transaction: LedgerTransaction) => Promise<T> | T, waitMs?: number): Promise<{ result: T; state: LedgerState }> {
  return withLock(
    dir,
    async () => {
      const file = join(dir, LEDGER_FILE)
      const { entries, skipped } = parseLines(await regularFileText(file))
      const drained = await spooled(dir)
      const inFile = new Set(entries.map(keyOf))
      const known = new Set([...inFile, ...drained.entries.map(keyOf)])
      // What the spool holds and the file does not is appended first; a spooled line is deleted only once it is.
      const pending: LedgerEntry[] = drained.entries.filter((entry, index, all) => !inFile.has(keyOf(entry)) && all.findIndex((other) => keyOf(other) === keyOf(entry)) === index)
      const transaction: LedgerTransaction = {
        state: foldLedger([...entries, ...drained.entries], skipped),
        entries: [...entries, ...drained.entries],
        append: (entry) => {
          if (entry.type !== 'run' && known.has(keyOf(entry))) return
          known.add(keyOf(entry))
          pending.push(entry)
        }
      }
      const result = await action(transaction)
      await appendLines(file, pending)
      await Promise.all(drained.files.map((spoolFile) => unlink(spoolFile).catch(() => undefined)))
      return { result, state: pending.length || drained.files.length ? foldLedger([...entries, ...pending], skipped) : transaction.state }
    },
    undefined,
    waitMs
  )
}

/** Leave a line in the spool when the lock stayed taken: it is merged by the next writer and read by everyone meanwhile. */
async function spool(dir: string, entry: LedgerEntry): Promise<void> {
  const spoolDir = join(dir, SPOOL_DIR)
  await mkdir(spoolDir, { recursive: true, mode: 0o700 })
  await writeFile(join(spoolDir, `${Date.now()}-${entry.type}-${entry.id}.json`), JSON.stringify(entry), { mode: 0o600, flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
}

async function appendOrSpool(dir: string, entry: LedgerEntry, write: () => Promise<void>): Promise<'written' | 'spooled'> {
  try {
    await write()
    return 'written'
  } catch (error) {
    if (!(error instanceof LedgerLockTimeout)) throw error
    await spool(dir, entry)
    return 'spooled'
  }
}

export interface AppendResult {
  /** `appended`: a new run. `merged`: a repeated event that added a fact. `replayed`: a repeated event, nothing new. `spooled`: the lock stayed taken and the line waits in the spool. */
  status: 'appended' | 'merged' | 'replayed' | 'spooled'
  id: string
  /** The folded history after the append, so the adjustment that follows folds nothing again. */
  state: LedgerState
}

/**
 * Append one run under the lock. A stop seen twice is one run: the second sighting only adds the facts
 * the first one lacked. A resumed agent's next stop has another key (its transcript offset) and is its
 * own run.
 */
export async function appendRun(dir: string, record: DelegationRunRecord, options: { waitMs?: number } = {}): Promise<AppendResult> {
  assertRunRecord(record)
  let status: AppendResult['status'] = 'appended'
  let id = record.id
  let state: LedgerState | undefined
  const outcome = await appendOrSpool(dir, record, async () => {
    const written = await transact(
      dir,
      ({ state: current, append }) => {
        const previous = current.runs.find((run) => run.id === record.id)
        if (previous && !addsInformation(previous, record)) {
          status = 'replayed'
          id = previous.id
          return
        }
        status = previous ? 'merged' : 'appended'
        id = previous?.id ?? record.id
        append({ ...record, id })
      },
      options.waitMs
    )
    state = written.state
  })
  if (outcome === 'spooled') return { status: 'spooled', id, state: await readLedger(dir) }
  return { status, id, state: state! }
}

export async function appendSignal(dir: string, record: DelegationSignalRecord, options: { waitMs?: number } = {}): Promise<{ id: string; matched: number; state: LedgerState }> {
  assertSignalRecord(record)
  let matched = 0
  let state: LedgerState | undefined
  const outcome = await appendOrSpool(dir, record, async () => {
    const written = await transact(
      dir,
      ({ state: current, entries, append }) => {
        const after = foldLedger([...entries, record])
        // Count the runs the signal reached: a signal that matches nothing is refused, not silently kept.
        const before = new Map(current.runs.map((run) => [run.id, run.signals.length]))
        matched = after.runs.filter((run) => run.signals.length > (before.get(run.id) ?? 0)).length
        if (!matched) throw new Error(describeUnmatched(record, current))
        append(record)
      },
      options.waitMs
    )
    state = written.state
  })
  return { id: record.id, matched, state: outcome === 'spooled' ? await readLedger(dir) : state! }
}

/** Append a detail or a status line; the same one twice is one line. */
export async function appendEntry(dir: string, entry: DelegationDetailRecord | TicketStatusRecord, options: { waitMs?: number } = {}): Promise<{ state: LedgerState; status: 'written' | 'spooled' }> {
  let state: LedgerState | undefined
  const status = await appendOrSpool(dir, entry, async () => {
    state = (await transact(dir, ({ append }) => append(entry), options.waitMs)).state
  })
  return { state: status === 'spooled' ? await readLedger(dir) : state!, status }
}

function describeUnmatched(record: DelegationSignalRecord, state: LedgerState): string {
  if ('run' in record.target) return `No delegation run ${record.target.run} in the ledger.`
  const ticket = record.target.ticket
  const known = state.runs.filter((run) => run.ticket === ticket).length
  return known ? `No run of ticket #${ticket}${record.target.taskKind ? ` for ${record.target.taskKind}` : ''} was recorded before now.` : `No delegation run is recorded for ticket #${ticket}.`
}

// --- cheap lookups for a capture: no fold of the whole ledger ---------------------------------------

/** Stream the ledger, handing every line that contains `needle` to `visit`: a lookup by id does not parse the whole history. */
async function scanLines(dir: string, needle: string, visit: (entry: LedgerEntry) => void): Promise<void> {
  const file = join(dir, LEDGER_FILE)
  const info = await lstat(file).catch(() => undefined)
  if (info?.isFile() && !info.isSymbolicLink()) {
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.includes(needle)) continue
      const entry = parseEntry(line)
      if (entry) visit(entry)
    }
  }
  for (const entry of (await spooled(dir)).entries) if (JSON.stringify(entry).includes(needle)) visit(entry)
}

/** The segments already recorded for one agent, oldest first: where the next stop of a resumed agent starts. */
export async function findAgentSegments(dir: string, host: LedgerHost, agentId: string): Promise<DelegationRunRecord[]> {
  const found = new Map<string, DelegationRunRecord>()
  await scanLines(dir, agentId, (entry) => {
    if (entry.type === 'run' && entry.host === host && entry.agentId === agentId) found.set(entry.id, entry)
  })
  return [...found.values()].sort((left, right) => (left.segment?.to ?? 0) - (right.segment?.to ?? 0) || byTime(left, right))
}

/** A route record with the agents whose runs already echoed it (null: a run recorded without an agent id). */
export interface FoundRoute extends DelegationRouteRecord {
  users: (string | null)[]
}

/** One route record by id, with who echoed it: a route belongs to one agent, whatever the stops it makes. */
export async function findRoute(dir: string, id: string): Promise<FoundRoute | undefined> {
  let route: DelegationRouteRecord | undefined
  const users = new Set<string | null>()
  await scanLines(dir, id, (entry) => {
    if (entry.type === 'route' && entry.id === id) route = entry
    else if (entry.type === 'run' && entry.route === id) users.add(entry.agentId)
  })
  return route ? { ...route, users: [...users] } : undefined
}
