import { buildRouteRecord, buildRunRecord, foldLedger, type Complexity, type LedgerRoute, type LedgerRun, type Nature } from '../../harness/delegation-ledger'
import type { TaskKind } from '../../harness/routing-grid'

/**
 * Ledger runs for the routing specs (#1035): a scenario states the outcome, the cost and the duration of a
 * run, and the helper builds a record the ledger accepts and folds it the way `readLedger` does.
 */
export const T0 = Date.parse('2026-10-01T08:00:00.000Z')

/** The tiers of the shipped grid for Claude Code, as (model, effort). */
export const TIERS = {
  light: { tier: 'light', model: 'claude-haiku-5-5', effort: 'medium' },
  edit: { tier: 'edit', model: 'claude-haiku-5-5', effort: 'high' },
  build: { tier: 'build', model: 'claude-sonnet-5-5', effort: 'xhigh' },
  fix: { tier: 'fix', model: 'claude-opus-5-5', effort: 'medium' },
  plan: { tier: 'plan', model: 'claude-opus-5-5', effort: 'high' },
  terminal: { tier: 'terminal', model: 'claude-opus-5-5', effort: 'xhigh' }
} as const

export type RunSpec = {
  tier?: keyof typeof TIERS
  kind?: TaskKind | null
  provider?: 'claude-code' | 'codex'
  /** `manual`: recorded by hand, rated for the report and never decisive. */
  host?: 'claude-code' | 'codex' | 'manual'
  retryOf?: string
  eventKey?: string
  outcome?: 'success' | 'fail' | 'cancelled' | 'candidate-unavailable' | 'outcome-unknown'
  /** USD; null: an unpriced run. */
  cost?: string | null
  durationMs?: number | null
  trial?: boolean
  ticket?: number
  complexity?: Complexity
  nature?: Nature
  at?: string
  model?: string
  effort?: string
}

let clock = 0

/** One run; without an explicit `at`, one minute after the previous run of the file. */
export function one(spec: RunSpec = {}): LedgerRun {
  const tier = TIERS[spec.tier ?? 'build']
  const outcome = spec.outcome ?? 'success'
  const record = buildRunRecord({
    host: spec.host ?? 'claude-code',
    eventKey: spec.eventKey ?? null,
    retryOf: spec.retryOf ?? null,
    provider: spec.provider ?? 'claude-code',
    tier: tier.tier,
    taskKind: spec.kind === null ? null : (spec.kind ?? 'multi-file-feature'),
    ticket: spec.ticket ?? null,
    complexity: spec.complexity ?? null,
    nature: spec.nature ?? null,
    model: spec.model ?? tier.model,
    effort: spec.effort ?? tier.effort,
    trial: spec.trial ?? false,
    at: spec.at ?? new Date(T0 + clock++ * 60_000).toISOString(),
    durationMs: spec.durationMs === undefined ? 60_000 : spec.durationMs,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    outcome: outcome === 'outcome-unknown' ? undefined : outcome === 'fail' ? 'fail' : outcome === 'success' ? 'pass' : outcome,
    checks: ['type-check']
  })
  // The cost is set by the spec, not by the catalogue, so a scenario states the figure it reasons about.
  const priced = { ...record, cost: spec.cost === null ? null : { amount: spec.cost ?? '1.00000000', currency: 'USD' as const } }
  return foldLedger([priced]).runs[0]
}

export const runs = (count: number, spec: RunSpec = {}): LedgerRun[] => Array.from({ length: count }, () => one(spec))

/** Outcomes in order: 's' success, 'f' failure. */
export const sequence = (pattern: string, spec: RunSpec = {}): LedgerRun[] => [...pattern].map((symbol) => one({ ...spec, outcome: symbol === 'f' ? 'fail' : 'success' }))

/** The history in the order it was recorded. */
export const history = (...groups: LedgerRun[][]): LedgerRun[] => groups.flat().sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))

/** A route `sf agents route --record` issued and no run has echoed yet: it reserves its place in the trial share. */
export function pending(spec: { kind?: TaskKind; provider?: 'claude-code' | 'codex'; tier?: keyof typeof TIERS; trial?: boolean; now: Date }): LedgerRoute {
  const route = buildRouteRecord({
    taskKind: spec.kind ?? 'multi-file-feature',
    provider: spec.provider ?? 'claude-code',
    tier: TIERS[spec.tier ?? 'build'].tier,
    trial: spec.trial ?? false,
    now: spec.now
  })
  return { ...route, consumedBy: null }
}
