import { captureState, type CaptureState } from './delegation-hooks'
import type { Complexity, LedgerRun, Nature } from './delegation-ledger'
import type { AdjustPolicy } from './routing-adjust-config'
import { expectedFeatureCost, formatCost, nearestRank, nextRung, runCandidateId, windowStats } from './routing-adjust'
import { resolveRoute, ROUTING_PROVIDERS, TASK_KINDS, tierRank, type RoutingProvider, type TaskKind } from './routing-grid'
import { autoKindsFor, listLocalAdjustments, staleTierAgentPaths, type LocalAdjustment } from './routing-local'
import type { RoutingState } from './routing-runtime'
import { ExactRational } from '../execution/exact-cost'

/**
 * `sf agents routing report` (#1035, AC-3): what the routed delegations of this clone cost and whether they did
 * the job, per task kind and tier, and per ticket by complexity. It reads the ledger and the local layer and
 * writes nothing.
 *
 * What it cannot see is said, not hidden: the session's own orchestration (the tokens it spends planning,
 * talking and reviewing) is not metered by any host hook, so a ticket's cost here is the cost of its
 * delegations; and a model without a price has runs but no cost.
 */
export const REPORT_VERSION = 1
const PER_TICKET_LIMIT = 50

export interface TierRow {
  kind: TaskKind
  provider: RoutingProvider
  tier: string
  /** The candidate most of the runs recorded. */
  candidate: { model: string | null; effort: string | null }
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
  /** What delivering the work costs on this tier, failures included. */
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

export interface TicketAggregate {
  tickets: number
  /** Tickets with a cost, every delegation of which was priced or not: see `TicketRow.costComplete`. */
  withCost: number
  cost: { median: string | null; p95: string | null }
  /** Wall-clock of the delegations, summed per ticket. */
  delegationMs: Spread
  /** From the start of the first delegation to the end of the last one. */
  spanMs: Spread
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
  delegationMs: number | null
  spanMs: number | null
  lastAt: string
}

export interface ComplexityRow extends TicketAggregate {
  complexity: Complexity | null
  byNature: ({ nature: Nature | null } & TicketAggregate)[]
}

export interface RoutingReport {
  reportVersion: 1
  generatedAt: string
  ledger: { runs: number; rated: number; censored: number; unattributed: number; skippedLines: number; unmatchedSignals: number }
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
  staleTierAgents: string[]
}

const rate = (successes: number, rated: number): number | null => (rated ? Math.round((successes / rated) * 10_000) / 10_000 : null)

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null
}

function tierRow(kind: TaskKind, provider: RoutingProvider, tier: string, group: LedgerRun[], nextUpCost: ExactRational | null): TierRow {
  const rated = group.filter((run) => !run.censored)
  const stats = windowStats('group', rated)
  return {
    kind,
    provider,
    tier,
    candidate: { model: mostCommon(group.map((run) => run.candidate.model)), effort: mostCommon(group.map((run) => run.candidate.effort)) },
    runs: group.length,
    rated: rated.length,
    censored: group.length - rated.length,
    successes: stats.successes,
    failures: stats.failures,
    successRate: rate(stats.successes, rated.length),
    trialRuns: group.filter((run) => run.trial).length,
    cost: { priced: stats.priced, mean: formatCost(stats.meanCost), median: formatCost(stats.costMedian), p95: formatCost(stats.costP95) },
    durationMs: { median: stats.durationMedianMs, p95: stats.durationP95Ms },
    expectedFeatureCost: formatCost(expectedFeatureCost(stats, nextUpCost))
  }
}

