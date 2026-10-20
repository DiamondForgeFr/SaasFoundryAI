import { createHash, randomUUID } from 'crypto'
import { lstat, mkdir, open, readFile, stat, unlink } from 'fs/promises'
import { join } from 'path'

import { costOfTokens, type ModelPrice, type PricedCost, type TokenUsage } from './model-prices'
import { resolveGitCommonDir } from './git-agent-scope'
import { ROUTING_PROVIDERS, TASK_KINDS, tierRank, type RoutingProvider, type TaskKind } from './routing-grid'
import { CHECKS, OUTCOMES, SECRET_LIKE, type ExecutionActualOutcomeCode } from '../execution/calibration'

/**
 * The delegation ledger (#1035, FR-AEX-014): one append-only JSONL file that records what every routed
 * delegation cost and whether it did the job. The routing adjusts itself from it, so it has to be
 * trustworthy more than clever:
 *
 * - it lives in the Git **common** directory, so every worktree of a clone (one per delegated ticket,
 *   #1026) appends to and reads the same history, and Git never tracks it;
 * - it is only ever appended to, under a lock, with mode 0600; a later signal (rework, a Human Testing
 *   defect) is a new line, never an edit of an old one;
 * - a measurement that is missing is recorded as `outcome-unknown`: it is censored, never a success.
 *
 * It reuses the outcome codes, check codes and secret filter of the execution calibration library
 * (`src/execution/calibration.ts`), whose records need a planner binding a harness delegation does not
 * have: faking those fingerprints would produce evidence that looks authenticated and is not.
 */
export const LEDGER_VERSION = 1
export const LEDGER_DIR = 'saasfoundry'
export const LEDGER_FILE = 'delegations.jsonl'
const LOCK_FILE = 'delegations.lock'
const LOCK_WAIT_MS = 5_000
const LOCK_STALE_MS = 30_000

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

const OUTCOME_ALIASES: Record<string, ExecutionActualOutcomeCode> = { pass: 'success', fail: 'validation-failed' }
const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TIER = /^[a-z][a-z0-9-]*$/
const SAFE_TEXT = /^[^\0\r\n]{1,200}$/
const MAX_REFS = 32
const MAX_TOKENS = 1e12
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export interface DelegationRunRecord {
  v: 1
  type: 'run'
  /** Stable for a host event (the same agent seen by two hooks is one run), random for a manual record. */
  id: string
  /** The host's own key of the event, when it has one: what makes a repeated capture idempotent. */
  eventKey: string | null
  /** When the delegation ended, ISO-8601 with milliseconds. */
  at: string
  host: LedgerHost
  ticket: number | null
  /** Null when the delegate did not say what it was doing: the run is kept, but censored. */
  taskKind: TaskKind | null
  complexity: Complexity | null
  nature: Nature | null
  provider: RoutingProvider
  tier: string
  candidate: { model: string | null; effort: string | null }
  /** The run tried a cheaper tier than the one the kind is routed to. */
  trial: boolean
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

export type LedgerEntry = DelegationRunRecord | DelegationSignalRecord

export class LedgerValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(`Invalid delegation record: ${issues.join('; ')}`)
    this.name = 'LedgerValidationError'
    this.issues = [...issues]
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isTaskKind = (value: unknown): value is TaskKind => typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value)
const isProvider = (value: unknown): value is RoutingProvider => typeof value === 'string' && (ROUTING_PROVIDERS as readonly string[]).includes(value)
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
const count = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
const safeText = (value: unknown): value is string => typeof value === 'string' && SAFE_TEXT.test(value) && !SECRET_LIKE.test(value)
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

function checkList(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.length > CHECKS.length || value.some((entry) => !isOneOf(CHECKS, entry)) || new Set(value).size !== value.length) {
    issues.push(`${label} must list distinct check codes (${CHECKS.join(', ')})`)
    return []
  }
  return [...value] as string[]
}

function refList(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFS || value.some((entry) => !safeText(entry))) {
    issues.push(`${label} must list at most ${MAX_REFS} short, non-secret references`)
    return []
  }
  return [...new Set(value as string[])]
}

