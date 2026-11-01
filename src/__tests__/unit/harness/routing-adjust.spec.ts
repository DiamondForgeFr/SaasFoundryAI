import { buildRunRecord, foldLedger, type LedgerRun, type RunInput } from '../../../harness/delegation-ledger'
import { resolveAdjustPolicy, type RoutingAdjustConfig } from '../../../harness/routing-adjust-config'
import {
  adjustRouting,
  candidateId,
  evaluateKind,
  expectedFeatureCost,
  featureCosts,
  isNewCandidate,
  ladderRungs,
  nearestRank,
  nextRung,
  reconcileLadders,
  selectTrial,
  windowStats,
  type AdjustContext
} from '../../../harness/routing-adjust'
import { emptyLocalRouting, listLocalAdjustments, listLocalHolds, autoKindsFor, type LocalLadderEntry, type LocalRouting } from '../../../harness/routing-local'
import { resolveRoute, type RoutingOverrides } from '../../../harness/routing-grid'
import { ExactRational } from '../../../execution/exact-cost'

import { history, one, pending, runs, sequence, T0, TIERS, type RunSpec as Spec } from '../../helpers/ledger-runs'

const NOW = new Date('2026-10-20T08:00:00.000Z')

function context(all: LedgerRun[], overrides: { shared?: RoutingOverrides; local?: LocalRouting; policy?: RoutingAdjustConfig; routes?: AdjustContext['routes']; now?: Date } = {}): AdjustContext {
  return {
    shared: overrides.shared,
    local: overrides.local ?? emptyLocalRouting(),
    policy: resolveAdjustPolicy(overrides.policy),
    runs: all,
    routes: overrides.routes ?? [],
    now: overrides.now ?? NOW
  }
}

/** The first look at the ladder has happened: every tier's candidate is known. */
const known = (shared?: RoutingOverrides): LocalRouting => reconcileLadders(emptyLocalRouting(), shared, new Date('2026-09-01T00:00:00.000Z'))

describe('expected feature cost (#1035, Examine finding 18)', () => {
  const stats = (pattern: string, cost: string) => windowStats('claude-sonnet-5-5/xhigh', sequence(pattern, { cost }))

  it('is the cost of a run plus the failure rate times what the next tier up costs to deliver the work', () => {
    // 7 of 10 succeed at $1 a run: 1 + 0.3 x 5, the next tier up delivering the work for $5
    expect(expectedFeatureCost(stats('sssssssfff', '1.00000000'), new ExactRational(5n))!.compare(new ExactRational(5n, 2n))).toBe(0)
  })

  it('does not charge a failure twice: with a next tier it is the cost of the run that failed and the next tier', () => {
    // A tier that always fails costs one run of its own plus the next tier: 2 + 1 x 10, not 2 / 0 + ...
    expect(expectedFeatureCost(stats('ffff', '2.00000000'), new ExactRational(10n))!.compare(new ExactRational(12n))).toBe(0)
  })

  it('is c / s at the top of the ladder or when the next tier was never measured: a failure is retried on the same candidate', () => {
    // 1 / 0.5 = 2
    expect(expectedFeatureCost(stats('sf', '1.00000000'))!.compare(new ExactRational(2n))).toBe(0)
    expect(expectedFeatureCost(stats('sssssssfff', '1.00000000'), null)!.compare(new ExactRational(10n, 7n))).toBe(0)
  })

  it('is unknown for a candidate with no priced run, or with no success and nothing above it', () => {
    expect(expectedFeatureCost(windowStats('x/y', sequence('ss', { cost: null })))).toBeNull()
    expect(expectedFeatureCost(stats('ff', '1.00000000'))).toBeNull()
  })

  it('counts a tier that always fails as a finite cost once the next tier is known', () => {
    expect(expectedFeatureCost(stats('ff', '1.00000000'), new ExactRational(3n))!.compare(new ExactRational(4n))).toBe(0)
  })

  it('chains from the top of the ladder down: each tier pays its failures at the tier above it', () => {
    const rungs = ladderRungs('multi-file-feature', 'claude-code', undefined)
    const idOf = (tier: string) => candidateId(rungs.find((rung) => rung.tier === tier)!.candidate)
    // One rung per different candidate, lightest first, the ones the grid excludes for the kind left out
    expect(rungs.map((rung) => rung.tier)).toEqual(['edit', 'build', 'fix', 'plan', 'terminal'])
    const measured: Record<string, LedgerRun[]> = {
      [idOf('build')]: sequence('sssf', { tier: 'build', cost: '1.00000000' }),
      [idOf('fix')]: runs(4, { tier: 'fix', cost: '4.00000000' })
    }
    const costs = featureCosts(rungs, (rung) => windowStats(rung.id, measured[rung.id] ?? []))
    // plan and terminal were never measured, so fix is c / s = 4; build is 1 + 0.25 x 4 = 2
    expect(costs.get(idOf('fix'))!.compare(new ExactRational(4n))).toBe(0)
    expect(costs.get(idOf('build'))!.compare(new ExactRational(2n))).toBe(0)
    expect(costs.get(idOf('terminal'))).toBeNull()
  })

  it('summarises a window with nearest-rank percentiles, counting the cost and active time of every stop of an agent', () => {
    const window = windowStats('x/y', [...runs(19, { durationMs: 1000 }), one({ durationMs: 9000 })])
    expect(window).toMatchObject({ rated: 20, successes: 20, failures: 0, durationMedianMs: 1000, durationP95Ms: 1000, priced: 20 })
    expect(nearestRank([1, 2, 3, 4], 0.95)).toBe(4)
    expect(nearestRank([], 0.95)).toBeNull()
  })
})