function kindRows(state: RoutingState): KindRow[] {
  const shared = state.project.routing
  const rows: KindRow[] = []
  for (const kind of TASK_KINDS) {
    for (const provider of ROUTING_PROVIDERS) {
      const runs = state.ledger.runs.filter((run) => run.taskKind === kind && run.provider === provider)
      if (!runs.length) continue
      const route = resolveRoute(kind, provider, shared, autoKindsFor(state.local, provider))
      const byTier = new Map<string, LedgerRun[]>()
      for (const run of runs) byTier.set(run.tier, [...(byTier.get(run.tier) ?? []), run])
      const tiers = [...byTier.keys()].sort((left, right) => tierRank(left) - tierRank(right) || left.localeCompare(right))
      rows.push({
        kind,
        provider,
        routedTier: route.tier,
        source: route.source,
        tiers: tiers.map((tier) => {
          const up = nextRung('up', tier, kind, provider, shared)
          const upRuns = up ? runs.filter((run) => !run.censored && runCandidateId(run, shared) === up.id) : []
          return tierRow(kind, provider, tier, byTier.get(tier)!, upRuns.length ? windowStats(up!.id, upRuns).meanCost : null)
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

function aggregate(rows: TicketRow[]): TicketAggregate {
  const costs = rows.flatMap((row) => (row.cost === null ? [] : [ExactRational.decimal(row.cost)])).sort((left, right) => left.compare(right))
  return {
    tickets: rows.length,
    withCost: costs.length,
    cost: { median: formatCost(nearestRank(costs, 0.5)), p95: formatCost(nearestRank(costs, 0.95)) },
    delegationMs: spread(rows.flatMap((row) => (row.delegationMs === null ? [] : [row.delegationMs]))),
    spanMs: spread(rows.flatMap((row) => (row.spanMs === null ? [] : [row.spanMs]))),
    runs: spread(rows.map((row) => row.runs))
  }
}

function ticketRows(runs: readonly LedgerRun[]): TicketRow[] {
  const byTicket = new Map<number, LedgerRun[]>()
  for (const run of runs) if (run.ticket !== null) byTicket.set(run.ticket, [...(byTicket.get(run.ticket) ?? []), run])
  return [...byTicket.entries()].map(([ticket, group]) => {
    const priced = group.filter((run) => run.cost !== null)
    const durations = group.filter((run) => run.durationMs !== null)
    const starts = group.map((run) => Date.parse(run.at) - (run.durationMs ?? 0))
    const ends = group.map((run) => Date.parse(run.at))
    const total = priced.reduce((sum, run) => sum.add(ExactRational.decimal(run.cost!.amount)), new ExactRational(0n))
    return {
      ticket,
      complexity: group.find((run) => run.complexity !== null)?.complexity ?? null,
      nature: group.find((run) => run.nature !== null)?.nature ?? null,
      runs: group.length,
      failures: group.filter((run) => !run.censored && run.effectiveOutcome !== 'success').length,
      escalated: group.filter((run) => run.escalated).length,
      cost: priced.length ? formatCost(total) : null,
      costComplete: priced.length === group.length,
      delegationMs: durations.length ? durations.reduce((sum, run) => sum + run.durationMs!, 0) : null,
      spanMs: Math.max(...ends) - Math.min(...starts),
      lastAt: group[group.length - 1].at
    }
  })
}

function complexityRows(rows: TicketRow[]): ComplexityRow[] {
  const order: (Complexity | null)[] = ['bug', 'low', 'medium', 'complex', null]
  return order.flatMap((complexity) => {
    const group = rows.filter((row) => row.complexity === complexity)
    if (!group.length) return []
    const natures = (['user-facing', 'internal', 'bundled-pr', null] as (Nature | null)[]).flatMap((nature) => {
      const part = group.filter((row) => row.nature === nature)
      return part.length ? [{ nature, ...aggregate(part) }] : []
    })
    return [{ complexity, ...aggregate(group), byNature: natures }]
  })
}

export async function buildRoutingReport(state: RoutingState, now: Date = new Date()): Promise<RoutingReport> {
  const runs = state.ledger.runs
  const { prices, ...policy } = state.project.policy
  const tickets = ticketRows(runs)
  const perTicket = [...tickets].sort((left, right) => (left.lastAt < right.lastAt ? 1 : left.lastAt > right.lastAt ? -1 : 0)).slice(0, PER_TICKET_LIMIT)
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: now.toISOString(),
    ledger: {
      runs: runs.length,
      rated: runs.filter((run) => !run.censored).length,
      censored: runs.filter((run) => run.censored).length,
      unattributed: runs.filter((run) => run.taskKind === null).length,
      skippedLines: state.ledger.skipped,
      unmatchedSignals: state.ledger.unmatchedSignals
    },
    policy: { ...policy, declaredPrices: Object.keys(prices).sort() },
    unpricedModels: [...new Set(runs.flatMap((run) => (run.tokens !== null && run.cost === null && run.candidate.model ? [run.candidate.model] : [])))].sort(),
    capture: await Promise.all(state.project.agents.map(async (agent) => ({ agent, state: await captureState(state.root, agent) }))),
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
    staleTierAgents: staleTierAgentPaths(state.project.agents, state.project.routing, state.local)
  }
}

// --- the text a person reads --------------------------------------------------------------------------

const usd = (amount: string | null): string => (amount === null ? '-' : `$${amount.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')}`)
const seconds = (ms: number | null): string => (ms === null ? '-' : ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}min`)
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
    `Runs recorded: ${ledger.runs} (${ledger.rated} rated, ${ledger.censored} censored${ledger.unattributed ? `, ${ledger.unattributed} without a task kind` : ''}). A censored run has no usable outcome: it is kept, and never counts as a success.`
  )
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
    lines.push('Feature cost: the cost of delivering the work on that tier, failures included (cost per run / success rate + what a failure triggers).')
  } else lines.push('No delegation with a task kind is recorded yet.')
  lines.push('')
  if (report.tickets.byComplexity.length) {
    lines.push('Per ticket, by complexity (the cost and time of its delegations; the session orchestration is not metered)')
    const rows = report.tickets.byComplexity.map((row) => [
      row.complexity ?? 'unknown',
      String(row.tickets),
      `${usd(row.cost.median)} / ${usd(row.cost.p95)}`,
      `${seconds(row.delegationMs.median)} / ${seconds(row.delegationMs.p95)}`,
      `${seconds(row.spanMs.median)} / ${seconds(row.spanMs.p95)}`
    ])
    lines.push(...table(['complexity', 'tickets', 'cost median / p95', 'delegated time median / p95', 'span median / p95'], rows))
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
  return `${lines.join('\n')}\n`
}
