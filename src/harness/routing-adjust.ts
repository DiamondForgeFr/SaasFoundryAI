import type { LedgerRoute, LedgerRun } from './delegation-ledger'
import type { AdjustPolicy } from './routing-adjust-config'
import { autoKindsFor, NEW_CANDIDATE_DAYS, withLogEntry, type AdjustmentAction, type AdjustmentEvidence, type LocalAdjustment, type LocalLadderEntry, type LocalRouting } from './routing-local'
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
 * a descent is the **expected cost of delivering the work**, not the price of a call: a cheap tier that
 * fails often is expensive, because every failure triggers a retry on the next tier or a rework.
 *
 *   E(tier) = c + (1 - s) x E(next tier up)        top of the ladder, or a next tier never measured:  E = c / s
 *
 * with `c` the mean cost of a run of the tier and `s` its success rate. A failure is paid once: it costs
 * the run that failed (inside `c`) plus whatever delivers the work next. Duration breaks a tie between
 * tiers whose expected cost is within a band, and a tier whose p95 duration is over the declared ceiling is
 * not chosen when moving down. A candidate with no priced run has no expected cost: it can be moved away
 * from on reliability, never moved to on cost.
 *
 * Moving **up** after `escalate.failures` of the last `escalate.of` rated runs is not conditioned on cost:
 * the session's own rework of a failing tier is not metered, so the expected cost of staying is
 * underestimated and the rule would hold a kind on a failing tier. The expected costs of such a move are
 * still recorded in its evidence.
 *
 * Statistics are keyed by **candidate** (model and effort), not by tier name, so a grid bump keeps the
 * measured history of a candidate that did not change and starts a fresh window for one that did. A
 * candidate that first appears on a **neighbouring** rung is tried by itself, within the same share as
 * a cheaper tier, and adopted by the same expected-cost rule. A candidate that replaces another under the
 * same tier name takes that tier at once: a tier agent runs one candidate, so the previous one cannot stay.
 *
 * Only decisive runs count: rated, recorded by a host hook (a run recorded by hand asks nothing of the
 * routing), and, for a descent, only the runs the routing itself offered as a trial.
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

/** A rate counts what the agent cost over all its stops (`countedCost`) and the time it worked (`countedDurationMs`). */
export function windowStats(candidate: string, runs: readonly LedgerRun[]): WindowStats {
  const successes = runs.filter((run) => run.effectiveOutcome === 'success').length
  const costs = runs.flatMap((run) => (run.countedCost ? [ExactRational.decimal(run.countedCost.amount)] : [])).sort((left, right) => left.compare(right))
  const durations = runs.flatMap((run) => (run.countedDurationMs === null ? [] : [run.countedDurationMs])).sort((left, right) => left - right)
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
 * Expected cost of delivering the work on a candidate. `next` is the expected cost of the tier a failure
 * triggers; without it a failure is retried on the same candidate, which makes the cost `c / s`. Null while
 * the candidate has no priced run, or no success and nothing above it to fall back on.
 */
export function expectedFeatureCost(stats: WindowStats, next?: ExactRational | null): ExactRational | null {
  if (!stats.meanCost || stats.rated === 0) return null
  if (!next) return stats.successes === 0 ? null : stats.meanCost.multiply(new ExactRational(BigInt(stats.rated), BigInt(stats.successes)))
  const failed = new ExactRational(BigInt(stats.rated - stats.successes), BigInt(stats.rated))
  return stats.meanCost.add(failed.multiply(next))
}

export const formatCost = (cost: ExactRational | null): string | null => (cost ? exactCostEvidence(cost, 'USD', 6).amount : null)

// --- the ladder ---------------------------------------------------------------------------------------

export interface Rung {
  tier: string
  candidate: RoutingCandidate
  id: string
}

const rungOf = (tier: string, candidate: RoutingCandidate): Rung => ({ tier, candidate, id: candidateId(candidate) })

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
    return rungOf(TIER_LADDER[index], candidate)
  }
  return undefined
}