describe('the ladder (#1035)', () => {
  it('goes one different candidate up or down, skipping tiers that share a candidate', () => {
    expect(nextRung('up', 'build', 'multi-file-feature', 'claude-code', undefined)).toMatchObject({ tier: 'fix' })
    expect(nextRung('down', 'build', 'multi-file-feature', 'claude-code', undefined)).toMatchObject({ tier: 'edit' })
    // The Codex tiers build, fix and plan run the same candidate: one rung, then the terminal tier
    expect(nextRung('up', 'build', 'multi-file-feature', 'codex', undefined)).toMatchObject({ tier: 'terminal' })
    expect(nextRung('down', 'build', 'multi-file-feature', 'codex', undefined)).toMatchObject({ tier: 'light' })
  })

  it('stops at the ends', () => {
    expect(nextRung('up', 'terminal', 'multi-file-feature', 'claude-code', undefined)).toBeUndefined()
    expect(nextRung('down', 'light', 'prose', 'claude-code', undefined)).toBeUndefined()
  })

  it('treats a candidate the grid excludes for the kind as a floor it never crosses', () => {
    const shared: RoutingOverrides = { tiers: { edit: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } }
    expect(nextRung('down', 'build', 'multi-file-feature', 'claude-code', shared)).toBeUndefined()
    // The same candidate is fine below another kind that does not exclude it
    expect(nextRung('down', 'build', 'tests', 'claude-code', shared)).toMatchObject({ tier: 'edit' })
  })

  it('is not defined for a tier the project introduced', () => {
    expect(nextRung('up', 'docs', 'prose', 'claude-code', { tiers: { docs: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } })).toBeUndefined()
  })

  it('keys a candidate by model and effort, a dated snapshot being the same model', () => {
    expect(candidateId({ model: 'claude-sonnet-5-5-20261001', effort: 'xhigh' })).toBe('claude-sonnet-5-5/xhigh')
    expect(candidateId({ model: 'claude-sonnet-5-5', effort: 'high' })).not.toBe(candidateId({ model: 'claude-sonnet-5-5', effort: 'xhigh' }))
  })
})

