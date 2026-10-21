import { captureState, type CaptureProbe, type CaptureState } from './delegation-hooks'
import type { Complexity, LedgerRun, Nature, TicketStatusRecord } from './delegation-ledger'
import type { AdjustPolicy } from './routing-adjust-config'
import { candidateId, featureCosts, formatCost, HOLD_TEXT, ladderRungs, nearestRank, runCandidateId, windowStats, type HoldReason } from './routing-adjust'
import { resolveRoute, resolveTierCandidate, ROUTING_PROVIDERS, TASK_KINDS, tierRank, type RoutingProvider, type TaskKind } from './routing-grid'
import { autoKindsFor, listLocalAdjustments, listLocalHolds, staleTierAgentPaths, type LocalAdjustment } from './routing-local'
import type { RoutingState } from './routing-runtime'
import { ExactRational } from '../execution/exact-cost'

/**
 * `sf agents routing report` (#1035, AC-3): what the routed delegations of this clone cost and whether they did
 * the job, per task kind and tier, and per ticket by complexity. It reads the ledger and the local layer and
 * writes nothing.
 *
 * What it cannot see is said, not hidden: the session's own orchestration (the tokens it spends planning,
 * talking and reviewing) is not metered by any host hook, so a ticket's cost here is the cost of its
 * delegations; a model without a price has runs but no cost; and a ticket's duration comes from the status
 * transitions the workflow CLI recorded, which a clone that never ran it has not.
 */
export const REPORT_VERSION = 2
const PER_TICKET_LIMIT = 50

export interface TierRow {
  kind: TaskKind
  provider: RoutingProvider
  tier: string
  /** The candidate most of the runs recorded. */
  candidate: { model: string | null; effort: string | null }
  /** Delegations: an agent resumed after a hand-back is one delegation with several stops. */
  runs: number
  /** Runs a rate may count: an outcome that judges the tier. */
  rated: number
  /** Runs kept and shown but never counted as a success or a failure: no usable outcome, or an unavailable candidate. */
  censored: number
  successes: number
  failures: number
  successRate: number | null
  trialRuns: number
  cost: { priced: number; mean: string | null; median: string | null; p95: string | null }
  durationMs: { median: number | null; p95: number | null }
  /** What delivering the work costs on this tier, failures included: c + (1 - s) x the cost of the next tier up. */
  expectedFeatureCost: string | null
}

export interface KindRow {
  kind: TaskKind
  provider: RoutingProvider
  routedTier: string
  source: 'shipped' | 'project' | 'auto'
  tiers: TierRow[]
}

export interface Spread {
  median: number | null
  p95: number | null
}

export interface CostSpread {
  tickets: number
  median: string | null
  p95: string | null
}

export interface TicketAggregate {
  tickets: number
  /** Tickets whose delegations were all priced: the only ones the cost medians are made of. */
  withCost: number
  cost: CostSpread
  /** Tickets with a delegation that has no cost: their figure is a lower bound, kept apart from the medians. */
  incompleteCost: CostSpread
  /** Active time of the delegations, summed per ticket (the idle time between a stop and a resume left out). */
  delegationMs: Spread
  /** From the first In progress to the first Human testing (In review for a ticket that skips it), from the recorded status transitions. */
  ticketMs: Spread
  runs: Spread
}

export interface TicketRow {
  ticket: number
  complexity: Complexity | null
  nature: Nature | null
  runs: number
  failures: number
  escalated: number
  cost: string | null
  /** False when a delegation of the ticket has no cost: the figure is a lower bound. */
  costComplete: boolean
  /** Active time of the delegations. */
  delegationMs: number | null
  /** First In progress to first Human testing (or In review); null without the recorded transitions. */
  ticketMs: number | null
  lastAt: string
}

export interface ComplexityRow extends TicketAggregate {
  complexity: Complexity | null
  byNature: ({ nature: Nature | null } & TicketAggregate)[]
}

