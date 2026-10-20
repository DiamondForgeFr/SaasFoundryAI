import { buildRunRecord, foldLedger, type LedgerRun, type RunInput } from '../../../harness/delegation-ledger'
import { resolveAdjustPolicy, type RoutingAdjustConfig } from '../../../harness/routing-adjust-config'
import { adjustRouting, candidateId, evaluateKind, expectedFeatureCost, nearestRank, nextRung, selectTrial, windowStats, type AdjustContext } from '../../../harness/routing-adjust'
import { emptyLocalRouting, listLocalAdjustments, autoKindsFor, type LocalRouting } from '../../../harness/routing-local'
import { resolveRoute, type RoutingOverrides, type TaskKind } from '../../../harness/routing-grid'
import { ExactRational } from '../../../execution/exact-cost'

const T0 = Date.parse('2026-10-01T08:00:00.000Z')
const NOW = new Date('2026-10-20T08:00:00.000Z')

/** The tiers of the shipped grid for Claude Code, as (model, effort). */
const TIERS = {
  light: { tier: 'light', model: 'claude-haiku-5-5', effort: 'medium' },
  edit: { tier: 'edit', model: 'claude-haiku-5-5', effort: 'high' },
  build: { tier: 'build', model: 'claude-sonnet-5-5', effort: 'xhigh' },
  fix: { tier: 'fix', model: 'claude-opus-5-5', effort: 'medium' },
  plan: { tier: 'plan', model: 'claude-opus-5-5', effort: 'high' },
  terminal: { tier: 'terminal', model: 'claude-opus-5-5', effort: 'xhigh' }
} as const

type Spec = {
  tier?: keyof typeof TIERS
  kind?: TaskKind
  provider?: 'claude-code' | 'codex'
  outcome?: 'success' | 'fail' | 'cancelled' | 'candidate-unavailable' | 'outcome-unknown'
  /** USD; null: an unpriced run. */
  cost?: string | null
  durationMs?: number
  trial?: boolean
  ticket?: number
  at?: string
  model?: string
}

let clock = 0
/** Runs in the order they were recorded, one minute apart. */
function runs(count: number, spec: Spec = {}): LedgerRun[] {
  return Array.from({ length: count }, () => one(spec))
}
function one(spec: Spec = {}): LedgerRun {
  const tier = TIERS[spec.tier ?? 'build']
  const outcome = spec.outcome ?? 'success'
  const record = buildRunRecord({
    host: 'claude-code',
    provider: spec.provider ?? 'claude-code',
    tier: tier.tier,
    taskKind: spec.kind ?? 'multi-file-feature',
    ticket: spec.ticket ?? null,
    model: spec.model ?? tier.model,
    effort: tier.effort,
    trial: spec.trial ?? false,
    at: spec.at ?? new Date(T0 + clock++ * 60_000).toISOString(),
    durationMs: spec.durationMs ?? 60_000,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    outcome: outcome === 'outcome-unknown' ? undefined : outcome === 'fail' ? 'fail' : outcome === 'success' ? 'pass' : outcome,
    checks: ['type-check']
  })
  // The cost is set by the spec, not by the catalogue, so a scenario states the figure it reasons about.
  const priced = { ...record, cost: spec.cost === null ? null : { amount: spec.cost ?? '1.00000000', currency: 'USD' as const } }
  return foldLedger([priced]).runs[0]
}
/** Interleave outcomes in order: 's' success, 'f' failure. */
const sequence = (pattern: string, spec: Spec = {}): LedgerRun[] => [...pattern].map((symbol) => one({ ...spec, outcome: symbol === 'f' ? 'fail' : 'success' }))
/** foldLedger sorts by time, so the order of the argument is the order of the history. */
const history = (...groups: LedgerRun[][]): LedgerRun[] => groups.flat().sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))

function context(all: LedgerRun[], overrides: { shared?: RoutingOverrides; local?: LocalRouting; policy?: RoutingAdjustConfig } = {}): AdjustContext {
  return { shared: overrides.shared, local: overrides.local ?? emptyLocalRouting(), policy: resolveAdjustPolicy(overrides.policy), runs: all, now: NOW }
}