describe('escalation (#1035, AC-4)', () => {
  it('moves a kind up one tier after the declared failures among its last runs, and logs the evidence', () => {
    const outcome = adjustRouting(context(sequence('sssssssfff', { cost: '1.00000000' })))
    expect(outcome.moved).toBe(true)
    expect(outcome.decisions).toHaveLength(1)
    const decision = outcome.decisions[0]
    expect(decision).toMatchObject({ kind: 'multi-file-feature', provider: 'claude-code', action: 'escalate', from: 'build', to: 'fix' })
    expect(decision.reason).toBe('3 failures in the last 10 rated runs (threshold 3 of 10)')
    // Expected feature cost of the tier it left: 1 / 0.7, nothing above it was measured, rounded up once at 1e-6; the target was never measured
    expect(decision.evidence!.expectedFeatureCost).toEqual({ from: '1.428572', to: null, currency: 'USD' })
    expect(decision.evidence!.window).toEqual({ rated: 10, successes: 7, failures: 3 })
    expect(decision.evidence!.runs).toHaveLength(10)
    const entry = outcome.local.kinds['multi-file-feature']!['claude-code']!
    expect(entry).toMatchObject({ tier: 'fix', from: 'build', action: 'escalate', at: NOW.toISOString() })
    expect(outcome.local.log).toEqual([expect.objectContaining({ action: 'escalate', kind: 'multi-file-feature', provider: 'claude-code', from: 'build', to: 'fix', evidence: entry.evidence })])
    expect(outcome.local.boundaries['multi-file-feature']).toEqual({ 'claude-code': NOW.toISOString() })
    expect(resolveRoute('multi-file-feature', 'claude-code', undefined, autoKindsFor(outcome.local, 'claude-code'))).toMatchObject({ tier: 'fix', source: 'auto' })
  })

  it('counts only the last runs: old failures fall out of the window', () => {
    expect(adjustRouting(context(sequence('fffsssssssss'))).moved).toBe(false)
    expect(adjustRouting(context(sequence('ssfsfsssfs'))).moved).toBe(true)
  })

  it('does not escalate on fewer failures than declared', () => {
    expect(adjustRouting(context(sequence('ssssssssff'))).decisions[0]).toMatchObject({ action: 'hold' })
  })

  it('counts neither a run without an outcome nor a cancelled one nor an unavailable candidate as a failure', () => {
    const noise = [...runs(3, { outcome: 'outcome-unknown' }), ...runs(3, { outcome: 'cancelled' }), ...runs(3, { outcome: 'candidate-unavailable' })]
    expect(adjustRouting(context(history(noise, runs(7)))).moved).toBe(false)
  })

  it('counts a success the session reworked, or retried on a higher tier through the link, as a failure', () => {
    const record = (spec: Partial<RunInput> & { tier?: keyof typeof TIERS }) =>
      buildRunRecord({
        host: 'claude-code',
        provider: 'claude-code',
        taskKind: 'multi-file-feature',
        outcome: 'pass',
        checks: ['type-check'],
        model: TIERS[spec.tier ?? 'build'].model,
        effort: TIERS[spec.tier ?? 'build'].effort,
        ...spec,
        tier: spec.tier ?? 'build'
      } as RunInput)
    const first = [0, 1, 2].map((index) => record({ eventKey: `first-${index}`, ticket: 100 + index, at: new Date(T0 + 9_000_000 + index * 60_000).toISOString() }))
    const retries = first.map((entry, index) =>
      record({ eventKey: `retry-${index}`, tier: 'fix', retryOf: entry.id, ticket: 100 + index, at: new Date(T0 + 9_000_000 + index * 60_000 + 1000).toISOString() })
    )
    const later = Array.from({ length: 7 }, (_, index) => record({ eventKey: `later-${index}`, at: new Date(T0 + 9_100_000 + index * 60_000).toISOString() }))
    const folded = foldLedger([...first, ...retries, ...later]).runs
    expect(folded.filter((run) => run.escalated)).toHaveLength(3)
    const outcome = adjustRouting(context(folded))
    expect(outcome.decisions.find((decision) => decision.from === 'build')).toMatchObject({ action: 'escalate', to: 'fix' })
  })

  it('does not read a normal run on the routed higher tier as a retry: de-escalation stays possible', () => {
    // A trial of the cheaper tier succeeded, and the same ticket later ran on the routed tier as it always does
    const trial = one({ tier: 'edit', trial: true, ticket: 5 })
    const routed = one({ tier: 'build', ticket: 5 })
    const folded = foldLedger([trial, routed]).runs
    expect(folded.every((run) => !run.escalated)).toBe(true)
  })

  it('escalates one rung whatever the higher tier costs: a failing tier is left, the expected cost only goes in the evidence', () => {
    // build: 7 of 10 at $1 -> 1 + 0.3 x 5 = 2.5; fix: always succeeds at $5 -> 5. Staying looks cheaper, and the kind still moves.
    const all = history(sequence('sssssssfff', { cost: '1.00000000' }), runs(10, { tier: 'fix', cost: '5.00000000' }))
    const decision = evaluateKind('multi-file-feature', 'claude-code', context(all))
    expect(decision).toMatchObject({ action: 'escalate', from: 'build', to: 'fix' })
    expect(decision.evidence!.expectedFeatureCost).toEqual({ from: '2.500000', to: '5.000000', currency: 'USD' })
  })

  it('moves up on reliability when nothing is priced', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(sequence('sssssssfff', { cost: null })))).toMatchObject({ action: 'escalate', to: 'fix' })
  })

  it('cannot climb past the top of the ladder, and says so', () => {
    expect(evaluateKind('terminal-ci', 'claude-code', context(sequence('sssssssfff', { kind: 'terminal-ci', tier: 'terminal' })))).toMatchObject({ action: 'hold', hold: 'top-of-ladder' })
  })

  it('notes a higher tier whose p95 duration is over the declared ceiling but still leaves a failing tier', () => {
    const all = history(sequence('sssssssfff'), runs(5, { tier: 'fix', durationMs: 900_000 }))
    const decision = evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { maxDurationMs: 600_000 } }))
    expect(decision).toMatchObject({ action: 'escalate', to: 'fix' })
    expect(decision.reason).toContain('over the 600000 ms ceiling')
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all)).reason).not.toContain('ceiling')
  })

  it('does not count evidence twice: after a move the window starts over', () => {
    const first = adjustRouting(context(sequence('sssssssfff')))
    expect(first.moved).toBe(true)
    const again = adjustRouting({ ...context(sequence('sssssssfff')), local: first.local, now: new Date(NOW.getTime() + 1000) })
    expect(again.moved).toBe(false)
    expect(again.local.log.filter((entry) => entry.action === 'escalate')).toHaveLength(1)
  })

  it('honours the thresholds the project declares', () => {
    const policy = { escalate: { failures: 2, of: 4 } }
    expect(adjustRouting(context(sequence('ssff'), { policy })).moved).toBe(true)
    expect(adjustRouting(context(sequence('ssff'))).moved).toBe(false)
  })

  it('does not let a run recorded by hand count: it asks nothing of the routing', () => {
    expect(adjustRouting(context(sequence('ffff', { host: 'manual' }))).moved).toBe(false)
    expect(evaluateKind('multi-file-feature', 'claude-code', context(sequence('ffff', { host: 'manual' })))).toMatchObject({ action: 'hold', hold: 'no-evidence' })
  })
})