export interface RoutingReport {
  reportVersion: typeof REPORT_VERSION
  generatedAt: string
  ledger: { runs: number; stops: number; rated: number; censored: number; manual: number; unattributed: number; skippedLines: number; unmatchedSignals: number }
  policy: Omit<AdjustPolicy, 'prices'> & { declaredPrices: string[] }
  /** Models that ran with a token count but have no price: their runs count for reliability, never for cost. Declare them in routing.adjust.prices. */
  unpricedModels: string[]
  capture: { agent: string; state: CaptureState }[]
  kinds: KindRow[]
  tickets: { byComplexity: ComplexityRow[]; perTicket: TicketRow[] }
  localAdjustments: {
    kind: TaskKind
    provider: RoutingProvider
    tier: string
    from: string
    action: LocalAdjustment['action']
    at: string
    rule: string
    expectedFeatureCost: { from: string | null; to: string | null }
  }[]
  /** Kinds the adjustment looked at and left where they are, with the reason, since when. */
  holds: { kind: TaskKind; provider: RoutingProvider; reason: string; text: string; since: string }[]
  staleTierAgents: string[]
}

const rate = (successes: number, rated: number): number | null => (rated ? Math.round((successes / rated) * 10_000) / 10_000 : null)

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null
}

function group<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const name = key(item)
    if (name === null) continue
    const list = groups.get(name)
    if (list) list.push(item)
    else groups.set(name, [item])
  }
  return groups
}

function tierRow(kind: TaskKind, provider: RoutingProvider, tier: string, runs: LedgerRun[], expected: ExactRational | null): TierRow {
  const rated = runs.filter((run) => !run.censored)
  const stats = windowStats('group', rated)
  return {
    kind,
    provider,
    tier,
    candidate: { model: mostCommon(runs.map((run) => run.candidate.model)), effort: mostCommon(runs.map((run) => run.candidate.effort)) },
    runs: runs.length,
    rated: rated.length,
    censored: runs.length - rated.length,
    successes: stats.successes,
    failures: stats.failures,
    successRate: rate(stats.successes, rated.length),
    trialRuns: runs.filter((run) => run.trial).length,
    cost: { priced: stats.priced, mean: formatCost(stats.meanCost), median: formatCost(stats.costMedian), p95: formatCost(stats.costP95) },
    durationMs: { median: stats.durationMedianMs, p95: stats.durationP95Ms },
    expectedFeatureCost: formatCost(expected)
  }
}

function kindRows(state: RoutingState): KindRow[] {
  const shared = state.project.routing
  // A stop that a later stop of the same agent supersedes is part of that delegation: the final stop stands for it.
  const delegations = state.ledger.runs.filter((run) => !run.superseded && run.taskKind !== null)
  const byKind = group(delegations, (run) => `${run.taskKind}/${run.provider}`)
  const rows: KindRow[] = []
  for (const kind of TASK_KINDS) {
    for (const provider of ROUTING_PROVIDERS) {
      const runs = byKind.get(`${kind}/${provider}`)
      if (!runs?.length) continue
      const route = resolveRoute(kind, provider, shared, autoKindsFor(state.local, provider))
      const byTier = group(runs, (run) => run.tier)
      const byCandidate = group(
        runs.filter((run) => !run.censored),
        (run) => runCandidateId(run, shared) ?? null
      )
      // What delivering the work costs on each rung: a failure is paid at the rung above, once.
      const costs = featureCosts(ladderRungs(kind, provider, shared), (rung) => windowStats(rung.id, byCandidate.get(rung.id) ?? []))
      const tiers = [...byTier.keys()].sort((left, right) => tierRank(left) - tierRank(right) || left.localeCompare(right))
      rows.push({
        kind,
        provider,
        routedTier: route.tier,
        source: route.source,
        tiers: tiers.map((tier) => {
          const candidate = resolveTierCandidate(tier, provider, shared)
          return tierRow(kind, provider, tier, byTier.get(tier)!, (candidate ? costs.get(candidateId(candidate)) : null) ?? null)
        })
      })
    }
  }
  return rows
}

