import type { LedgerRun } from './delegation-ledger'
import type { AdjustPolicy } from './routing-adjust-config'
import { autoKindsFor, withLogEntry, type AdjustmentAction, type AdjustmentEvidence, type LocalAdjustment, type LocalRouting } from './routing-local'
import {
  isCandidateExcluded,
  resolveRoute,
  resolveTierCandidate,
  ROUTING_PROVIDERS,
  TASK_KINDS,
  TIER_LADDER,
  tierRank,
  type RoutingCandidate,
  type RoutingOverrides,
  type RoutingProvider,
  type TaskKind
} from './routing-grid'
import { ExactRational, exactCostEvidence } from '../execution/exact-cost'

/**
 * The automatic adjustment (#1035, FR-AEX-014). A task kind moves **up** one tier after repeated failures
 * and moves **down** only after a cheaper tier, tried on a bounded sample, keeps succeeding. What decides
 * is the **expected cost of delivering the work**, not the price of a call: a cheap tier that fails often
 * is expensive, because every failure triggers a retry on the next tier or a rework by the session.
 *
 *   expected feature cost  E = c / s + (1 - s) x F
 *
 * with `c` the mean cost of a run, `s` its success rate and `F` the cost of what a failure triggers (the
 * run on the next tier up when it was measured, otherwise one more run of the same tier). Duration breaks
 * a tie between tiers whose expected cost is within a band, and a tier whose p95 duration is over the
 * declared ceiling is not chosen. A candidate with no priced run has no expected cost: it can be moved
 * away from on reliability, never moved to on cost.
 *
 * Statistics are keyed by **candidate** (model and effort), not by tier name, so a grid bump keeps the
 * measured history of a candidate that did not change and starts a fresh window for one that did.
 */

// --- statistics ---------------------------------------------------------------------------------------

export interface WindowStats {
  /** `model/effort`, the key the history follows. */
  candidate: string
  rated: number
  successes: number
  failures: number
  priced: number
  meanCost: ExactRational | null
  costMedian: ExactRational | null
  costP95: ExactRational | null
  durationMedianMs: number | null
  durationP95Ms: number | null
  /** Run ids behind the window, most recent last. */
  runIds: string[]
}

/** The same model under its dated snapshot is the same candidate. */
const modelKey = (model: string): string => model.replace(/[-@]\d{8}$/, '')
export const candidateId = (candidate: { model: string; effort: string }): string => `${modelKey(candidate.model)}/${candidate.effort}`

/** The candidate a run recorded; one that recorded nothing falls back to what its tier runs now. */
export function runCandidateId(run: LedgerRun, shared: RoutingOverrides | undefined): string | undefined {
  const fallback = resolveTierCandidate(run.tier, run.provider, shared)
  const model = run.candidate.model ?? fallback?.model
  const effort = run.candidate.effort ?? fallback?.effort
  return model && effort ? candidateId({ model, effort }) : undefined
}

/** Nearest-rank percentile of an already sorted list. */
export function nearestRank<T>(sorted: readonly T[], quantile: number): T | null {
  if (!sorted.length) return null
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]
}

export function windowStats(candidate: string, runs: readonly LedgerRun[]): WindowStats {
  const successes = runs.filter((run) => run.effectiveOutcome === 'success').length
  const costs = runs.flatMap((run) => (run.cost ? [ExactRational.decimal(run.cost.amount)] : [])).sort((left, right) => left.compare(right))
  const durations = runs.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs])).sort((left, right) => left - right)
  return {
    candidate,
    rated: runs.length,
    successes,
    failures: runs.length - successes,
    priced: costs.length,
    meanCost: costs.length ? costs.reduce((sum, cost) => sum.add(cost), new ExactRational(0n)).divide(BigInt(costs.length)) : null,
    costMedian: nearestRank(costs, 0.5),
    costP95: nearestRank(costs, 0.95),
    durationMedianMs: nearestRank(durations, 0.5),
    durationP95Ms: nearestRank(durations, 0.95),
    runIds: runs.map((run) => run.id)
  }
}

/**
 * Expected cost of delivering the work on a candidate, failures included. `failureCost` is what one
 * failure triggers; without it a failure costs one more run of the same candidate. Null while the
 * candidate has no priced run or no success (a candidate that never succeeded has no finite cost).
 */
export function expectedFeatureCost(stats: WindowStats, failureCost?: ExactRational | null): ExactRational | null {
  if (!stats.meanCost || stats.successes === 0) return null
  const rated = BigInt(stats.rated)
  const perSuccess = stats.meanCost.multiply(new ExactRational(rated, BigInt(stats.successes)))
  const failed = new ExactRational(rated - BigInt(stats.successes), rated)
  return perSuccess.add(failed.multiply(failureCost ?? stats.meanCost))
}