describe('a hold is a decision too, and it is logged once (Examine finding 10)', () => {
  it('records why a kind was left where it is, and says nothing more while the reason does not change', () => {
    const first = adjustRouting(context(sequence('ssssssssss')))
    expect(first.moved).toBe(false)
    expect(first.changed).toBe(true)
    expect(listLocalHolds(first.local)).toEqual([{ kind: 'multi-file-feature', provider: 'claude-code', hold: { reason: 'trial-not-proven', since: NOW.toISOString() } }])
    expect(first.local.log).toEqual([expect.objectContaining({ action: 'hold', kind: 'multi-file-feature', from: 'build', to: 'build', note: expect.stringContaining('trial-not-proven') })])
    const again = adjustRouting({ ...context(sequence('ssssssssss'), { local: first.local }), now: new Date(NOW.getTime() + 60_000) })
    expect(again.changed).toBe(false)
    expect(again.local).toBe(first.local)
  })

  it('logs the next reason when it changes, and forgets the hold once the kind moves', () => {
    const waiting = adjustRouting(context(sequence('ssssssssss')))
    const failing = adjustRouting({ ...context(sequence('sssssssfff', { tier: 'terminal', kind: 'terminal-ci' }), { local: waiting.local }), now: new Date(NOW.getTime() + 60_000) })
    expect(listLocalHolds(failing.local).map((entry) => [entry.kind, entry.hold.reason])).toEqual([
      ['multi-file-feature', 'trial-not-proven'],
      ['terminal-ci', 'top-of-ladder']
    ])
    const moved = adjustRouting({ ...context(sequence('sssssssfff'), { local: waiting.local }), now: new Date(NOW.getTime() + 120_000) })
    expect(listLocalHolds(moved.local)).toEqual([])
    expect(moved.local.log.map((entry) => entry.action)).toEqual(['hold', 'escalate'])
  })
})

describe("a developer's override is never changed automatically (#1035, AC-6)", () => {
  const shared: RoutingOverrides = { kinds: { 'multi-file-feature': { tier: 'build' } } }

  it('holds a kind the shared manifest overrides, whatever the evidence says, and offers no trial for it', () => {
    const all = history(sequence('ffffffffff'), runs(20, { tier: 'edit' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { shared }))).toMatchObject({ action: 'hold', hold: 'developer-override' })
    const outcome = adjustRouting(context(all, { shared }))
    expect(outcome.moved).toBe(false)
    expect(outcome.local.kinds).toEqual({})
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(30), { shared }))).toBeUndefined()
  })

  it('lets the developer win over a move already in the layer', () => {
    const moved = adjustRouting(context(sequence('sssssssfff')))
    expect(resolveRoute('multi-file-feature', 'claude-code', undefined, autoKindsFor(moved.local, 'claude-code'))).toMatchObject({ tier: 'fix', source: 'auto' })
    // The developer chose another tier: the move of the layer is shadowed, not applied
    const chosen: RoutingOverrides = { kinds: { 'multi-file-feature': { tier: 'plan' } } }
    expect(resolveRoute('multi-file-feature', 'claude-code', chosen, autoKindsFor(moved.local, 'claude-code'))).toMatchObject({ tier: 'plan', source: 'project' })
    // Even the tier the grid would pick is the developer's choice once written down
    expect(resolveRoute('multi-file-feature', 'claude-code', shared, autoKindsFor(moved.local, 'claude-code'))).toMatchObject({ tier: 'build' })
  })

  it('keeps adjusting the other kinds of the same project', () => {
    const all = history(sequence('ffffffffff'), sequence('sssssssfff', { kind: 'tests' }))
    const outcome = adjustRouting(context(all, { shared }))
    expect(outcome.decisions.map((decision) => [decision.kind, decision.action])).toEqual([
      ['multi-file-feature', 'hold'],
      ['tests', 'escalate']
    ])
  })

  it('does nothing at all once the adjustment is switched off', () => {
    const all = sequence('ffffffffff')
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { enabled: false } }))).toMatchObject({ action: 'hold', hold: 'disabled' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(30), { policy: { enabled: false } }))).toBeUndefined()
  })

  it('leaves a tier the project introduced alone', () => {
    const projectTier: RoutingOverrides = { kinds: {}, tiers: { docs: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } }
    const local: LocalRouting = { ...emptyLocalRouting(), kinds: { prose: { 'claude-code': { tier: 'docs', from: 'light', action: 'deescalate', at: NOW.toISOString(), evidence: {} as never } } } }
    expect(evaluateKind('prose', 'claude-code', context(sequence('ffffffffff', { kind: 'prose' }), { shared: projectTier, local }))).toMatchObject({ action: 'hold', hold: 'tier-not-on-ladder' })
  })
})

