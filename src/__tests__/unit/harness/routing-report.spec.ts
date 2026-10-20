import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { CLAUDE_CAPTURE_HOOKS } from '../../../harness/delegation-hooks'
import type { LedgerRun } from '../../../harness/delegation-ledger'
import { resolveAdjustPolicy, type RoutingAdjustConfig } from '../../../harness/routing-adjust-config'
import type { RoutingOverrides } from '../../../harness/routing-grid'
import { emptyLocalRouting, type LocalRouting } from '../../../harness/routing-local'
import { buildRoutingReport, renderRoutingReport, REPORT_VERSION } from '../../../harness/routing-report'
import type { RoutingState } from '../../../harness/routing-runtime'
import { history, one, runs, sequence, T0, type RunSpec } from '../../helpers/ledger-runs'

const NOW = new Date('2026-10-20T08:00:00.000Z')
const evidence = {
  rule: '3 failures in the last 10 rated runs (threshold 3 of 10)',
  from: { tier: 'build', candidate: 'a/b' },
  to: { tier: 'fix', candidate: 'c/d' },
  window: { rated: 10, successes: 7, failures: 3 },
  expectedFeatureCost: { from: '1.728572', to: null, currency: 'USD' as const },
  durationP95Ms: { from: null, to: null },
  runs: []
}