/** Validate a run as it is written or read; throws every issue at once. */
export function assertRunRecord(value: unknown): asserts value is DelegationRunRecord {
  const issues: string[] = []
  const fields = [
    'v',
    'type',
    'id',
    'eventKey',
    'at',
    'host',
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
  if (!object(value)) throw new LedgerValidationError(['a run must be an object'])
  const extra = Object.keys(value).filter((key) => !fields.includes(key))
  if (extra.length) issues.push(`unknown field ${extra.join(', ')}`)
  if (value.v !== LEDGER_VERSION || value.type !== 'run') issues.push(`a run is { v: ${LEDGER_VERSION}, type: 'run' }`)
  if (typeof value.id !== 'string' || !/^[0-9a-f]{20}$/.test(value.id)) issues.push('id must be 20 hex characters')
  if (value.eventKey !== null && !safeText(value.eventKey)) issues.push('eventKey must be null or a short, non-secret key')
  if (typeof value.at !== 'string' || !ISO_MILLIS.test(value.at) || Number.isNaN(Date.parse(value.at))) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!isOneOf(LEDGER_HOSTS, value.host)) issues.push(`host must be ${LEDGER_HOSTS.join(', ')}`)
  if (value.ticket !== null && !(typeof value.ticket === 'number' && Number.isSafeInteger(value.ticket) && value.ticket > 0)) issues.push('ticket must be null or a positive integer')
  if (value.taskKind !== null && !isTaskKind(value.taskKind)) issues.push(`taskKind must be null or one of ${TASK_KINDS.join(', ')}`)
  if (value.complexity !== null && !isOneOf(COMPLEXITIES, value.complexity)) issues.push(`complexity must be null or one of ${COMPLEXITIES.join(', ')}`)
  if (value.nature !== null && !isOneOf(NATURES, value.nature)) issues.push(`nature must be null or one of ${NATURES.join(', ')}`)
  if (!isProvider(value.provider)) issues.push(`provider must be a routed coding agent (${ROUTING_PROVIDERS.join(', ')})`)
  if (typeof value.tier !== 'string' || !TIER.test(value.tier)) issues.push('tier must be a lowercase identifier')
  const candidate = value.candidate
  if (!object(candidate) || Object.keys(candidate).some((key) => key !== 'model' && key !== 'effort')) issues.push('candidate must be { model, effort }')
  else for (const key of ['model', 'effort'] as const) if (candidate[key] !== null && !safeText(candidate[key])) issues.push(`candidate.${key} must be null or a short identifier`)
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
  if (typeof value.id !== 'string' || !/^[0-9a-f]{20}$/.test(value.id)) issues.push('id must be 20 hex characters')
  if (typeof value.at !== 'string' || !ISO_MILLIS.test(value.at) || Number.isNaN(Date.parse(value.at))) issues.push('at must be an ISO-8601 UTC time with milliseconds')
  if (!isOneOf(OUTCOME_SIGNALS, value.signal)) issues.push(`signal must be ${OUTCOME_SIGNALS.join(' or ')}`)
  if (value.note !== null && !safeText(value.note)) issues.push('note must be null or a short, non-secret text')
  const target = value.target
  if (!object(target)) issues.push('target must be { run } or { ticket, taskKind }')
  else if ('run' in target) {
    if (Object.keys(target).length !== 1 || typeof target.run !== 'string' || !/^[0-9a-f]{20}$/.test(target.run)) issues.push('target.run must be a run id')
  } else if (Object.keys(target).some((key) => key !== 'ticket' && key !== 'taskKind') || !(typeof target.ticket === 'number' && Number.isSafeInteger(target.ticket) && target.ticket > 0)) {
    issues.push('target must be { run } or { ticket, taskKind }')
  } else if (target.taskKind !== null && !isTaskKind(target.taskKind)) issues.push('target.taskKind must be null or a task kind')
  if (issues.length) throw new LedgerValidationError(issues)
}

/** What a caller says about a run; everything not said is recorded as unknown. */
export interface RunInput {
  eventKey?: string | null
  at?: string
  host: LedgerHost
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
  /** A library outcome code, or `pass` / `fail`. Absent means the outcome was not measured. */
  outcome?: string | null
  checks?: readonly string[]
  evidenceRefs?: readonly string[]
}

export interface BuildOptions {
  prices?: Record<string, ModelPrice>
  now?: () => Date
}

const runId = (eventKey: string | null): string => (eventKey ? hash(`run:${eventKey}`).slice(0, 20) : randomUUID().replace(/-/g, '').slice(0, 20))