describe('de-escalation (#1035, AC-5)', () => {
  /** Ten runs on the routed tier at $2, and a trial tier at $0.3. */
  const x = () => runs(10, { tier: 'build', cost: '2.00000000', durationMs: 100_000 })
  const y = (count: number, spec: Spec = {}) => runs(count, { tier: 'edit', trial: true, cost: '0.30000000', durationMs: 80_000, ...spec })

  it('moves a kind down one tier after the declared successes of the cheaper tier and no failure', () => {
    const outcome = adjustRouting(context(history(x(), y(8))))
    const decision = outcome.decisions[0]
    expect(decision).toMatchObject({ action: 'deescalate', from: 'build', to: 'edit' })
    expect(decision.reason).toBe('8 trial successes and 0 failures of the cheaper tier (threshold 8 and 0)')
    // 2.00 on build, 0.30 on the cheaper tier: the figure that justified the move is in the log
    expect(decision.evidence!.expectedFeatureCost).toEqual({ from: '2.000000', to: '0.300000', currency: 'USD' })
    expect(outcome.local.kinds['multi-file-feature']!['claude-code']).toMatchObject({ tier: 'edit', from: 'build', action: 'deescalate' })
  })

  it('counts only the runs the routing offered as a trial: a run that merely used the cheaper candidate proves nothing', () => {
    const uninvited = runs(8, { tier: 'edit', cost: '0.30000000' })
    expect(evaluateKind('multi-file-feature', 'claude-code', context(history(x(), uninvited)))).toMatchObject({ action: 'hold', hold: 'trial-not-proven' })
  })

  it('waits for the declared number of successes', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(history(x(), y(7))))).toMatchObject({ action: 'hold', hold: 'trial-not-proven' })
  })

  it('does not move on a single failure of the cheaper tier', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(history(x(), y(8), y(1, { outcome: 'fail' }))))).toMatchObject({ action: 'hold', hold: 'trial-not-proven' })
  })

  it('never crosses a floor: the grid excludes the cheaper candidate for this kind', () => {
    const floor: RoutingOverrides = { tiers: { edit: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } }
    const all = history(x(), y(20, { model: 'claude-haiku-5-5' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { shared: floor }))).toMatchObject({ action: 'hold', hold: 'floor' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(all, { shared: floor }))).toBeUndefined()
  })

  it('cannot say a cheaper tier is cheaper when nothing is priced', () => {
    const all = history(runs(10, { tier: 'build', cost: null }), y(8, { cost: null }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'hold', hold: 'unpriced' })
  })

  it('stays when the cheaper tier costs more in expectation than the routed one', () => {
    const all = history(runs(10, { tier: 'build', cost: '0.10000000' }), y(8, { cost: '2.00000000' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'hold', hold: 'cheaper-tier-costs-more' })
  })

  describe('duration breaks a tie within the cost band', () => {
    const tied = (trialDuration: number) => history(runs(10, { tier: 'build', cost: '1.00000000', durationMs: 100_000 }), y(8, { cost: '0.95000000', durationMs: trialDuration }))

    it('moves down when the cheaper tier is as cheap within the band and faster', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(50_000)))).toMatchObject({ action: 'deescalate', to: 'edit' })
    })

    it('stays when it is not faster', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(200_000)))).toMatchObject({ action: 'hold', hold: 'tie-not-faster' })
    })

    it('uses the band the project declares', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(200_000), { policy: { costBand: 0 } }))).toMatchObject({ action: 'deescalate' })
    })
  })

  it('does not choose a cheaper tier whose p95 duration is over the declared ceiling', () => {
    const all = history(x(), y(8, { durationMs: 900_000 }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { maxDurationMs: 600_000 } }))).toMatchObject({ action: 'hold', hold: 'over-duration-ceiling' })
  })

  it('drops the local entry when the move returns the kind to its shipped tier, and keeps both moves in the log', () => {
    const up = adjustRouting(context(sequence('sssssssfff', { cost: '1.00000000' })))
    expect(listLocalAdjustments(up.local)).toHaveLength(1)
    const later = new Date(NOW.getTime() + 3_600_000)
    // What happened after the move is the new evidence: ten runs on the tier it moved to, eight trials of the one it left
    const afterwards = (count: number, spec: Spec, offset: number) =>
      Array.from({ length: count }, (_, index) => one({ ...spec, at: new Date(NOW.getTime() + (offset + index) * 60_000).toISOString() }))
    const fixRuns = afterwards(10, { tier: 'fix', cost: '4.00000000' }, 1)
    const buildTrial = afterwards(8, { tier: 'build', trial: true, cost: '0.50000000' }, 20)
    const down = adjustRouting({ ...context(history(sequence('sssssssfff'), fixRuns, buildTrial)), local: up.local, now: later })
    expect(down.decisions[0]).toMatchObject({ action: 'deescalate', from: 'fix', to: 'build' })
    expect(listLocalAdjustments(down.local)).toEqual([])
    expect(down.local.log.map((entry) => entry.action)).toEqual(['escalate', 'deescalate'])
  })

  it('returns to the shipped tier name when Codex tiers share a candidate: the kind is not left on a tier of the same candidate', () => {
    // Codex runs build, fix and plan on one candidate. The kind is shipped on build, moved up to the terminal tier,
    // and its trial of the rung below finds that candidate again under the name of the tier above build: plan.
    const codex = { provider: 'codex', model: 'gpt-6.1-sol' } as const
    const failing = sequence('sssssssfff', { ...codex, tier: 'build', effort: 'medium', cost: '1.00000000' })
    const up = adjustRouting(context(failing))
    expect(up.local.kinds['multi-file-feature']!.codex).toMatchObject({ tier: 'terminal' })
    // Going down from the terminal tier the first different candidate sits under the name of the tier above build.
    const rung = nextRung('down', 'terminal', 'multi-file-feature', 'codex', undefined)!
    expect(rung.tier).toBe('plan')
    const at = (index: number) => new Date(NOW.getTime() + (index + 1) * 60_000).toISOString()
    const onTerminal = Array.from({ length: 10 }, (_, index) => one({ ...codex, tier: 'terminal', effort: 'high', cost: '3.00000000', at: at(index) }))
    const trial = Array.from({ length: 8 }, (_, index) => one({ ...codex, tier: 'plan', effort: 'medium', trial: true, cost: '0.50000000', at: at(20 + index) }))
    const down = adjustRouting({ ...context(history(failing, onTerminal, trial)), local: up.local, now: new Date(NOW.getTime() + 3_600_000) })
    expect(down.decisions.find((decision) => decision.provider === 'codex')).toMatchObject({ action: 'deescalate', from: 'terminal', to: 'plan' })
    expect(listLocalAdjustments(down.local)).toEqual([])
    expect(resolveRoute('multi-file-feature', 'codex', undefined, autoKindsFor(down.local, 'codex')).tier).toBe('build')
  })

  it('keeps the measured history of a candidate that did not change, and starts a fresh window for one that did (a new model)', () => {
    const all = sequence('sssssssfff', { cost: '1.00000000' })
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'escalate' })
    // The build tier now runs a new model: its runs are another candidate, the old failures do not count against it
    const bumped: RoutingOverrides = { tiers: { build: { 'claude-code': { model: 'claude-sonnet-5-6', effort: 'xhigh' } } } }
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { shared: bumped }))).toMatchObject({ action: 'hold' })
    // An unchanged candidate keeps its history even though the tier around it moved
    const history2 = history(runs(10, { tier: 'fix', cost: '1.00000000' }), runs(3, { tier: 'fix', outcome: 'fail', cost: '1.00000000' }))
    expect(
      evaluateKind(
        'review',
        'claude-code',
        context(
          history2.map((run) => ({ ...run, taskKind: 'review' })),
          { shared: bumped }
        )
      )
    ).toMatchObject({ action: 'escalate', from: 'fix', to: 'plan' })
  })

  it('counts a dated snapshot of the routed model as the same candidate', () => {
    const all = sequence('sssssssfff', { model: 'claude-sonnet-5-5-20261001' })
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'escalate' })
  })
})