describe('expected feature cost (#1035)', () => {
  const stats = (pattern: string, cost: string) => windowStats('claude-sonnet-5-5/xhigh', sequence(pattern, { cost }))

  it('is the cost of a run divided by its success rate, plus what a failure triggers', () => {
    // 7 of 10 succeed at $1 a run: 1 / 0.7 + 0.3 x F, F being a run of the next tier up at $5
    const expected = expectedFeatureCost(stats('sssssssfff', '1.00000000'), new ExactRational(5n))
    expect(expected!.compare(new ExactRational(10n, 7n).add(new ExactRational(3n, 10n).multiply(new ExactRational(5n))))).toBe(0)
  })

  it('charges a failure one more run of the same candidate when nothing else was measured', () => {
    // 1 / 0.5 + 0.5 x 1 = 2.5
    expect(expectedFeatureCost(stats('sf', '1.00000000'))!.compare(new ExactRational(5n, 2n))).toBe(0)
  })

  it('is unknown for a candidate with no priced run or no success: it has no finite cost', () => {
    expect(expectedFeatureCost(windowStats('x/y', sequence('ss', { cost: null })))).toBeNull()
    expect(expectedFeatureCost(stats('ff', '1.00000000'))).toBeNull()
  })

  it('summarises a window with nearest-rank percentiles', () => {
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
    // Expected feature cost of the tier it left: 1 / 0.7 + 0.3 x 1, rounded up once at 1e-6; the target was never measured
    expect(decision.evidence!.expectedFeatureCost).toEqual({ from: '1.728572', to: null, currency: 'USD' })
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
    expect(adjustRouting(context(sequence('ssssssssff'))).decisions[0]).toMatchObject({ action: 'hold', reason: expect.stringMatching(/./) })
  })

  it('counts neither a run without an outcome nor a cancelled one nor an unavailable candidate as a failure', () => {
    const noise = [...runs(3, { outcome: 'outcome-unknown' }), ...runs(3, { outcome: 'cancelled' }), ...runs(3, { outcome: 'candidate-unavailable' })]
    expect(adjustRouting(context(history(noise, runs(7)))).moved).toBe(false)
  })

  it('counts a success the session reworked, or retried on a higher tier, as a failure', () => {
    // The ledger folds the runs of a step together: a retry on a higher tier is only visible to the whole history
    const record = (spec: Spec) =>
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
    const first = [0, 1, 2].map((index) => record({ ticket: 100 + index, at: new Date(T0 + 9_000_000 + index * 60_000).toISOString() }))
    const retries = [0, 1, 2].map((index) => record({ tier: 'fix', ticket: 100 + index, at: new Date(T0 + 9_000_000 + index * 60_000 + 1000).toISOString() }))
    const later = Array.from({ length: 7 }, (_, index) => record({ at: new Date(T0 + 9_100_000 + index * 60_000).toISOString() }))
    const folded = foldLedger([...first, ...retries, ...later]).runs
    expect(folded.filter((run) => run.escalated)).toHaveLength(3)
    const outcome = adjustRouting(context(folded))
    expect(outcome.decisions.find((decision) => decision.from === 'build')).toMatchObject({ action: 'escalate', to: 'fix' })
  })

  it('stays when a measured higher tier costs at least as much in expectation (the expected feature cost decides, not the failures alone)', () => {
    // build: 7 of 10 at $1 -> 1 / 0.7 + 0.3 x 5 = 2.93; fix: always succeeds at $5 -> 5
    const all = history(sequence('sssssssfff', { cost: '1.00000000' }), runs(10, { tier: 'fix', cost: '5.00000000' }))
    const decision = evaluateKind('multi-file-feature', 'claude-code', context(all))
    expect(decision).toMatchObject({ action: 'hold', reason: 'target-not-cheaper' })
    expect(decision.evidence!.expectedFeatureCost).toEqual({ from: '2.928572', to: '5.000000', currency: 'USD' })
  })

  it('moves up when the higher tier is measured and cheaper in expectation', () => {
    // build: 5 of 10 at $3 -> 3 / 0.5 + 0.5 x 1 = 6.5; fix: always succeeds at $1 -> 1
    const all = history(sequence('ssssfffff'.padEnd(10, 's'), { cost: '3.00000000' }), runs(10, { tier: 'fix', cost: '1.00000000' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'escalate', to: 'fix' })
  })

  it('moves up on reliability when nothing is priced: the expected cost only blocks a move it can see', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(sequence('sssssssfff', { cost: null })))).toMatchObject({ action: 'escalate', to: 'fix' })
  })

  it('cannot climb past the top of the ladder', () => {
    expect(evaluateKind('terminal-ci', 'claude-code', context(sequence('sssssssfff', { kind: 'terminal-ci', tier: 'terminal' })))).toMatchObject({ action: 'hold', reason: 'top-of-ladder' })
  })

  it('does not choose a higher tier whose p95 duration is over the declared ceiling', () => {
    const all = history(sequence('sssssssfff'), runs(5, { tier: 'fix', durationMs: 900_000 }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { maxDurationMs: 600_000 } }))).toMatchObject({ action: 'hold', reason: 'over-duration-ceiling' })
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'escalate' })
  })

  it('does not count evidence twice: after a move the window starts over', () => {
    const first = adjustRouting(context(sequence('sssssssfff')))
    expect(first.moved).toBe(true)
    const again = adjustRouting({ ...context(sequence('sssssssfff')), local: first.local, now: new Date(NOW.getTime() + 1000) })
    expect(again.moved).toBe(false)
    expect(again.local.log).toHaveLength(1)
  })

  it('honours the thresholds the project declares', () => {
    const policy = { escalate: { failures: 2, of: 4 } }
    expect(adjustRouting(context(sequence('ssff'), { policy })).moved).toBe(true)
    expect(adjustRouting(context(sequence('ssff'))).moved).toBe(false)
  })
})