/** Every different candidate of the ladder from the lightest to the strongest that the kind may use, one rung each. */
export function ladderRungs(kind: TaskKind, provider: RoutingProvider, shared: RoutingOverrides | undefined): Rung[] {
  const rungs: Rung[] = []
  for (const tier of TIER_LADDER) {
    const candidate = resolveTierCandidate(tier, provider, shared)
    if (!candidate || isCandidateExcluded(kind, provider, candidate)) continue
    const rung = rungOf(tier, candidate)
    if (!rungs.some((seen) => seen.id === rung.id)) rungs.push(rung)
  }
  return rungs
}

/**
 * The expected feature cost of each rung, from the top down: a rung's failures are paid at the rung above
 * it. `statsOf` is the measured window of a rung; a rung with nothing measured has no cost and the rung
 * below falls back to `c / s`.
 */
export function featureCosts(rungs: readonly Rung[], statsOf: (rung: Rung) => WindowStats): Map<string, ExactRational | null> {
  const costs = new Map<string, ExactRational | null>()
  let above: ExactRational | null = null
  for (let index = rungs.length - 1; index >= 0; index--) {
    const cost = expectedFeatureCost(statsOf(rungs[index]), above)
    costs.set(rungs[index].id, cost)
    above = cost
  }
  return costs
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
  | 'cheaper-tier-costs-more'
  | 'tie-not-faster'
  | 'over-duration-ceiling'

/** What a person reads next to a hold in the log and in `sf status`. */
export const HOLD_TEXT: Record<HoldReason, string> = {
  disabled: 'the automatic adjustment is off (modules.harness.routing.adjust.enabled)',
  'developer-override': 'modules.harness.routing pins this kind: the developer decides',
  'tier-not-on-ladder': 'the routed tier is not on the shipped ladder, so it cannot be moved',
  'no-evidence': 'no rated run of the routed tier since the evidence started',
  healthy: 'the routed tier is not failing and no cheaper tier is being proven',
  'top-of-ladder': 'the routed tier keeps failing and there is no stronger tier to move to',
  floor: 'no cheaper tier is allowed for this kind',
  'trial-not-proven': 'the cheaper tier has not yet kept succeeding on its trial runs',
  unpriced: 'a cost needed to compare the tiers is unknown (a model without a price)',
  'cheaper-tier-costs-more': 'the cheaper tier proved reliable but costs more in expectation',
  'tie-not-faster': 'the cheaper tier costs about the same and is not faster',
  'over-duration-ceiling': 'the cheaper tier runs longer than modules.harness.routing.adjust.maxDurationMs'
}

export interface Decision {
  kind: TaskKind
  provider: RoutingProvider
  action: AdjustmentAction | 'hold'
  /** The tier the kind is routed to now. */
  from: string
  /** The tier it moves to; null for a hold. */
  to: string | null
  reason: string
  /** For a hold, its machine reason. */
  hold: HoldReason | null
  evidence: AdjustmentEvidence | null
  /** The decision adopts a candidate that was new on the ladder: it is accepted from now on. */
  adopts: boolean
}

export interface AdjustContext {
  /** The overrides decisions rest on: the committed working branch's routing block. */
  shared: RoutingOverrides | undefined
  local: LocalRouting
  policy: AdjustPolicy
  runs: readonly LedgerRun[]
  /** Routes issued and not yet echoed by a run: a pending trial holds its share. */
  routes?: readonly LedgerRoute[]
  now: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const indexes = new WeakMap<readonly LedgerRun[], Map<string, LedgerRun[]>>()

/** The runs of one kind and provider, oldest first; indexed once per ledger state. */
function kindRuns(ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider): readonly LedgerRun[] {
  let index = indexes.get(ctx.runs)
  if (!index) {
    index = new Map()
    for (const run of ctx.runs) {
      if (run.taskKind === null) continue
      const key = `${run.taskKind}/${run.provider}`
      const list = index.get(key)
      if (list) list.push(run)
      else index.set(key, [run])
    }
    indexes.set(ctx.runs, index)
  }
  return index.get(`${kind}/${provider}`) ?? []
}

interface WindowOptions {
  /** Only the runs after the evidence boundary of the kind. */
  fresh: boolean
  limit?: number
  /** Only the runs the routing offered as a trial. */
  trialOnly?: boolean
}

/** The decisive runs of one candidate for a kind: the last `limit`. */
function ratedWindow(ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider, candidate: string, options: WindowOptions): LedgerRun[] {
  const boundary = options.fresh ? ctx.local.boundaries[kind]?.[provider] : undefined
  const window = kindRuns(ctx, kind, provider).filter(
    (run) => run.decisive && (boundary === undefined || run.at > boundary) && (!options.trialOnly || run.trial) && runCandidateId(run, ctx.shared) === candidate
  )
  return window.slice(-(options.limit ?? ctx.policy.window))
}

const stats = (ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider, candidate: string, options: WindowOptions): WindowStats =>
  windowStats(candidate, ratedWindow(ctx, kind, provider, candidate, options))

function hold(kind: TaskKind, provider: RoutingProvider, from: string, reason: HoldReason, evidence: AdjustmentEvidence | null = null): Decision {
  return { kind, provider, action: 'hold', from, to: null, reason: HOLD_TEXT[reason], hold: reason, evidence, adopts: false }
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

/** Whether a tier's candidate appeared after the adjustment first looked at the ladder and has not been adopted yet. */
export function isNewCandidate(local: LocalRouting, provider: RoutingProvider, tier: string, shared: RoutingOverrides | undefined, now: Date): boolean {
  const entry = local.ladders[provider]?.[tier]
  const candidate = resolveTierCandidate(tier, provider, shared)
  if (!entry || entry.status !== 'new' || !candidate || entry.candidate !== candidateId(candidate)) return false
  return now.getTime() - Date.parse(entry.since) < NEW_CANDIDATE_DAYS * DAY_MS
}

type Comparison = 'cheaper' | 'tie-faster' | 'tie-not-faster' | 'costs-more' | 'unknown'

/** The candidate against the incumbent on expected feature cost; inside the band, the faster p95 wins. */
function compare(policy: AdjustPolicy, candidate: ExactRational | null, incumbent: ExactRational | null, candidateStats: WindowStats, incumbentStats: WindowStats): Comparison {
  if (!candidate || !incumbent) return 'unknown'
  const band = ExactRational.decimal(policy.costBand.toFixed(6))
  const one = new ExactRational(1n)
  if (candidate.compare(incumbent.multiply(one.subtract(band))) < 0) return 'cheaper'
  if (candidate.compare(incumbent.multiply(one.add(band))) > 0) return 'costs-more'
  return candidateStats.durationP95Ms !== null && incumbentStats.durationP95Ms !== null && candidateStats.durationP95Ms < incumbentStats.durationP95Ms ? 'tie-faster' : 'tie-not-faster'
}

const proven = (policy: AdjustPolicy, trial: WindowStats): boolean => trial.successes >= policy.deescalateSuccesses && trial.failures <= policy.deescalateFailures

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
  const rungs = ladderRungs(kind, provider, ctx.shared)
  const hereWindow = stats(ctx, kind, provider, here.id, { fresh: true })
  // The expected costs of every rung, the routed one over its own window since the evidence started.
  const costs = featureCosts(rungs, (rung) => (rung.id === here.id ? hereWindow : stats(ctx, kind, provider, rung.id, { fresh: false })))

  // Escalate: the failures of the candidate the kind runs on since the evidence started. One rung, whatever the cost.
  const recent = stats(ctx, kind, provider, here.id, { fresh: true, limit: policy.escalateOf })
  if (recent.failures >= policy.escalateFailures) {
    const up = nextRung('up', tier, kind, provider, ctx.shared)
    if (!up) return hold(kind, provider, tier, 'top-of-ladder')
    const upHistory = stats(ctx, kind, provider, up.id, { fresh: false })
    const slow = policy.maxDurationMs !== null && upHistory.durationP95Ms !== null && upHistory.durationP95Ms > policy.maxDurationMs
    const rule = `${recent.failures} failures in the last ${recent.rated} rated runs (threshold ${policy.escalateFailures} of ${policy.escalateOf})${slow ? `; the stronger tier's p95 duration is over the ${policy.maxDurationMs} ms ceiling, and a failing tier is left anyway` : ''}`
    return {
      kind,
      provider,
      action: 'escalate',
      from: tier,
      to: up.tier,
      reason: rule,
      hold: null,
      evidence: evidenceOf(rule, here, up, recent, costs.get(here.id) ?? null, costs.get(up.id) ?? null, hereWindow, upHistory),
      adopts: isNewCandidate(ctx.local, provider, up.tier, ctx.shared, ctx.now)
    }
  }

  // De-escalate: the cheaper tier, tried on a bounded sample the routing offered, has kept succeeding.
  const down = nextRung('down', tier, kind, provider, ctx.shared)
  if (down) {
    const trial = stats(ctx, kind, provider, down.id, { fresh: true, trialOnly: true })
    if (trial.rated > 0 && proven(policy, trial)) {
      if (policy.maxDurationMs !== null && trial.durationP95Ms !== null && trial.durationP95Ms > policy.maxDurationMs) return hold(kind, provider, tier, 'over-duration-ceiling')
      if (!hereWindow.rated) return hold(kind, provider, tier, 'no-evidence')
      // A failure of the trial is paid at the routed tier, which is where the work would go.
      const ex = costs.get(here.id) ?? null
      const et = expectedFeatureCost(trial, ex)
      const evidence = evidenceOf('', here, down, trial, ex, et, hereWindow, trial)
      const verdict = compare(policy, et, ex, trial, hereWindow)
      if (verdict === 'unknown') return hold(kind, provider, tier, 'unpriced', { ...evidence, rule: 'expected feature cost unknown' })
      if (verdict === 'costs-more') return hold(kind, provider, tier, 'cheaper-tier-costs-more', { ...evidence, rule: 'cheaper tier costs more in expectation' })
      if (verdict === 'tie-not-faster') return hold(kind, provider, tier, 'tie-not-faster', { ...evidence, rule: 'tied on cost, not faster' })
      const rule = `${trial.successes} trial successes and ${trial.failures} failures of the cheaper tier (threshold ${policy.deescalateSuccesses} and ${policy.deescalateFailures})${verdict === 'tie-faster' ? ', tied within the cost band and faster' : ''}`
      return {
        kind,
        provider,
        action: 'deescalate',
        from: tier,
        to: down.tier,
        reason: rule,
        hold: null,
        evidence: { ...evidence, rule },
        adopts: isNewCandidate(ctx.local, provider, down.tier, ctx.shared, ctx.now)
      }
    }
  }

  // Adopt a new stronger candidate: it was tried within the share and delivers the work for less, failures included.
  const up = nextRung('up', tier, kind, provider, ctx.shared)
  if (up && isNewCandidate(ctx.local, provider, up.tier, ctx.shared, ctx.now)) {
    const trial = stats(ctx, kind, provider, up.id, { fresh: true, trialOnly: true })
    if (trial.rated > 0 && proven(policy, trial) && hereWindow.rated) {
      const above = nextRung('up', up.tier, kind, provider, ctx.shared)
      const aboveCost = above ? (costs.get(above.id) ?? null) : null
      const ex = costs.get(here.id) ?? null
      const eu = expectedFeatureCost(trial, aboveCost)
      const verdict = compare(policy, eu, ex, trial, hereWindow)
      if (verdict === 'cheaper' || verdict === 'tie-faster') {
        const rule = `${trial.successes} trial successes and ${trial.failures} failures of the new stronger candidate; it delivers the work for less in expectation${verdict === 'tie-faster' ? ' (tied within the cost band and faster)' : ''}`
        return { kind, provider, action: 'escalate', from: tier, to: up.tier, reason: rule, hold: null, evidence: evidenceOf(rule, here, up, trial, ex, eu, hereWindow, trial), adopts: true }
      }
    }
  }

  if (!down) return hold(kind, provider, tier, 'floor')
  const trial = stats(ctx, kind, provider, down.id, { fresh: true, trialOnly: true })
  if (trial.rated === 0) return hold(kind, provider, tier, hereWindow.rated ? 'trial-not-proven' : 'no-evidence')
  return hold(kind, provider, tier, 'trial-not-proven')
}

// --- trials -------------------------------------------------------------------------------------------

export interface TrialOffer {
  tier: string
  candidate: RoutingCandidate
  /** The tier the kind is routed to; the offer is a sample of the rung below it (or of a new one above it). */
  effectiveTier: string
  direction: 'down' | 'up'
}

/** Routes issued for a kind and not echoed by a run yet: each will become a run, and a trial among them holds its share. */
function pendingRoutes(ctx: AdjustContext, kind: TaskKind, provider: RoutingProvider): LedgerRoute[] {
  const boundary = ctx.local.boundaries[kind]?.[provider]
  const now = ctx.now.toISOString()
  return (ctx.routes ?? []).filter(
    (route) => route.taskKind === kind && route.provider === provider && route.consumedBy === null && route.expiresAt > now && (boundary === undefined || route.at > boundary)
  )
}

/**
 * The tier `sf agents route` may answer instead of the routed one, on a bounded sample: the rung below it,
 * or a candidate that is new on the rung above it. Decided from the ledger alone, so the same history gives
 * the same answer:
 *
 * - the share of the kind's rated runs since the evidence started that were trials stays at or under the
 *   declared share, counting the run being offered and the routes already issued and not yet recorded
 *   (`(trials + 1) <= share x (runs + 1)`);
 * - never below a floor of the grid, never over the duration ceiling, never while the routed tier is itself failing;
 * - not again for the cooldown after a trial of that tier failed, and not once it has proven itself (the
 *   adjustment moves the kind then).
 */
export function selectTrial(kind: TaskKind, provider: RoutingProvider, ctx: AdjustContext): TrialOffer | undefined {
  const route = resolveRoute(kind, provider, ctx.shared, autoKindsFor(ctx.local, provider))
  const policy = ctx.policy
  if (!policy.enabled || ctx.shared?.kinds?.[kind] || tierRank(route.tier) < 0) return undefined
  const here = candidateId(route.candidate)
  if (stats(ctx, kind, provider, here, { fresh: true, limit: policy.escalateOf }).failures >= policy.escalateFailures) return undefined
  const cutoff = ctx.now.getTime() - policy.trialCooldownDays * DAY_MS
  const eligible = (rung: Rung, direction: 'down' | 'up'): boolean => {
    if (direction === 'down' && policy.maxDurationMs !== null) {
      const history = stats(ctx, kind, provider, rung.id, { fresh: false })
      if (history.durationP95Ms !== null && history.durationP95Ms > policy.maxDurationMs) return false
    }
    const failedRecently = kindRuns(ctx, kind, provider).some(
      (run) => run.decisive && run.trial && run.effectiveOutcome !== 'success' && Date.parse(run.at) >= cutoff && runCandidateId(run, ctx.shared) === rung.id
    )
    if (failedRecently) return false
    return !proven(policy, stats(ctx, kind, provider, rung.id, { fresh: true, trialOnly: true }))
  }
  const up = nextRung('up', route.tier, kind, provider, ctx.shared)
  const down = nextRung('down', route.tier, kind, provider, ctx.shared)
  // A new stronger candidate is tried first: it is the one nobody has measured.
  const pick: { rung: Rung; direction: 'down' | 'up' } | undefined =
    up && isNewCandidate(ctx.local, provider, up.tier, ctx.shared, ctx.now) && eligible(up, 'up')
      ? { rung: up, direction: 'up' }
      : down && eligible(down, 'down')
        ? { rung: down, direction: 'down' }
        : undefined
  if (!pick) return undefined
  const boundary = ctx.local.boundaries[kind]?.[provider]
  const since = kindRuns(ctx, kind, provider).filter((run) => run.decisive && (boundary === undefined || run.at > boundary))
  const pending = pendingRoutes(ctx, kind, provider)
  const trials = since.filter((run) => run.trial).length + pending.filter((entry) => entry.trial).length
  const total = since.length + pending.length
  // Whole numbers on both sides: a share that is exactly reached must not be refused by a rounding error.
  if ((trials + 1) * 1_000_000 > Math.round(policy.trialShare * 1_000_000) * (total + 1)) return undefined
  return { tier: pick.rung.tier, candidate: pick.rung.candidate, effectiveTier: route.tier, direction: pick.direction }
}

// --- applying -----------------------------------------------------------------------------------------

export interface AdjustOutcome {
  decisions: Decision[]
  /** The layer after the decisions; the same object when nothing changed. */
  local: LocalRouting
  /** A kind moved to another tier. */
  moved: boolean
  /** The layer differs (a move, a hold that changed, a new candidate seen): it has to be written. */
  changed: boolean
}

/**
 * Note the candidate each tier of the ladder runs. The first look records them all as accepted; after it,
 * a tier whose candidate changed or that appeared is `new` until a decision adopts it.
 */
export function reconcileLadders(local: LocalRouting, shared: RoutingOverrides | undefined, now: Date): LocalRouting {
  const at = now.toISOString()
  let ladders = local.ladders
  for (const provider of ROUTING_PROVIDERS) {
    const known = ladders[provider]
    const next: Record<string, LocalLadderEntry> = { ...(known ?? {}) }
    let changed = !known
    for (const tier of TIER_LADDER) {
      const candidate = resolveTierCandidate(tier, provider, shared)
      if (!candidate) continue
      const id = candidateId(candidate)
      const entry = known?.[tier]
      if (entry?.candidate === id) continue
      next[tier] = { candidate: id, since: at, status: known ? 'new' : 'accepted' }
      changed = true
    }
    if (changed) ladders = { ...ladders, [provider]: next }
  }
  return ladders === local.ladders ? local : { ...local, ladders }
}

/**
 * Evaluate every kind and provider the ledger has runs for, and apply the decisions to the local layer:
 * a move (the entry, the evidence boundary, the log), a hold whose reason changed (the log), a new
 * candidate adopted. A kind that returns to its shipped candidate loses its entry instead of keeping one
 * that says nothing. Nothing is applied while `ctx.policy` is disabled for a kind, which holds it.
 */
export function adjustRouting(ctx: AdjustContext): AdjustOutcome {
  const decisions: Decision[] = []
  const at = ctx.now.toISOString()
  let local = reconcileLadders(ctx.local, ctx.shared, ctx.now)
  let moved = false
  for (const kind of TASK_KINDS) {
    for (const provider of ROUTING_PROVIDERS) {
      if (!kindRuns(ctx, kind, provider).length) continue
      const decision = evaluateKind(kind, provider, { ...ctx, local })
      decisions.push(decision)
      if (decision.action === 'hold' || decision.to === null || !decision.evidence) {
        const previous = local.holds[kind]?.[provider]
        if (previous?.reason === decision.hold || decision.hold === null) continue
        local = withLogEntry(
          { ...local, holds: { ...local.holds, [kind]: { ...(local.holds[kind] ?? {}), [provider]: { reason: decision.hold!, since: at } } } },
          { at, action: 'hold', kind, provider, from: decision.from, to: decision.from, evidence: decision.evidence, note: `${decision.hold}: ${decision.reason}` }
        )
        continue
      }
      moved = true
      // Back on the shipped candidate, the entry goes: the tier name may differ from the shipped one when tiers share a candidate.
      const shipped = resolveRoute(kind, provider, undefined)
      const target = resolveTierCandidate(decision.to, provider, ctx.shared)
      const backToShipped = decision.to === shipped.tier || (target !== undefined && candidateId(target) === candidateId(shipped.candidate))
      const entry: LocalAdjustment = { tier: decision.to, from: decision.from, action: decision.action, at, evidence: decision.evidence }
      const providers = { ...(local.kinds[kind] ?? {}) }
      if (backToShipped) delete providers[provider]
      else providers[provider] = entry
      const kinds = { ...local.kinds, [kind]: providers }
      if (!Object.keys(providers).length) delete kinds[kind]
      const holds = { ...local.holds, [kind]: { ...(local.holds[kind] ?? {}) } }
      delete holds[kind]![provider]
      if (!Object.keys(holds[kind]!).length) delete holds[kind]
      local = withLogEntry(
        { ...local, kinds, holds, boundaries: { ...local.boundaries, [kind]: { ...(local.boundaries[kind] ?? {}), [provider]: at } } },
        { at, action: decision.action, kind, provider, from: decision.from, to: decision.to, evidence: decision.evidence, note: null }
      )
      if (decision.adopts) {
        const entryOf = local.ladders[provider]?.[decision.to]
        if (entryOf?.status === 'new') {
          local = withLogEntry(
            { ...local, ladders: { ...local.ladders, [provider]: { ...local.ladders[provider], [decision.to]: { ...entryOf, status: 'accepted' } } } },
            { at, action: 'adopt', kind, provider, from: decision.from, to: decision.to, evidence: decision.evidence, note: `the new ${decision.to} candidate (${entryOf.candidate}) is accepted` }
          )
        }
      }
    }
  }
  return { decisions, local, moved, changed: local !== ctx.local }
}