describe('a candidate that is new on the ladder (Examine finding 11)', () => {
  const newFix = (): LocalRouting => {
    const base = known()
    const entry: LocalLadderEntry = { candidate: 'claude-opus-5-5/medium', since: '2026-10-15T00:00:00.000Z', status: 'new' }
    return { ...base, ladders: { ...base.ladders, 'claude-code': { ...base.ladders['claude-code'], fix: entry } } }
  }

  it('records every tier as accepted on the first look, and flags only what appears afterwards', () => {
    const first = known()
    expect(Object.values(first.ladders['claude-code']!).every((entry) => entry.status === 'accepted')).toBe(true)
    expect(reconcileLadders(first, undefined, NOW)).toBe(first)
    const bumped: RoutingOverrides = { tiers: { fix: { 'claude-code': { model: 'claude-opus-5-6', effort: 'medium' } } } }
    const next = reconcileLadders(first, bumped, NOW)
    expect(next.ladders['claude-code']!.fix).toEqual({ candidate: 'claude-opus-5-6/medium', since: NOW.toISOString(), status: 'new' })
    expect(next.ladders['claude-code']!.build.status).toBe('accepted')
    expect(isNewCandidate(next, 'claude-code', 'fix', bumped, NOW)).toBe(true)
    expect(isNewCandidate(next, 'claude-code', 'build', bumped, NOW)).toBe(false)
    // A candidate stays new for a while, not forever
    expect(isNewCandidate(next, 'claude-code', 'fix', bumped, new Date(NOW.getTime() + 61 * 86_400_000))).toBe(false)
  })

  it('offers the new stronger candidate above the routed tier as a trial, within the same share', () => {
    const local = newFix()
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(9), { local }))).toMatchObject({ tier: 'fix', effectiveTier: 'build', direction: 'up' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(8), { local }))).toBeUndefined()
    // The ordinary cheaper candidate is still the offer when nothing above is new
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(9), { local: known() }))).toMatchObject({ tier: 'edit', direction: 'down' })
  })

  it('adopts it when it delivers the work for less in expectation, and then accepts it', () => {
    const local = newFix()
    // build: 8 of 10 at $2, a failure paid at fix (8 trials at $1.5, all successes): 2 + 0.2 x 1.5 = 2.3; the new fix delivers for 1.5
    const all = history(sequence('ssssssssff', { tier: 'build', cost: '2.00000000' }), runs(8, { tier: 'fix', trial: true, cost: '1.50000000' }))
    const outcome = adjustRouting(context(all, { local }))
    expect(outcome.decisions[0]).toMatchObject({ action: 'escalate', from: 'build', to: 'fix', adopts: true })
    expect(outcome.decisions[0].reason).toContain('delivers the work for less in expectation')
    expect(outcome.local.ladders['claude-code']!.fix.status).toBe('accepted')
    expect(outcome.local.log.map((entry) => entry.action)).toEqual(['escalate', 'adopt'])
    expect(outcome.local.kinds['multi-file-feature']!['claude-code']).toMatchObject({ tier: 'fix', action: 'escalate' })
  })

  it('does not adopt it when it costs more, or before it has proven itself', () => {
    const local = newFix()
    const dear = history(sequence('ssssssssff', { tier: 'build', cost: '1.00000000' }), runs(8, { tier: 'fix', trial: true, cost: '4.00000000' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(dear, { local })).action).toBe('hold')
    const unproven = history(sequence('ssssssssff', { tier: 'build', cost: '2.00000000' }), runs(3, { tier: 'fix', trial: true, cost: '1.50000000' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(unproven, { local })).action).toBe('hold')
  })

  it('accepts a new cheaper candidate once the expected-cost rule moves a kind onto it', () => {
    const base = known()
    const entry: LocalLadderEntry = { candidate: 'claude-haiku-5-5/high', since: '2026-10-15T00:00:00.000Z', status: 'new' }
    const local: LocalRouting = { ...base, ladders: { ...base.ladders, 'claude-code': { ...base.ladders['claude-code'], edit: entry } } }
    const all = history(runs(10, { tier: 'build', cost: '2.00000000' }), runs(8, { tier: 'edit', trial: true, cost: '0.30000000' }))
    const outcome = adjustRouting(context(all, { local }))
    expect(outcome.decisions[0]).toMatchObject({ action: 'deescalate', to: 'edit', adopts: true })
    expect(outcome.local.ladders['claude-code']!.edit.status).toBe('accepted')
  })
})