describe("a developer's override is never changed automatically (#1035, AC-6)", () => {
  const shared: RoutingOverrides = { kinds: { 'multi-file-feature': { tier: 'build' } } }

  it('holds a kind the shared manifest overrides, whatever the evidence says, and offers no trial for it', () => {
    const all = history(sequence('ffffffffff'), runs(20, { tier: 'edit' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { shared }))).toMatchObject({ action: 'hold', reason: 'developer-override' })
    const outcome = adjustRouting(context(all, { shared }))
    expect(outcome.moved).toBe(false)
    expect(outcome.local).toEqual(emptyLocalRouting())
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
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { enabled: false } }))).toMatchObject({ action: 'hold', reason: 'disabled' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(30), { policy: { enabled: false } }))).toBeUndefined()
  })

  it('leaves a tier the project introduced alone', () => {
    const projectTier: RoutingOverrides = { kinds: {}, tiers: { docs: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } }
    const local: LocalRouting = { ...emptyLocalRouting(), kinds: { prose: { 'claude-code': { tier: 'docs', from: 'light', action: 'deescalate', at: NOW.toISOString(), evidence: {} as never } } } }
    expect(evaluateKind('prose', 'claude-code', context(sequence('ffffffffff', { kind: 'prose' }), { shared: projectTier, local }))).toMatchObject({ action: 'hold', reason: 'tier-not-on-ladder' })
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

  it('waits for the declared number of successes', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(history(x(), y(7))))).toMatchObject({ action: 'hold', reason: 'trial-not-proven' })
  })

  it('does not move on a single failure of the cheaper tier', () => {
    expect(evaluateKind('multi-file-feature', 'claude-code', context(history(x(), y(8), y(1, { outcome: 'fail' }))))).toMatchObject({ action: 'hold', reason: 'trial-not-proven' })
  })

  it('never crosses a floor: the grid excludes the cheaper candidate for this kind', () => {
    const floor: RoutingOverrides = { tiers: { edit: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' } } } }
    const all = history(x(), y(20, { model: 'claude-haiku-5-5' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { shared: floor }))).toMatchObject({ action: 'hold', reason: 'floor' })
    expect(selectTrial('multi-file-feature', 'claude-code', context(all, { shared: floor }))).toBeUndefined()
  })

  it('cannot say a cheaper tier is cheaper when nothing is priced', () => {
    const all = history(runs(10, { tier: 'build', cost: null }), y(8, { cost: null }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'hold', reason: 'unpriced' })
  })

  it('stays when the cheaper tier costs more in expectation than the routed one', () => {
    const all = history(runs(10, { tier: 'build', cost: '0.10000000' }), y(8, { cost: '2.00000000' }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all))).toMatchObject({ action: 'hold', reason: 'cheaper-tier-costs-more' })
  })

  describe('duration breaks a tie within the cost band', () => {
    const tied = (trialDuration: number) => history(runs(10, { tier: 'build', cost: '1.00000000', durationMs: 100_000 }), y(8, { cost: '0.95000000', durationMs: trialDuration }))

    it('moves down when the cheaper tier is as cheap within the band and faster', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(50_000)))).toMatchObject({ action: 'deescalate', to: 'edit' })
    })

    it('stays when it is not faster', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(200_000)))).toMatchObject({ action: 'hold', reason: 'tie-not-faster' })
    })

    it('uses the band the project declares', () => {
      expect(evaluateKind('multi-file-feature', 'claude-code', context(tied(200_000), { policy: { costBand: 0 } }))).toMatchObject({ action: 'deescalate' })
    })
  })

  it('does not choose a cheaper tier whose p95 duration is over the declared ceiling', () => {
    const all = history(x(), y(8, { durationMs: 900_000 }))
    expect(evaluateKind('multi-file-feature', 'claude-code', context(all, { policy: { maxDurationMs: 600_000 } }))).toMatchObject({ action: 'hold', reason: 'over-duration-ceiling' })
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

describe('the bounded trial of the cheaper tier (#1035, AC-5)', () => {
  it('is offered once the kind has enough runs for one trial to stay within the declared share', () => {
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(8)))).toBeUndefined()
    expect(selectTrial('multi-file-feature', 'claude-code', context(runs(9)))).toMatchObject({ tier: 'edit', effectiveTier: 'build', candidate: { model: 'claude-haiku-5-5', effort: 'high' } })
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