const spread = (values: number[]): Spread => {
  const sorted = [...values].sort((left, right) => left - right)
  return { median: nearestRank(sorted, 0.5), p95: nearestRank(sorted, 0.95) }
}

function costSpread(rows: TicketRow[]): CostSpread {
  const costs = rows.flatMap((row) => (row.cost === null ? [] : [ExactRational.decimal(row.cost)])).sort((left, right) => left.compare(right))
  return { tickets: costs.length, median: formatCost(nearestRank(costs, 0.5)), p95: formatCost(nearestRank(costs, 0.95)) }
}

function aggregate(rows: TicketRow[]): TicketAggregate {
  const complete = rows.filter((row) => row.costComplete)
  return {
    tickets: rows.length,
    withCost: complete.filter((row) => row.cost !== null).length,
    cost: costSpread(complete),
    incompleteCost: costSpread(rows.filter((row) => !row.costComplete)),
    delegationMs: spread(rows.flatMap((row) => (row.delegationMs === null ? [] : [row.delegationMs]))),
    ticketMs: spread(rows.flatMap((row) => (row.ticketMs === null ? [] : [row.ticketMs]))),
    runs: spread(rows.map((row) => row.runs))
  }
}

/** First In progress to first Human testing, or to first In review when the ticket never went through Human testing. */
function ticketDuration(statuses: readonly TicketStatusRecord[]): number | null {
  const first = (name: string): number | undefined => {
    const times = statuses.filter((entry) => entry.status === name).map((entry) => Date.parse(entry.at))
    return times.length ? Math.min(...times) : undefined
  }
  const start = first('in progress')
  const end = first('human testing') ?? first('in review')
  return start !== undefined && end !== undefined && end >= start ? end - start : null
}

function ticketRows(runs: readonly LedgerRun[], statuses: readonly TicketStatusRecord[]): TicketRow[] {
  const byTicket = new Map<number, LedgerRun[]>()
  for (const run of runs) {
    if (run.ticket === null || run.superseded) continue
    const list = byTicket.get(run.ticket)
    if (list) list.push(run)
    else byTicket.set(run.ticket, [run])
  }
  const statusesOf = new Map<number, TicketStatusRecord[]>()
  for (const entry of statuses) {
    const list = statusesOf.get(entry.ticket)
    if (list) list.push(entry)
    else statusesOf.set(entry.ticket, [entry])
  }
  return [...byTicket.entries()].map(([ticket, group]) => {
    const priced = group.filter((run) => run.countedCost !== null)
    const durations = group.filter((run) => run.countedDurationMs !== null)
    const total = priced.reduce((sum, run) => sum.add(ExactRational.decimal(run.countedCost!.amount)), new ExactRational(0n))
    return {
      ticket,
      complexity: group.find((run) => run.complexity !== null)?.complexity ?? null,
      nature: group.find((run) => run.nature !== null)?.nature ?? null,
      runs: group.length,
      failures: group.filter((run) => !run.censored && run.effectiveOutcome !== 'success').length,
      escalated: group.filter((run) => run.escalated).length,
      cost: priced.length ? formatCost(total) : null,
      costComplete: priced.length === group.length,
      delegationMs: durations.length ? durations.reduce((sum, run) => sum + run.countedDurationMs!, 0) : null,
      ticketMs: ticketDuration(statusesOf.get(ticket) ?? []),
      lastAt: group[group.length - 1].at
    }
  })
}

function complexityRows(rows: TicketRow[]): ComplexityRow[] {
  const order: (Complexity | null)[] = ['bug', 'low', 'medium', 'complex', null]
  return order.flatMap((complexity) => {
    const part = rows.filter((row) => row.complexity === complexity)
    if (!part.length) return []
    const natures = (['user-facing', 'internal', 'bundled-pr', null] as (Nature | null)[]).flatMap((nature) => {
      const sub = part.filter((row) => row.nature === nature)
      return sub.length ? [{ nature, ...aggregate(sub) }] : []
    })
    return [{ complexity, ...aggregate(part), byNature: natures }]
  })
}