describe('the bounded trial of the cheaper tier (#1035, AC-5)', () => {
  it('is offered once the kind has enough runs for one trial to stay within the declared share', () => {
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(8)))).toBeUndefined()
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(9)))).toMatchObject({
      tier: 'edit',
      effectiveTier: 'build',
      direction: 'down',
      candidate: { model: 'claude-haiku-5-5', effort: 'high' }
    })
  })

  it('never exceeds its share of the runs, whatever the sequence', () => {
    let all: LedgerRun[] = []
    let trials = 0
    for (let step = 1; step <= 200; step++) {
      const offer = selectTrial('multi-file-feature', 'claude-code', context(all))
      all = [...all, offer ? one({ tier: offer.tier as keyof typeof TIERS, trial: true }) : one({ tier: 'build' })]
      if (offer) trials++
      expect(trials / step).toBeLessThanOrEqual(0.1)
    }
    // Eight successful trials prove the cheaper tier: no more are offered (the adjustment moves the kind then)
    expect(trials).toBe(8)
  })

  it('counts rated runs only in the share: censored runs and runs recorded by hand do not make room for a trial', () => {
    const noise = [...runs(5, { outcome: 'outcome-unknown' }), ...runs(5, { host: 'manual' })]
    expect(selectTrial('multi-file-feature', 'claude-code', context(history(runs(8), noise)))).toBeUndefined()
    expect(selectTrial('multi-file-feature', 'claude-code', context(history(runs(9), noise)))).toMatchObject({ tier: 'edit' })
  })

  it('holds the place of a route that was issued and not recorded yet: parallel routes cannot all be trials', () => {
    const all = runs(9)
    const trial = pending({ tier: 'edit', trial: true, now: NOW })
    expect(selectTrial('multi-file-feature', 'claude-code', context(all, { routes: [trial] }))).toBeUndefined()
    // A pending route that is not a trial only counts among the runs the share is taken of
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(8), { routes: [pending({ now: NOW })] }))).toMatchObject({ tier: 'edit' })
    // One that was recorded since, or one that expired, no longer holds anything
    expect(selectTrial('multi-file-feature', 'claude-code', context(all, { routes: [{ ...trial, consumedBy: 'abc' }] }))).toMatchObject({ tier: 'edit' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(all, { routes: [trial], now: new Date(NOW.getTime() + 8 * 24 * 3_600_000) }))).toMatchObject({ tier: 'edit' })
    // Another kind or another agent does not take the place
    expect(
      selectTrial('multi-file-feature', 'claude-code', context(all, { routes: [pending({ kind: 'tests', trial: true, now: NOW }), pending({ provider: 'codex', trial: true, now: NOW })] }))
    ).toMatchObject({ tier: 'edit' })
  })

  it('honours the share the project declares', () => {
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(3), { policy: { trialShare: 0.25 } }))).toMatchObject({ tier: 'edit' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(2), { policy: { trialShare: 0.25 } }))).toBeUndefined()
  })

  it('is left alone for the cooldown after a trial failed, and resumes after it', () => {
    const failed = one({ tier: 'edit', trial: true, outcome: 'fail', at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() })
    expect(selectTrial('multi-file-feature', 'claude-code', context(history(runs(30), [failed])))).toBeUndefined()
    const longAgo = one({ tier: 'edit', trial: true, outcome: 'fail', at: new Date(NOW.getTime() - 20 * 86_400_000).toISOString() })
    expect(selectTrial('multi-file-feature', 'claude-code', context(history(runs(30), [longAgo])))).toMatchObject({ tier: 'edit' })
  })

  it('is not offered while the routed tier is itself failing, nor once the cheaper tier has proven itself', () => {
    expect(selectTrial('multi-file-feature', 'claude-code', context(sequence('sssssssfff')))).toBeUndefined()
    const proven = history(runs(10, { tier: 'build' }), runs(8, { tier: 'edit', trial: true }))
    expect(selectTrial('multi-file-feature', 'claude-code', context(proven))).toBeUndefined()
  })

  it('makes a new candidate a trial candidate for the kinds it qualifies for, without any history', () => {
    const bumped: RoutingOverrides = { tiers: { edit: { 'claude-code': { model: 'claude-haiku-5-6', effort: 'high' } } } }
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(9), { shared: bumped }))).toMatchObject({ tier: 'edit', candidate: { model: 'claude-haiku-5-6' } })
  })

  it('counts the runs since the evidence started, not the history before a move', () => {
    const moved = adjustRouting(context(sequence('sssssssfff')))
    const after = { ...context(runs(3), { local: moved.local }), now: new Date(NOW.getTime() + 86_400_000) }
    expect(selectTrial('multi-file-feature', 'claude-code', after)).toBeUndefined()
  })
})

describe('the whole loop (#1035)', () => {
  it('finds the cheaper tier after a bounded sample: ten runs in a hundred are trials, and the kind moves down once eight succeeded', () => {
    let all: LedgerRun[] = []
    let local = emptyLocalRouting()
    let movedAt = 0
    let trials = 0
    for (let step = 1; step <= 120 && !movedAt; step++) {
      const ctx = { ...context(all, { local }), now: new Date(NOW.getTime() + step * 1000) }
      const offer = selectTrial('multi-file-feature', 'claude-code', ctx)
      all = [...all, offer ? one({ tier: 'edit', trial: true, cost: '0.30000000' }) : one({ tier: 'build', cost: '2.00000000' })]
      if (offer) trials++
      const outcome = adjustRouting({ ...ctx, runs: all })
      local = outcome.local
      if (outcome.moved) movedAt = step
      expect(trials / step).toBeLessThanOrEqual(0.1)
    }
    expect(movedAt).toBe(80)
    expect(trials).toBe(8)
    expect(local.kinds['multi-file-feature']!['claude-code']).toMatchObject({ tier: 'edit', action: 'deescalate' })
  })
})