/** Turn what a host or a person said into a validated run: derive the metering and the cost, never invent a measurement. */
export function buildRunRecord(input: RunInput, options: BuildOptions = {}): DelegationRunRecord {
  const eventKey = input.eventKey ?? null
  const tokensGiven = input.tokens !== undefined && input.tokens !== null && (input.tokens.input !== undefined || input.tokens.output !== undefined)
  const tokens: TokenUsage | null = tokensGiven
    ? { input: input.tokens!.input ?? 0, output: input.tokens!.output ?? 0, cacheRead: input.tokens!.cacheRead ?? 0, cacheWrite: input.tokens!.cacheWrite ?? 0 }
    : null
  // A cost needs both sides of the usage: pricing half a count would understate the run.
  const tokensComplete = tokensGiven && input.tokens!.input !== undefined && input.tokens!.output !== undefined
  const durationMs = input.durationMs ?? null
  const model = input.model ?? null
  const outcome = input.outcome === undefined || input.outcome === null ? 'outcome-unknown' : (OUTCOME_ALIASES[input.outcome] ?? input.outcome)
  const record: DelegationRunRecord = {
    v: LEDGER_VERSION,
    type: 'run',
    id: runId(eventKey),
    eventKey,
    at: input.at ?? (options.now?.() ?? new Date()).toISOString(),
    host: input.host,
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
    cost: tokensComplete ? costOfTokens(model, tokens, options.prices) : null,
    metering: tokensComplete && durationMs !== null ? 'complete' : tokens !== null || durationMs !== null ? 'partial' : 'unknown',
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
    id: randomUUID().replace(/-/g, '').slice(0, 20),
    at: input.at ?? now().toISOString(),
    target: input.target,
    signal: input.signal as OutcomeSignal,
    note: input.note ?? null
  }
  assertSignalRecord(record)
  return record
}

// --- folding: what the append-only history says ----------------------------------------------------

export interface LedgerRun extends DelegationRunRecord {
  /** Later signals tied to this run. */
  signals: { signal: OutcomeSignal; at: string; note: string | null }[]
  /** A later run of the same ticket and task kind went to a higher tier: this one did not do the job. */
  escalated: boolean
  /** The outcome the rates use: a success the session had to rework, a Human Testing defect or a retry on a higher tier is a failure. */
  effectiveOutcome: ExecutionActualOutcomeCode
  /** No usable outcome or no attributable task kind: kept and reported, never counted as a success or a failure. */
  censored: boolean
}

export interface LedgerState {
  runs: LedgerRun[]
  /** Lines that were not valid records (a torn write, a hand edit): skipped, counted. */
  skipped: number
  /** Signals that matched no run. */
  unmatchedSignals: number
}

/** A rate counts a run only when its outcome is a verdict on the tier. An unavailable candidate says nothing about quality. */
export const RATED_OUTCOMES: readonly ExecutionActualOutcomeCode[] = ['success', 'execution-failed', 'validation-failed']

function mergeRuns(base: DelegationRunRecord, later: DelegationRunRecord): DelegationRunRecord {
  const unknown = base.outcome === 'outcome-unknown'
  return {
    ...base,
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
    outcome: unknown ? later.outcome : base.outcome,
    checks: [...new Set([...base.checks, ...later.checks])],
    evidenceRefs: [...new Set([...base.evidenceRefs, ...later.evidenceRefs])]
  }
}

const rankMetering = (state: Metering): number => METERING_STATES.length - METERING_STATES.indexOf(state)

/** True when `later` adds a fact `base` lacks: otherwise a repeated event is a replay and nothing is appended. */
function addsInformation(base: DelegationRunRecord, later: DelegationRunRecord): boolean {
  const merged = mergeRuns(base, later)
  return JSON.stringify({ ...merged, at: base.at, id: base.id }) !== JSON.stringify(base)
}

export function foldLedger(entries: readonly LedgerEntry[], skipped = 0): LedgerState {
  const byId = new Map<string, DelegationRunRecord>()
  for (const entry of entries) {
    if (entry.type !== 'run') continue
    const previous = byId.get(entry.id)
    byId.set(entry.id, previous ? mergeRuns(previous, entry) : entry)
  }
  const runs: LedgerRun[] = [...byId.values()].map((record) => ({ ...record, signals: [], escalated: false, effectiveOutcome: record.outcome, censored: false }))
  runs.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : left.id.localeCompare(right.id)))
  let unmatchedSignals = 0
  for (const entry of entries) {
    if (entry.type !== 'signal') continue
    const matched =
      'run' in entry.target ? runs.filter((run) => run.id === (entry.target as { run: string }).run) : latestPerKind(runs, entry.target as { ticket: number; taskKind: TaskKind | null }, entry.at)
    if (!matched.length) unmatchedSignals++
    for (const run of matched) run.signals.push({ signal: entry.signal, at: entry.at, note: entry.note })
  }
  // A retry on a higher tier is a signal in itself (AC-2): the earlier run did not do the job.
  const steps = new Map<string, LedgerRun[]>()
  for (const run of runs) {
    if (run.ticket === null || run.taskKind === null) continue
    const key = `${run.ticket}/${run.taskKind}/${run.provider}`
    steps.set(key, [...(steps.get(key) ?? []), run])
  }
  for (const group of steps.values()) {
    for (const [index, run] of group.entries()) {
      const rank = tierRank(run.tier)
      if (rank >= 0 && group.slice(index + 1).some((later) => tierRank(later.tier) > rank)) run.escalated = true
    }
  }
  for (const run of runs) {
    const failedLater = run.escalated || run.signals.length > 0
    run.effectiveOutcome = run.outcome === 'success' && failedLater ? 'validation-failed' : run.outcome
    run.censored = run.taskKind === null || !RATED_OUTCOMES.includes(run.effectiveOutcome)
  }
  return { runs, skipped, unmatchedSignals }
}