export async function buildRoutingReport(state: RoutingState, now: Date = new Date(), options: { probe?: CaptureProbe } = {}): Promise<RoutingReport> {
  const all = state.ledger.runs
  const runs = all.filter((run) => !run.superseded)
  const { prices, ...policy } = state.project.decision.policy
  const tickets = ticketRows(all, state.ledger.statuses)
  const perTicket = [...tickets].sort((left, right) => (left.lastAt < right.lastAt ? 1 : left.lastAt > right.lastAt ? -1 : 0)).slice(0, PER_TICKET_LIMIT)
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: now.toISOString(),
    ledger: {
      runs: runs.length,
      stops: all.length,
      rated: runs.filter((run) => !run.censored).length,
      censored: runs.filter((run) => run.censored).length,
      manual: runs.filter((run) => run.host === 'manual').length,
      unattributed: runs.filter((run) => run.taskKind === null).length,
      skippedLines: state.ledger.skipped,
      unmatchedSignals: state.ledger.unmatchedSignals
    },
    policy: { ...policy, declaredPrices: Object.keys(prices).sort() },
    unpricedModels: [...new Set(all.flatMap((run) => (run.tokens !== null && run.cost === null && run.metering !== 'partial' && run.candidate.model ? [run.candidate.model] : [])))].sort(),
    capture: await Promise.all(state.project.agents.map(async (agent) => ({ agent, state: await captureState(state.root, agent, options.probe) }))),
    kinds: kindRows(state),
    tickets: { byComplexity: complexityRows(tickets), perTicket },
    localAdjustments: listLocalAdjustments(state.local).map(({ kind, provider, adjustment }) => ({
      kind,
      provider,
      tier: adjustment.tier,
      from: adjustment.from,
      action: adjustment.action,
      at: adjustment.at,
      rule: adjustment.evidence.rule,
      expectedFeatureCost: { from: adjustment.evidence.expectedFeatureCost?.from ?? null, to: adjustment.evidence.expectedFeatureCost?.to ?? null }
    })),
    holds: listLocalHolds(state.local).map(({ kind, provider, hold }) => ({ kind, provider, reason: hold.reason, text: HOLD_TEXT[hold.reason as HoldReason] ?? hold.reason, since: hold.since })),
    staleTierAgents: staleTierAgentPaths(state.project.agents, state.project.routing, state.local)
  }
}

// --- the text a person reads --------------------------------------------------------------------------

const usd = (amount: string | null): string => (amount === null ? '-' : `$${amount.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')}`)
const seconds = (ms: number | null): string => (ms === null ? '-' : ms < 120_000 ? `${Math.round(ms / 1000)}s` : ms < 7_200_000 ? `${(ms / 60_000).toFixed(1)}min` : `${(ms / 3_600_000).toFixed(1)}h`)
const percent = (value: number | null): string => (value === null ? '-' : `${Math.round(value * 100)}%`)

function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)))
  const line = (cells: string[]) => `  ${cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')}`.trimEnd()
  return [line(header), ...rows.map(line)]
}