export const formatCost = (cost: ExactRational | null): string | null => (cost ? exactCostEvidence(cost, 'USD', 6).amount : null)

// --- the ladder ---------------------------------------------------------------------------------------

export interface Rung {
  tier: string
  candidate: RoutingCandidate
  id: string
}

/**
 * The next different candidate above or below a tier on the ladder. Tiers that share a candidate (the
 * Codex tiers mostly do) are one rung. Going down, the grid's exclusion for the kind is a hard floor:
 * the first different candidate being excluded ends the descent. Going up, an excluded candidate is skipped.
 */
export function nextRung(direction: 'up' | 'down', tier: string, kind: TaskKind, provider: RoutingProvider, shared: RoutingOverrides | undefined): Rung | undefined {
  const rank = tierRank(tier)
  const here = resolveTierCandidate(tier, provider, shared)
  if (rank < 0 || !here) return undefined
  const hereId = candidateId(here)
  for (let index = rank + (direction === 'up' ? 1 : -1); index >= 0 && index < TIER_LADDER.length; index += direction === 'up' ? 1 : -1) {
    const candidate = resolveTierCandidate(TIER_LADDER[index], provider, shared)
    if (!candidate || candidateId(candidate) === hereId) continue
    if (isCandidateExcluded(kind, provider, candidate)) {
      if (direction === 'down') return undefined
      continue
    }
    return { tier: TIER_LADDER[index], candidate, id: candidateId(candidate) }
  }
  return undefined
}

// --- the decision -------------------------------------------------------------------------------------

export type HoldReason =
  | 'disabled'
  | 'developer-override'
  | 'tier-not-on-ladder'
  | 'no-evidence'
  | 'healthy'
  | 'top-of-ladder'
  | 'floor'
  | 'trial-not-proven'
  | 'unpriced'
  | 'target-not-cheaper'
  | 'cheaper-tier-costs-more'
  | 'tie-not-faster'
  | 'over-duration-ceiling'

export interface Decision {
  kind: TaskKind
  provider: RoutingProvider
  action: AdjustmentAction | 'hold'
  /** The tier the kind is routed to now. */
  from: string
  /** The tier it moves to; null for a hold. */
  to: string | null
  reason: string
  evidence: AdjustmentEvidence | null
}