/** The signal of a ticket lands on the latest run of each task kind that was done when it was given. */
function latestPerKind(runs: readonly LedgerRun[], target: { ticket: number; taskKind: TaskKind | null }, at: string): LedgerRun[] {
  const latest = new Map<string, LedgerRun>()
  for (const run of runs) {
    if (run.ticket !== target.ticket || run.at > at || run.taskKind === null) continue
    if (target.taskKind !== null && run.taskKind !== target.taskKind) continue
    latest.set(`${run.taskKind}/${run.provider}`, run)
  }
  return [...latest.values()]
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

async function withLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, LOCK_FILE)
  const deadline = Date.now() + LOCK_WAIT_MS
  let handle
  for (;;) {
    try {
      handle = await open(path, 'wx', 0o600)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // A holder that died leaves its lock behind: past the stale age nobody is writing any more.
      const held = await stat(path).catch(() => undefined)
      if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        await unlink(path).catch(() => undefined)
        continue
      }
      if (Date.now() > deadline) throw new Error('The delegation ledger is locked by another process (delegations.lock). Retry in a moment.')
      await sleep(15 + Math.floor(Math.random() * 25))
    }
  }
  try {
    return await action()
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(path).catch(() => undefined)
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

function parseLines(text: string | undefined): { entries: LedgerEntry[]; skipped: number } {
  const entries: LedgerEntry[] = []
  let skipped = 0
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (object(value) && value.type === 'signal') assertSignalRecord(value)
      else assertRunRecord(value)
      entries.push(value as unknown as LedgerEntry)
    } catch {
      skipped++
    }
  }
  return { entries, skipped }
}

/** The folded history of the ledger in `dir`; an absent ledger is an empty one. */
export async function readLedger(dir: string): Promise<LedgerState> {
  const { entries, skipped } = parseLines(await regularFileText(join(dir, LEDGER_FILE)))
  return foldLedger(entries, skipped)
}

async function appendLine(file: string, entry: LedgerEntry): Promise<void> {
  const handle = await open(file, 'a', 0o600)
  try {
    await handle.appendFile(`${JSON.stringify(entry)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export interface AppendResult {
  /** `appended`: a new run. `merged`: a repeated event that added a fact. `replayed`: a repeated event, nothing new. */
  status: 'appended' | 'merged' | 'replayed'
  id: string
}

/**
 * Append one run under the lock. A host event seen twice (a `SubagentStop` and the `PostToolUse` of the
 * same agent) is one run: the second sighting only adds the facts the first one lacked.
 */
export async function appendRun(dir: string, record: DelegationRunRecord): Promise<AppendResult> {
  assertRunRecord(record)
  return withLock(dir, async () => {
    const file = join(dir, LEDGER_FILE)
    const { entries } = parseLines(await regularFileText(file))
    const previous = foldLedger(entries).runs.find((run) => run.id === record.id)
    if (previous) {
      if (!addsInformation(previous, record)) return { status: 'replayed', id: previous.id }
      await appendLine(file, { ...record, id: previous.id })
      return { status: 'merged', id: previous.id }
    }
    await appendLine(file, record)
    return { status: 'appended', id: record.id }
  })
}

export async function appendSignal(dir: string, record: DelegationSignalRecord): Promise<{ id: string; matched: number }> {
  assertSignalRecord(record)
  return withLock(dir, async () => {
    const file = join(dir, LEDGER_FILE)
    const { entries } = parseLines(await regularFileText(file))
    const before = foldLedger(entries)
    const after = foldLedger([...entries, record])
    // Count the runs the signal reached: a signal that matches nothing is refused, not silently kept.
    const reached = after.runs.filter((run) => run.signals.some((entry) => entry.at === record.at && entry.signal === record.signal)).length
    if (!reached) throw new Error(describeUnmatched(record, before))
    await appendLine(file, record)
    return { id: record.id, matched: reached }
  })
}

function describeUnmatched(record: DelegationSignalRecord, state: LedgerState): string {
  if ('run' in record.target) return `No delegation run ${record.target.run} in the ledger.`
  const ticket = record.target.ticket
  const known = state.runs.filter((run) => run.ticket === ticket).length
  return known ? `No run of ticket #${ticket}${record.target.taskKind ? ` for ${record.target.taskKind}` : ''} was recorded before now.` : `No delegation run is recorded for ticket #${ticket}.`
}