export function renderRoutingReport(report: RoutingReport): string {
  const lines: string[] = ['Delegation report (this clone, all its worktrees)', '']
  const { ledger } = report
  lines.push(
    `Delegations recorded: ${ledger.runs} (${ledger.rated} rated, ${ledger.censored} censored${ledger.unattributed ? `, ${ledger.unattributed} without a route` : ''}${ledger.manual ? `, ${ledger.manual} recorded by hand and never moving the routing` : ''}). A censored run has no usable outcome: it is kept, and never counts as a success.`
  )
  if (ledger.stops > ledger.runs) lines.push(`${ledger.stops - ledger.runs} further stop${ledger.stops - ledger.runs === 1 ? '' : 's'} of resumed agents are counted in their delegation.`)
  if (ledger.skippedLines) lines.push(`${ledger.skippedLines} ledger line${ledger.skippedLines === 1 ? ' was' : 's were'} not a valid record and skipped.`)
  lines.push(`Capture: ${report.capture.map((entry) => `${entry.agent} ${entry.state}`).join(', ') || 'no declared coding agent'}.`)
  lines.push(
    `Adjustment: ${report.policy.enabled ? 'on' : 'off'} (escalate ${report.policy.escalateFailures} failures in ${report.policy.escalateOf}, de-escalate ${report.policy.deescalateSuccesses} trial successes with at most ${report.policy.deescalateFailures} failures, trials at most ${Math.round(report.policy.trialShare * 100)}% of the runs).`
  )
  if (report.unpricedModels.length) lines.push(`Unpriced: ${report.unpricedModels.join(', ')}. Their runs have no cost; declare a price in modules.harness.routing.adjust.prices.`)
  lines.push('')
  if (report.kinds.length) {
    lines.push('Per task kind and tier')
    const rows = report.kinds.flatMap((kind) =>
      kind.tiers.map((row) => [
        row.kind,
        row.provider,
        `${row.tier}${row.tier === kind.routedTier ? ` (${kind.source})` : ''}`,
        String(row.runs),
        `${percent(row.successRate)} of ${row.rated}`,
        String(row.censored),
        usd(row.cost.p95),
        seconds(row.durationMs.p95),
        usd(row.expectedFeatureCost)
      ])
    )
    lines.push(...table(['kind', 'agent', 'tier', 'runs', 'success', 'censored', 'p95 cost', 'p95 time', 'feature cost'], rows))
    lines.push(
      'Feature cost: the cost of delivering the work on that tier, failures included (cost per run + failure rate x the feature cost of the next tier up; at the top, cost per run / success rate).'
    )
  } else lines.push('No delegation with a route is recorded yet.')
  lines.push('')
  if (report.tickets.byComplexity.length) {
    lines.push('Per ticket, by complexity (the cost and active time of its delegations; the session orchestration is not metered)')
    const rows = report.tickets.byComplexity.map((row) => [
      row.complexity ?? 'unknown',
      String(row.tickets),
      `${usd(row.cost.median)} / ${usd(row.cost.p95)}${row.incompleteCost.tickets ? ` (+${row.incompleteCost.tickets} with an unpriced delegation, from ${usd(row.incompleteCost.median)})` : ''}`,
      `${seconds(row.delegationMs.median)} / ${seconds(row.delegationMs.p95)}`,
      `${seconds(row.ticketMs.median)} / ${seconds(row.ticketMs.p95)}`
    ])
    lines.push(...table(['complexity', 'tickets', 'cost median / p95', 'delegated active time median / p95', 'in progress to testing median / p95'], rows))
    lines.push('')
  }
  if (report.localAdjustments.length) {
    lines.push('Local adjustments, not promoted (sf agents routing promote to share one, sf agents routing reset <kind> to undo it)')
    for (const entry of report.localAdjustments) lines.push(`  ${entry.kind} (${entry.provider}): ${entry.from} → ${entry.tier}, ${entry.action} on ${entry.at.slice(0, 10)}. ${entry.rule}.`)
    if (report.staleTierAgents.length)
      lines.push(
        `  ${report.staleTierAgents.length} tier agent file${report.staleTierAgents.length === 1 ? '' : 's'} differ from the effective routing until a move is promoted and the agents refreshed; sf agents route is authoritative.`
      )
  } else lines.push('No local adjustment: the routing is the shared one.')
  if (report.holds.length) {
    lines.push('', 'Held (looked at and left where it is)')
    for (const entry of report.holds) lines.push(`  ${entry.kind} (${entry.provider}): ${entry.reason} since ${entry.since.slice(0, 10)} — ${entry.text}.`)
  }
  return `${lines.join('\n')}\n`
}