export interface AdjustContext {
  shared: RoutingOverrides | undefined
  local: LocalRouting
  policy: AdjustPolicy
  runs: readonly LedgerRun[]
  now: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

function kindRuns(ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider): LedgerRun[] {
  return ctx.runs.filter((run) => run.taskKind === kind && run.provider === provider)
}

/** The rated runs of one candidate for a kind: the last `limit`, optionally only those after the evidence boundary. */
function ratedWindow(ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider, candidate: string, options: { fresh: boolean; limit: number }): LedgerRun[] {
  const boundary = options.fresh ? ctx.local.boundaries[kind]?.[provider] : undefined
  return kindRuns(ctx, kind, provider)
    .filter((run) => !run.censored && (boundary === undefined || run.at > boundary) && runCandidateId(run, ctx.shared) === candidate)
    .slice(-options.limit)
}

const stats = (ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider, candidate: string, options: { fresh: boolean; limit?: number }): WindowStats =>
  windowStats(candidate, ratedWindow(ctx, kind, provider, candidate, { fresh: options.fresh, limit: options.limit ?? ctx.policy.window }))

function hold(kind: TaskKind, provider: RoutingProvider, from: string, reason: HoldReason, evidence: AdjustmentEvidence | null = null): Decision {
  return { kind, provider, action: 'hold', from, to: null, reason, evidence }
}

function evidenceOf(rule: string, from: Rung, to: Rung, window: WindowStats, ex: ExactRational | null, et: ExactRational | null, fromStats: WindowStats, toStats: WindowStats): AdjustmentEvidence {
  return {
    rule,
    from: { tier: from.tier, candidate: from.id },
    to: { tier: to.tier, candidate: to.id },
    window: { rated: window.rated, successes: window.successes, failures: window.failures },
    expectedFeatureCost: { from: formatCost(ex), to: formatCost(et), currency: 'USD' },
    durationP95Ms: { from: fromStats.durationP95Ms, to: toStats.durationP95Ms },
    runs: window.runIds.slice(-30)
  }
}

const rungOf = (tier: string, candidate: RoutingCandidate): Rung => ({ tier, candidate, id: candidateId(candidate) })

/** What the adjustment would do for one kind and provider, from the ledger and the local layer. Pure: nothing is written. */
export function evaluateKind(kind: TaskKind, provider: RoutingProvider, ctx: AdjustContext): Decision {
  const route = resolveRoute(kind, provider, ctx.shared, autoKindsFor(ctx.local, provider))
  const tier = route.tier
  // The developer's choice is never changed automatically, and an automatic move never hides it.
  if (ctx.shared?.kinds?.[kind]) return hold(kind, provider, tier, 'developer-override')
  if (!ctx.policy.enabled) return hold(kind, provider, tier, 'disabled')
  if (tierRank(tier) < 0) return hold(kind, provider, tier, 'tier-not-on-ladder')
  const here = rungOf(tier, route.candidate)
  const policy = ctx.policy

  // Escalate: the failures of the candidate the kind runs on since the evidence started.
  const recent = stats(ctx, kind, provider, here.id, { fresh: true, limit: policy.escalateOf })
  if (recent.failures >= policy.escalateFailures) {
    const up = nextRung('up', tier, kind, provider, ctx.shared)
    if (!up) return hold(kind, provider, tier, 'top-of-ladder')
    const upHistory = stats(ctx, kind, provider, up.id, { fresh: false })
    if (policy.maxDurationMs !== null && upHistory.durationP95Ms !== null && upHistory.durationP95Ms > policy.maxDurationMs) return hold(kind, provider, tier, 'over-duration-ceiling')
    const hereWindow = stats(ctx, kind, provider, here.id, { fresh: true })
    const ex = expectedFeatureCost(hereWindow, upHistory.meanCost)
    const et = expectedFeatureCost(upHistory)
    // A tier that was measured and costs more in expectation than staying is not worth the move.
    if (ex && et && et.compare(ex) >= 0) return hold(kind, provider, tier, 'target-not-cheaper', evidenceOf('target costs at least as much', here, up, recent, ex, et, hereWindow, upHistory))
    const rule = `${recent.failures} failures in the last ${recent.rated} rated runs (threshold ${policy.escalateFailures} of ${policy.escalateOf})`
    return { kind, provider, action: 'escalate', from: tier, to: up.tier, reason: rule, evidence: evidenceOf(rule, here, up, recent, ex, et, hereWindow, upHistory) }
  }

  // De-escalate: the cheaper tier, tried on a bounded sample, has kept succeeding.
  const down = nextRung('down', tier, kind, provider, ctx.shared)
  if (!down) return hold(kind, provider, tier, 'floor')
  const trial = stats(ctx, kind, provider, down.id, { fresh: true })
  if (trial.rated === 0) return hold(kind, provider, tier, recent.rated ? 'trial-not-proven' : 'no-evidence')
  if (trial.successes < policy.deescalateSuccesses || trial.failures > policy.deescalateFailures) return hold(kind, provider, tier, 'trial-not-proven')
  if (policy.maxDurationMs !== null && trial.durationP95Ms !== null && trial.durationP95Ms > policy.maxDurationMs) return hold(kind, provider, tier, 'over-duration-ceiling')
  const hereWindow = stats(ctx, kind, provider, here.id, { fresh: true })
  if (!hereWindow.rated) return hold(kind, provider, tier, 'no-evidence')
  const upHistory = nextRung('up', tier, kind, provider, ctx.shared)
  const upCost = upHistory ? stats(ctx, kind, provider, upHistory.id, { fresh: false }).meanCost : null
  const ex = expectedFeatureCost(hereWindow, upCost)
  const et = expectedFeatureCost(trial, hereWindow.meanCost)
  if (!ex || !et) return hold(kind, provider, tier, 'unpriced', evidenceOf('expected feature cost unknown', here, down, trial, ex, et, hereWindow, trial))
  const band = ExactRational.decimal(policy.costBand.toFixed(6))
  const one = new ExactRational(1n)
  const cheaper = et.compare(ex.multiply(one.subtract(band))) < 0
  const within = !cheaper && et.compare(ex.multiply(one.add(band))) <= 0
  if (!cheaper && !within) return hold(kind, provider, tier, 'cheaper-tier-costs-more', evidenceOf('cheaper tier costs more in expectation', here, down, trial, ex, et, hereWindow, trial))
  if (within && !(trial.durationP95Ms !== null && hereWindow.durationP95Ms !== null && trial.durationP95Ms < hereWindow.durationP95Ms))
    return hold(kind, provider, tier, 'tie-not-faster', evidenceOf('tied on cost, not faster', here, down, trial, ex, et, hereWindow, trial))
  const rule = `${trial.successes} trial successes and ${trial.failures} failures of the cheaper tier (threshold ${policy.deescalateSuccesses} and ${policy.deescalateFailures})${within ? ', tied within the cost band and faster' : ''}`
  return { kind, provider, action: 'deescalate', from: tier, to: down.tier, reason: rule, evidence: evidenceOf(rule, here, down, trial, ex, et, hereWindow, trial) }
}

// --- trials -------------------------------------------------------------------------------------------

export interface TrialOffer {
  tier: string
  candidate: RoutingCandidate
  /** The tier the kind is routed to; the offer is a sample of the one below it. */
  effectiveTier: string
}

/**
 * The cheaper tier `sf agents route` may answer instead of the routed one, on a bounded sample. Decided
 * from the ledger alone, so the same history gives the same answer:
 *
 * - the share of the kind's runs since the evidence started that were trials stays at or under the declared
 *   share, counting the run being offered (`(trials + 1) <= share x (runs + 1)`);
 * - never below a floor of the grid, never over the duration ceiling, never while the routed tier is itself failing;
 * - not again for the cooldown after a trial of that tier failed, and not once it has proven itself (the
 *   adjustment moves the kind then).
 */
export function selectTrial(kind: TaskKind, provider: RoutingProvider, ctx: AdjustContext): TrialOffer | undefined {
  const route = resolveRoute(kind, provider, ctx.shared, autoKindsFor(ctx.local, provider))
  const policy = ctx.policy
  if (!policy.enabled || ctx.shared?.kinds?.[kind] || tierRank(route.tier) < 0) return undefined
  const down = nextRung('down', route.tier, kind, provider, ctx.shared)
  if (!down) return undefined
  const here = candidateId(route.candidate)
  if (stats(ctx, kind, provider, here, { fresh: true, limit: policy.escalateOf }).failures >= policy.escalateFailures) return undefined
  const history = stats(ctx, kind, provider, down.id, { fresh: false })
  if (policy.maxDurationMs !== null && history.durationP95Ms !== null && history.durationP95Ms > policy.maxDurationMs) return undefined
  const cutoff = ctx.now.getTime() - policy.trialCooldownDays * DAY_MS
  const failedRecently = kindRuns(ctx, kind, provider).some((run) => !run.censored && run.effectiveOutcome !== 'success' && runCandidateId(run, ctx.shared) === down.id && Date.parse(run.at) >= cutoff)
  if (failedRecently) return undefined
  const fresh = stats(ctx, kind, provider, down.id, { fresh: true })
  if (fresh.successes >= policy.deescalateSuccesses && fresh.failures <= policy.deescalateFailures) return undefined
  const boundary = ctx.local.boundaries[kind]?.[provider]
  const since = kindRuns(ctx, kind, provider).filter((run) => boundary === undefined || run.at > boundary)
  const trials = since.filter((run) => run.trial).length
  // Whole numbers on both sides: a share that is exactly reached must not be refused by a rounding error.
  if ((trials + 1) * 1_000_000 > Math.round(policy.trialShare * 1_000_000) * (since.length + 1)) return undefined
  return { tier: down.tier, candidate: down.candidate, effectiveTier: route.tier }
}

// --- applying -----------------------------------------------------------------------------------------

export interface AdjustOutcome {
  decisions: Decision[]
  /** The layer after the moves; the same object when nothing moved. */
  local: LocalRouting
  moved: boolean
}

/**
 * Evaluate every kind and provider the ledger has runs for, and apply the moves to the local layer:
 * the entry, the evidence boundary (a move starts a new window) and the log. A kind that returns to its
 * shipped tier loses its entry instead of keeping one that says nothing.
 */
export function adjustRouting(ctx: AdjustContext): AdjustOutcome {
  const decisions: Decision[] = []
  let local = ctx.local
  const at = ctx.now.toISOString()
  for (const kind of TASK_KINDS) {
    for (const provider of ROUTING_PROVIDERS) {
      if (!ctx.runs.some((run) => run.taskKind === kind && run.provider === provider)) continue
      const decision = evaluateKind(kind, provider, { ...ctx, local })
      decisions.push(decision)
      if (decision.action === 'hold' || decision.to === null || !decision.evidence) continue
      const shippedTier = resolveRoute(kind, provider, undefined).tier
      const entry: LocalAdjustment = { tier: decision.to, from: decision.from, action: decision.action, at, evidence: decision.evidence }
      const providers = { ...(local.kinds[kind] ?? {}) }
      if (decision.to === shippedTier) delete providers[provider]
      else providers[provider] = entry
      const kinds = { ...local.kinds, [kind]: providers }
      if (!Object.keys(providers).length) delete kinds[kind]
      local = withLogEntry(
        { ...local, kinds, boundaries: { ...local.boundaries, [kind]: { ...(local.boundaries[kind] ?? {}), [provider]: at } } },
        { at, action: decision.action, kind, provider, from: decision.from, to: decision.to, evidence: decision.evidence, note: null }
      )
    }
  }
  return { decisions, local, moved: local !== ctx.local }
}
