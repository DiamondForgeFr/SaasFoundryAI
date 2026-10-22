import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { CLAUDE_CAPTURE_HOOKS } from '../../../harness/delegation-hooks'
import { agentToken, buildRunRecord, buildStatusRecord, foldLedger, type LedgerRun } from '../../../harness/delegation-ledger'
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
  expectedFeatureCost: { from: '1.428572', to: null, currency: 'USD' as const },
  durationP95Ms: { from: null, to: null },
  runs: []
}

describe('sf agents routing report (#1035, AC-3)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-report-'))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  const state = (
    all: LedgerRun[],
    extra: { local?: LocalRouting; shared?: RoutingOverrides; agents?: RoutingState['project']['agents']; adjust?: RoutingAdjustConfig; statuses?: RoutingState['ledger']['statuses'] } = {}
  ): RoutingState => {
    const policy = resolveAdjustPolicy(extra.adjust)
    return {
      root,
      dir: undefined,
      project: { agents: extra.agents ?? ['claude-code'], routing: extra.shared, policy, decision: { routing: extra.shared, policy, source: 'shipped', branch: null, invalid: null, differs: false } },
      ledger: { runs: all, routes: [], statuses: extra.statuses ?? [], skipped: 0, unmatchedSignals: 0 },
      local: extra.local ?? emptyLocalRouting()
    }
  }
  const probe = (runnable: boolean) => async () => runnable

  it('has a stable, versioned envelope', async () => {
    const report = await buildRoutingReport(state([]), NOW, { probe: probe(true) })
    expect(REPORT_VERSION).toBe(2)
    expect(Object.keys(report)).toEqual(['reportVersion', 'generatedAt', 'ledger', 'policy', 'unpricedModels', 'capture', 'kinds', 'tickets', 'localAdjustments', 'holds', 'staleTierAgents'])
    expect(report).toMatchObject({
      reportVersion: 2,
      generatedAt: NOW.toISOString(),
      ledger: { runs: 0, stops: 0, rated: 0, censored: 0, manual: 0, unattributed: 0, skippedLines: 0, unmatchedSignals: 0 },
      kinds: [],
      tickets: { byComplexity: [], perTicket: [] },
      localAdjustments: [],
      holds: [],
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
      const report = await buildRoutingReport(state(history(build, trial)), NOW, { probe: probe(true) })
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
      const report = await buildRoutingReport(state(history(sequence('sssssssfff', { tier: 'build', cost: '1.00000000' }), runs(5, { tier: 'fix', cost: '4.00000000' }))), NOW, { probe: probe(true) })
      const rows = Object.fromEntries(report.kinds[0].tiers.map((row) => [row.tier, row]))
      // 1 + 0.3 x 4 = 2.2: a failure is paid once, at the tier above; the fix tier always succeeds at $4
      expect(rows.build.expectedFeatureCost).toBe('2.200000')
      expect(rows.fix.expectedFeatureCost).toBe('4.000000')
    })

    it('keeps a run that has no verdict out of the rates and shows it as censored', async () => {
      const all = history(runs(4), runs(3, { outcome: 'outcome-unknown' }), runs(1, { outcome: 'cancelled' }), runs(1, { outcome: 'candidate-unavailable' }))
      const report = await buildRoutingReport(state(all), NOW, { probe: probe(true) })
      expect(report.kinds[0].tiers[0]).toMatchObject({ runs: 9, rated: 4, censored: 5, successRate: 1 })
      expect(report.ledger).toMatchObject({ runs: 9, rated: 4, censored: 5 })
    })

    it('counts a run without a task kind in the ledger totals and in no row', async () => {
      const report = await buildRoutingReport(state(history(runs(3), runs(2, { kind: null }))), NOW, { probe: probe(true) })
      expect(report.ledger).toMatchObject({ runs: 5, unattributed: 2, censored: 2 })
      expect(report.kinds).toHaveLength(1)
      expect(report.kinds[0].tiers[0].runs).toBe(3)
    })

    it('keeps the two coding agents apart and orders the rows by kind, agent and ladder', async () => {
      const all = history(runs(2, { kind: 'tests', provider: 'codex' }), runs(2, { kind: 'bug-fix', tier: 'fix' }), runs(2, { kind: 'tests' }))
      const report = await buildRoutingReport(state(all, { agents: ['claude-code', 'codex'] }), NOW, { probe: probe(true) })
      expect(report.kinds.map((row) => [row.kind, row.provider])).toEqual([
        ['bug-fix', 'claude-code'],
        ['tests', 'claude-code'],
        ['tests', 'codex']
      ])
    })

    it('says which tier the kind is routed to and where that choice comes from', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const report = await buildRoutingReport(state(history(runs(2, { tier: 'build' }), runs(2, { tier: 'fix' })), { local }), NOW, { probe: probe(true) })
      expect(report.kinds[0]).toMatchObject({ routedTier: 'fix', source: 'auto' })
      expect(report.kinds[0].tiers.map((row) => row.tier)).toEqual(['build', 'fix'])
    })

    it('counts a resumed agent once: its stops are one delegation, whose cost is theirs together', async () => {
      const agent = agentToken('a1')
      const stop = (eventKey: string, from: number, to: number, minutes: number, extra: Partial<Parameters<typeof buildRunRecord>[0]> = {}) =>
        buildRunRecord({
          host: 'claude-code',
          provider: 'claude-code',
          tier: 'build',
          taskKind: 'multi-file-feature',
          model: 'claude-sonnet-5-5',
          effort: 'xhigh',
          eventKey,
          agentId: agent,
          segment: { from, to },
          at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
          durationMs: 10_000,
          tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
          outcome: 'pass',
          checks: ['type-check'],
          ...extra
        })
      const fold = foldLedger([stop('one', 0, 10, 0), stop('two', 10, 20, 30)])
      const report = await buildRoutingReport({ ...state(fold.runs), ledger: fold }, NOW, { probe: probe(true) })
      expect(report.ledger).toMatchObject({ runs: 1, stops: 2, rated: 1 })
      expect(report.kinds[0].tiers[0]).toMatchObject({ runs: 1, cost: { priced: 1, mean: '4.000000' }, durationMs: { median: 20_000, p95: 20_000 } })
      expect(renderRoutingReport(report)).toContain('1 further stop of resumed agents are counted in their delegation.')
    })
  })

  describe('per ticket, by complexity', () => {
    const ticket = (number: number, complexity: 'bug' | 'low' | 'medium' | 'complex', costs: (string | null)[], extra: RunSpec = {}) =>
      costs.map((cost, index) => one({ ticket: number, complexity, cost, durationMs: 60_000, at: new Date(T0 + (number * 1000 + index) * 60_000).toISOString(), ...extra }))

    it('gives the median and p95 of the cost and the active time of the delegations of each ticket', async () => {
      const all = history(ticket(1, 'bug', ['0.50000000']), ticket(2, 'medium', ['1.00000000', '1.00000000']), ticket(3, 'medium', ['5.00000000']), ticket(4, 'complex', ['2.00000000', '3.00000000']))
      const report = await buildRoutingReport(state(all), NOW, { probe: probe(true) })
      expect(report.tickets.byComplexity.map((row) => [row.complexity, row.tickets])).toEqual([
        ['bug', 1],
        ['medium', 2],
        ['complex', 1]
      ])
      const medium = report.tickets.byComplexity.find((row) => row.complexity === 'medium')!
      expect(medium).toMatchObject({
        tickets: 2,
        withCost: 2,
        cost: { tickets: 2, median: '2.000000', p95: '5.000000' },
        incompleteCost: { tickets: 0, median: null },
        // delegations of 60 s each: two for one ticket, one for the other
        delegationMs: { median: 60_000, p95: 120_000 },
        runs: { median: 1, p95: 2 }
      })
      expect(report.tickets.byComplexity.find((row) => row.complexity === 'complex')).toMatchObject({ cost: { median: '5.000000', p95: '5.000000' } })
    })

    it('keeps a ticket with an unpriced delegation out of the medians and shows it apart, as a lower bound', async () => {
      const all = history(ticket(1, 'complex', ['2.00000000']), ticket(2, 'complex', ['4.00000000']), ticket(7, 'complex', ['9.00000000', null], { nature: 'user-facing' }))
      const report = await buildRoutingReport(state(all), NOW, { probe: probe(true) })
      const complex = report.tickets.byComplexity[0]
      expect(complex).toMatchObject({ tickets: 3, withCost: 2, cost: { tickets: 2, median: '2.000000', p95: '4.000000' }, incompleteCost: { tickets: 1, median: '9.000000' } })
      expect(report.tickets.perTicket.find((row) => row.ticket === 7)).toMatchObject({ runs: 2, cost: '9.000000', costComplete: false, failures: 0 })
      expect(renderRoutingReport(report)).toContain('(+1 with an unpriced delegation, from $9)')
    })

    it('shows how long a ticket took from the recorded status transitions: first In progress to first Human testing, In review when it skips testing', async () => {
      const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString()
      const statuses = [
        buildStatusRecord({ ticket: 1, status: 'In progress', at: at(0) }),
        buildStatusRecord({ ticket: 1, status: 'AI testing', at: at(2) }),
        buildStatusRecord({ ticket: 1, status: 'Human testing', at: at(3) }),
        buildStatusRecord({ ticket: 1, status: 'In progress', at: at(5) }),
        buildStatusRecord({ ticket: 2, status: 'In progress', at: at(10) }),
        buildStatusRecord({ ticket: 2, status: 'In review', at: at(11) }),
        buildStatusRecord({ ticket: 3, status: 'In progress', at: at(1) })
      ]
      const all = history(ticket(1, 'medium', ['1.00000000']), ticket(2, 'medium', ['1.00000000']), ticket(3, 'medium', ['1.00000000']), ticket(4, 'medium', ['1.00000000']))
      const report = await buildRoutingReport(state(all, { statuses }), NOW, { probe: probe(true) })
      const byTicket = Object.fromEntries(report.tickets.perTicket.map((row) => [row.ticket, row.ticketMs]))
      expect(byTicket).toEqual({ 1: 3 * 3_600_000, 2: 3_600_000, 3: null, 4: null })
      expect(report.tickets.byComplexity[0].ticketMs).toEqual({ median: 3_600_000, p95: 3 * 3_600_000 })
    })

    it('counts a resumed agent once and its stops together', async () => {
      const agent = agentToken('a2')
      const stop = (eventKey: string, from: number, to: number, minutes: number) =>
        buildRunRecord({
          host: 'claude-code',
          provider: 'claude-code',
          tier: 'build',
          taskKind: 'multi-file-feature',
          ticket: 8,
          complexity: 'low',
          model: 'claude-sonnet-5-5',
          effort: 'xhigh',
          eventKey,
          agentId: agent,
          segment: { from, to },
          at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
          durationMs: 30_000,
          tokens: { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 },
          outcome: 'pass',
          checks: ['type-check']
        })
      const fold = foldLedger([stop('a', 0, 5, 0), stop('b', 5, 9, 90)])
      const report = await buildRoutingReport({ ...state(fold.runs), ledger: fold }, NOW, { probe: probe(true) })
      expect(report.tickets.perTicket).toEqual([expect.objectContaining({ ticket: 8, runs: 1, cost: '2.000000', costComplete: true, delegationMs: 60_000 })])
    })

    it('reports the last tickets first', async () => {
      const first = one({ ticket: 1, complexity: 'low', durationMs: 60_000, at: '2026-10-02T10:01:00.000Z' })
      const second = one({ ticket: 1, complexity: 'low', durationMs: 60_000, at: '2026-10-02T10:11:00.000Z' })
      const other = one({ ticket: 2, complexity: 'low', at: '2026-10-03T10:00:00.000Z' })
      const report = await buildRoutingReport(state(history([first, second, other])), NOW, { probe: probe(true) })
      expect(report.tickets.perTicket.map((row) => row.ticket)).toEqual([2, 1])
      expect(report.tickets.perTicket[1]).toMatchObject({ delegationMs: 120_000 })
    })

    it('puts a ticket whose complexity nobody said under unknown', async () => {
      const report = await buildRoutingReport(state([one({ ticket: 9 })]), NOW, { probe: probe(true) })
      expect(report.tickets.byComplexity).toEqual([expect.objectContaining({ complexity: null, tickets: 1 })])
    })
  })

  describe('what it says it cannot know', () => {
    it('lists the models that ran without a price, whose runs have no cost', async () => {
      const report = await buildRoutingReport(state(history(runs(2, { provider: 'codex', tier: 'build', model: 'gpt-6.1-sol', cost: null }), runs(2))), NOW, { probe: probe(true) })
      expect(report.unpricedModels).toEqual(['gpt-6.1-sol'])
      expect(renderRoutingReport(report)).toContain('Unpriced: gpt-6.1-sol')
    })

    it('says whether the hooks that capture the delegations are declared and can run for each declared agent', async () => {
      await mkdir(join(root, '.claude'), { recursive: true })
      await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: CLAUDE_CAPTURE_HOOKS }))
      const agents = ['claude-code', 'codex', 'gemini-cli'] as RoutingState['project']['agents']
      expect((await buildRoutingReport(state([], { agents }), NOW, { probe: probe(true) })).capture).toEqual([
        { agent: 'claude-code', state: 'enforced' },
        { agent: 'codex', state: 'missing' },
        { agent: 'gemini-cli', state: 'not-enforced' }
      ])
      expect((await buildRoutingReport(state([], { agents }), NOW, { probe: probe(false) })).capture[0]).toEqual({ agent: 'claude-code', state: 'declared-not-runnable' })
    })

    it('lists the local moves nobody promoted yet, with the figure that justified each and the tier agents that fell behind', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const report = await buildRoutingReport(state(runs(3), { local }), NOW, { probe: probe(true) })
      expect(report.localAdjustments).toEqual([
        {
          kind: 'multi-file-feature',
          provider: 'claude-code',
          tier: 'fix',
          from: 'build',
          action: 'escalate',
          at: NOW.toISOString(),
          rule: evidence.rule,
          expectedFeatureCost: { from: '1.428572', to: null }
        }
      ])
      expect(report.staleTierAgents).toHaveLength(6)
    })

    it('lists the kinds the adjustment looked at and left where they are, with the reason', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), holds: { 'multi-file-feature': { 'claude-code': { reason: 'top-of-ladder', since: NOW.toISOString() } } } }
      const report = await buildRoutingReport(state(runs(3), { local }), NOW, { probe: probe(true) })
      expect(report.holds).toEqual([expect.objectContaining({ kind: 'multi-file-feature', provider: 'claude-code', reason: 'top-of-ladder', since: NOW.toISOString() })])
      expect(renderRoutingReport(report)).toContain('multi-file-feature (claude-code): top-of-ladder since 2026-10-20')
    })
  })

  describe('the text a person reads', () => {
    it('shows the tables, the censored count and the way to promote or undo a move', async () => {
      const local: LocalRouting = { ...emptyLocalRouting(), kinds: { 'multi-file-feature': { 'claude-code': { tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString(), evidence } } } }
      const all = history(sequence('sssssssfff', { cost: '1.00000000', ticket: 5, complexity: 'complex' }), runs(2, { outcome: 'outcome-unknown' }))
      const text = renderRoutingReport(await buildRoutingReport(state(all, { local }), NOW, { probe: probe(true) }))
      expect(text).toContain('Delegations recorded: 12 (10 rated, 2 censored)')
      expect(text).toMatch(/kind\s+agent\s+tier\s+runs\s+success\s+censored\s+p95 cost\s+p95 time\s+feature cost/)
      expect(text).toMatch(/multi-file-feature\s+claude-code\s+build\s+12\s+70% of 10\s+2\s+\$1\s+60s/)
      expect(text).toContain('Per ticket, by complexity')
      expect(text).toContain('delegated active time')
      expect(text).toContain('Local adjustments, not promoted')
      expect(text).toContain('multi-file-feature (claude-code): build → fix, escalate on 2026-10-20.')
      expect(text).toContain('sf agents routing reset <kind>')
    })

    it('says so when nothing is recorded', async () => {
      const text = renderRoutingReport(await buildRoutingReport(state([]), NOW, { probe: probe(true) }))
      expect(text).toContain('No delegation with a route is recorded yet.')
      expect(text).toContain('No local adjustment: the routing is the shared one.')
    })

    it('says how many delegations were recorded by hand and never move the routing', async () => {
      const text = renderRoutingReport(await buildRoutingReport(state(history(runs(2), runs(2, { host: 'manual' }))), NOW, { probe: probe(true) }))
      expect(text).toContain('2 recorded by hand and never moving the routing')
    })
  })
})