describe('sf agents routing report (#1035, AC-3)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-report-'))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  const state = (all: LedgerRun[], extra: { local?: LocalRouting; shared?: RoutingOverrides; agents?: RoutingState['project']['agents']; adjust?: RoutingAdjustConfig } = {}): RoutingState => ({
    root,
    dir: undefined,
    project: { agents: extra.agents ?? ['claude-code'], routing: extra.shared, policy: resolveAdjustPolicy(extra.adjust) },
    ledger: { runs: all, skipped: 0, unmatchedSignals: 0 },
    local: extra.local ?? emptyLocalRouting()
  })

  it('has a stable, versioned envelope', async () => {
    const report = await buildRoutingReport(state([]), NOW)
    expect(REPORT_VERSION).toBe(1)
    expect(Object.keys(report)).toEqual(['reportVersion', 'generatedAt', 'ledger', 'policy', 'unpricedModels', 'capture', 'kinds', 'tickets', 'localAdjustments', 'staleTierAgents'])
    expect(report).toMatchObject({
      reportVersion: 1,
      generatedAt: NOW.toISOString(),
      ledger: { runs: 0, rated: 0, censored: 0, unattributed: 0, skippedLines: 0, unmatchedSignals: 0 },
      kinds: [],
      tickets: { byComplexity: [], perTicket: [] },
      localAdjustments: [],
      staleTierAgents: []
    })
    // The policy in force is shown without the prices, which are listed by model name
    expect(Object.keys(report.policy).sort()).toEqual([
      'costBand',
      'declaredPrices',
      'deescalateFailures',
      'deescalateSuccesses',
      'enabled',
      'escalateFailures',
      'escalateOf',
      'maxDurationMs',
      'trialCooldownDays',
      'trialShare',
      'window'
    ])
  })

  describe('per task kind and tier', () => {
    const costs = Array.from({ length: 20 }, (_, index) => index + 1)

    it('counts the runs, the success rate and the p95 cost and duration of each tier', async () => {
      const build = costs.map((cost, index) => one({ tier: 'build', cost: `${cost}.00000000`, durationMs: (index + 1) * 1000, outcome: index < 15 ? 'success' : 'fail' }))
      const trial = runs(4, { tier: 'edit', trial: true, cost: '0.20000000', durationMs: 30_000 })
      const report = await buildRoutingReport(state(history(build, trial)), NOW)
      expect(report.kinds).toHaveLength(1)
      const [kind] = report.kinds
      expect(kind).toMatchObject({ kind: 'multi-file-feature', provider: 'claude-code', routedTier: 'build', source: 'shipped' })
      expect(kind.tiers.map((row) => row.tier)).toEqual(['edit', 'build'])
      expect(kind.tiers[1]).toMatchObject({
        tier: 'build',
        candidate: { model: 'claude-sonnet-5-5', effort: 'xhigh' },
        runs: 20,
        rated: 20,
        censored: 0,
        successes: 15,
        failures: 5,
        successRate: 0.75,
        trialRuns: 0,
        // nearest-rank p95 of twenty values is the nineteenth
        cost: { priced: 20, mean: '10.500000', median: '10.000000', p95: '19.000000' },
        durationMs: { median: 10_000, p95: 19_000 }
      })
      expect(kind.tiers[0]).toMatchObject({ tier: 'edit', runs: 4, successRate: 1, trialRuns: 4, cost: { p95: '0.200000' } })
    })

    it('shows the expected feature cost of a tier, failures included, with the next tier up as what a failure triggers', async () => {
      const report = await buildRoutingReport(state(history(sequence('sssssssfff', { tier: 'build', cost: '1.00000000' }), runs(5, { tier: 'fix', cost: '4.00000000' }))), NOW)
      const rows = Object.fromEntries(report.kinds[0].tiers.map((row) => [row.tier, row]))
      // 1 / 0.7 + 0.3 x 4 = 2.628572 (rounded up once); the fix tier always succeeds at $4
      expect(rows.build.expectedFeatureCost).toBe('2.628572')
      expect(rows.fix.expectedFeatureCost).toBe('4.000000')
    })

    it('keeps a run that has no verdict out of the rates and shows it as censored', async () => {
      const all = history(runs(4), runs(3, { outcome: 'outcome-unknown' }), runs(1, { outcome: 'cancelled' }), runs(1, { outcome: 'candidate-unavailable' }))
      const report = await buildRoutingReport(state(all), NOW)
      expect(report.kinds[0].tiers[0]).toMatchObject({ runs: 9, rated: 4, censored: 5, successRate: 1 })
      expect(report.ledger).toMatchObject({ runs: 9, rated: 4, censored: 5 })
    })

    it('counts a run without a task kind in the ledger totals and in no row', async () => {
      const report = await buildRoutingReport(state(history(runs(3), runs(2, { kind: null }))), NOW)
      expect(report.ledger).toMatchObject({ runs: 5, unattributed: 2, censored: 2 })
      expect(report.kinds).toHaveLength(1)
      expect(report.kinds[0].tiers[0].runs).toBe(3)
    })

    it('keeps the two coding agents apart and orders the rows by kind, agent and ladder', async () => {
      const all = history(runs(2, { kind: 'tests', provider: 'codex' }), runs(2, { kind: 'bug-fix', tier: 'fix' }), runs(2, { kind: 'tests' }))
      const report = await buildRoutingReport(state(all, { agents: ['claude-code', 'codex'] }), NOW)
      expect(report.kinds.map((row) => [row.kind, row.provider])).toEqual([
        ['bug-fix', 'claude-code'],
        ['tests', 'claude-code'],
        ['tests', 'codex']
      ])
    })

    it('says which tier the kind is routed to and where that choice comes from', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const report = await buildRoutingReport(state(history(runs(2, { tier: 'build' }), runs(2, { tier: 'fix' })), { local }), NOW)
      expect(report.kinds[0]).toMatchObject({ routedTier: 'fix', source: 'auto' })
      expect(report.kinds[0].tiers.map((row) => row.tier)).toEqual(['build', 'fix'])
    })
  })

  describe('per ticket, by complexity', () => {
    const ticket = (number: number, complexity: 'bug' | 'low' | 'medium' | 'complex', costs: (string | null)[], extra: RunSpec = {}) =>
      costs.map((cost, index) => one({ ticket: number, complexity, cost, durationMs: 60_000, at: new Date(T0 + (number * 1000 + index) * 60_000).toISOString(), ...extra }))

    it('gives the median and p95 of the cost and the time of the delegations of each ticket', async () => {
      const all = history(ticket(1, 'bug', ['0.50000000']), ticket(2, 'medium', ['1.00000000', '1.00000000']), ticket(3, 'medium', ['5.00000000']), ticket(4, 'complex', ['2.00000000', '3.00000000']))
      const report = await buildRoutingReport(state(all), NOW)
      expect(report.tickets.byComplexity.map((row) => [row.complexity, row.tickets])).toEqual([
        ['bug', 1],
        ['medium', 2],
        ['complex', 1]
      ])
      const medium = report.tickets.byComplexity.find((row) => row.complexity === 'medium')!
      expect(medium).toMatchObject({
        tickets: 2,
        withCost: 2,
        cost: { median: '2.000000', p95: '5.000000' },
        // delegations of 60 s each: two for one ticket, one for the other
        delegationMs: { median: 60_000, p95: 120_000 },
        runs: { median: 1, p95: 2 }
      })
      expect(report.tickets.byComplexity.find((row) => row.complexity === 'complex')).toMatchObject({ cost: { median: '5.000000', p95: '5.000000' } })
    })

    it('shows the retries, the failures and a cost that is only a lower bound', async () => {
      const report = await buildRoutingReport(state(history(ticket(7, 'complex', ['2.00000000', null], { nature: 'user-facing' }))), NOW)
      const row = report.tickets.perTicket[0]
      expect(row).toMatchObject({ ticket: 7, complexity: 'complex', nature: 'user-facing', runs: 2, cost: '2.000000', costComplete: false, failures: 0 })
      expect(report.tickets.byComplexity[0].byNature).toEqual([expect.objectContaining({ nature: 'user-facing', tickets: 1 })])
    })

    it('reports the span from the first start to the last end, and the last tickets first', async () => {
      const first = one({ ticket: 1, complexity: 'low', durationMs: 60_000, at: '2026-10-02T10:01:00.000Z' })
      const second = one({ ticket: 1, complexity: 'low', durationMs: 60_000, at: '2026-10-02T10:11:00.000Z' })
      const other = one({ ticket: 2, complexity: 'low', at: '2026-10-03T10:00:00.000Z' })
      const report = await buildRoutingReport(state(history([first, second, other])), NOW)
      expect(report.tickets.perTicket.map((row) => row.ticket)).toEqual([2, 1])
      expect(report.tickets.perTicket[1]).toMatchObject({ delegationMs: 120_000, spanMs: 11 * 60_000 })
    })

    it('puts a ticket whose complexity nobody said under unknown', async () => {
      const report = await buildRoutingReport(state([one({ ticket: 9 })]), NOW)
      expect(report.tickets.byComplexity).toEqual([expect.objectContaining({ complexity: null, tickets: 1 })])
    })
  })

  describe('what it says it cannot know', () => {
    it('lists the models that ran without a price, whose runs have no cost', async () => {
      const report = await buildRoutingReport(state(history(runs(2, { provider: 'codex', tier: 'build', model: 'gpt-6.1-sol', cost: null }), runs(2))), NOW)
      expect(report.unpricedModels).toEqual(['gpt-6.1-sol'])
      expect(renderRoutingReport(report)).toContain('Unpriced: gpt-6.1-sol')
    })

    it('says whether the hooks that capture the delegations are in place for each declared agent', async () => {
      await mkdir(join(root, '.claude'), { recursive: true })
      await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      const report = await buildRoutingReport(state([], { agents: ['claude-code', 'codex', 'gemini-cli'] }), NOW)
      expect(report.capture).toEqual([
        { agent: 'claude-code', state: 'enforced' },
        { agent: 'codex', state: 'missing' },
        { agent: 'gemini-cli', state: 'not-enforced' }
      ])
    })

    it('lists the local moves nobody promoted yet, with the figure that justified each and the tier agents that fell behind', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const report = await buildRoutingReport(state(runs(3), { local }), NOW)
      expect(report.localAdjustments).toEqual([
        {
          kind: 'multi-file-feature',
          provider: 'claude-code',
          tier: 'fix',
          from: 'build',
          action: 'escalate',
          at: NOW.toISOString(),
          rule: evidence.rule,
          expectedFeatureCost: { from: '1.728572', to: null }
        }
      ])
      expect(report.staleTierAgents).toHaveLength(6)
    })
  })

  describe('the text a person reads', () => {
    it('shows the tables, the censored count and the way to promote or undo a move', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const all = history(sequence('sssssssfff', { cost: '1.00000000', ticket: 5, complexity: 'complex' }), runs(2, { outcome: 'outcome-unknown' }))
      const text = renderRoutingReport(await buildRoutingReport(state(all, { local }), NOW))
      expect(text).toContain('Runs recorded: 12 (10 rated, 2 censored)')
      expect(text).toMatch(/kind\s+agent\s+tier\s+runs\s+success\s+censored\s+p95 cost\s+p95 time\s+feature cost/)
      expect(text).toMatch(/multi-file-feature\s+claude-code\s+build\s+12\s+70% of 10\s+2\s+\$1\s+60s/)
      expect(text).toContain('Per ticket, by complexity')
      expect(text).toContain('Local adjustments, not promoted')
      expect(text).toContain('multi-file-feature (claude-code): build → fix, escalate on 2026-10-20.')
      expect(text).toContain('sf agents routing reset <kind>')
    })

    it('says so when nothing is recorded', async () => {
      const text = renderRoutingReport(await buildRoutingReport(state([]), NOW))
      expect(text).toContain('No delegation with a task kind is recorded yet.')
      expect(text).toContain('No local adjustment: the routing is the shared one.')
    })
  })
})
