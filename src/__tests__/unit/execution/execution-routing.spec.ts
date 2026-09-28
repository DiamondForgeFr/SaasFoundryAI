import {
  assertExecutionRoutingDecision,
  assertExecutionRoutingEvidence,
  createExecutionRoutingPolicy,
  selectExecutionRoute,
  type ExecutionRoutingEvidence,
  type ExecutionRoutingMetrics,
  type ExecutionRoutingComparisonRule
} from '../../../execution/routing'
import { classifyTaskIntent } from '../../../execution/classifier'
import type { ExecutionRequirementSet } from '../../../execution/requirements'
import type { ExecutionCandidate, ExecutionCandidateCatalogueSnapshot } from '../../../execution/types'
import type { QualifiedExecutionPlan } from '../../../execution/plans'
import { stableFingerprint } from '../../../execution/overrides'
import { createExecutionCandidateId } from '../../../execution/catalogue'

const OBSERVED_AT = '2026-09-14T10:00:00.000Z'
const EVALUATED_AT = '2026-09-14T12:00:00.000Z'
const VALID_UNTIL = '2026-09-15T12:00:00.000Z'

function candidate(id: string, runtime: 'local' | 'cloud', boundary: 'local-device' | 'provider-managed'): ExecutionCandidate {
  return {
    id: createExecutionCandidateId('fixture', runtime, id, 'medium'),
    provider: { id: 'fixture' },
    runtime: { id: runtime, kind: runtime },
    model: { id },
    effort: { normalized: 'medium', sourceId: 'medium' },
    context: { windowTokens: 64_000, maxOutputTokens: 8_000 },
    capabilities: ['code', 'text'],
    availability: { state: 'available', checkedAt: OBSERVED_AT, validUntil: VALID_UNTIL },
    pricing: {
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      dimensions: [{ kind: 'request', amount: runtime === 'local' ? '0' : '1', currency: 'USD', unit: 'request', per: 1, sourceUnit: 'request' }]
    },
    privacy: { boundary, trainingUse: 'none', retentionDays: runtime === 'local' ? 0 : 30 },
    tools: { mode: 'none', supported: [], parallelCalls: false, requiresApproval: false },
    source: { adapterId: 'fixture', candidateRef: `models/${id}`, retrievedAt: OBSERVED_AT }
  }
}

function catalogue(entries: ExecutionCandidate[]): ExecutionCandidateCatalogueSnapshot {
  return { version: 1, generatedAt: OBSERVED_AT, eligible: entries, excluded: [] }
}

function requirements(localOnly = false): ExecutionRequirementSet {
  const base = classifyTaskIntent({ text: 'Edit a source file', categories: ['implementation'], signals: { operation: 'edit' } })
  if (!localOnly) return base
  const value = structuredClone(base)
  value.effective.privacy.allowedBoundaries = ['local-device']
  value.id = stableFingerprint({ ...value, id: undefined })
  return value
}

function plan(planId: string, entry: ExecutionCandidate, latency: number, nodeCount = 1, fallbackEntry = entry, expectedMoney = '0', maximumMoney = expectedMoney): QualifiedExecutionPlan {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    nodeId: index === 0 ? 'primary' : `fallback-${index}`,
    candidateId: index === 0 ? entry.id : fallbackEntry.id,
    reachProbability: { numerator: '1', denominator: '1' },
    invocationP95: { currency: 'USD', numerator: '0', denominator: '1', amount: '0.0000', scale: 4, rounding: 'ceiling' as const },
    weightedP95: { currency: 'USD', numerator: '0', denominator: '1', amount: '0.0000', scale: 4, rounding: 'ceiling' as const }
  }))
  return {
    proposalId: planId,
    proposalFingerprint: stableFingerprint({ planId }),
    rootCandidateId: entry.id,
    rootEffort: 'medium',
    rootRuntimeKind: entry.runtime.kind,
    rootBoundary: entry.privacy.boundary,
    nodeCount,
    maximumPathLatencyP95Ms: latency,
    validUntil: VALID_UNTIL,
    approvalRequired: false,
    checks: [],
    evidenceRefs: [`plan/${planId}`],
    nodeCosts: nodes,
    expectedAggregateP95: { currency: 'USD', numerator: expectedMoney, denominator: '1', amount: `${expectedMoney}.0000`, scale: 4, rounding: 'ceiling' },
    maximumPathP95: { currency: 'USD', numerator: maximumMoney, denominator: '1', amount: `${maximumMoney}.0000`, scale: 4, rounding: 'ceiling' }
  }
}

function evidenceFor(planValue: QualifiedExecutionPlan, nodes: ExecutionRoutingEvidence['nodes'], fallbackVisible = false, metrics: Partial<ExecutionRoutingMetrics> = {}): ExecutionRoutingEvidence {
  const local = nodes.some((entry) => entry.runtimeKind === 'local')
  const defaults: ExecutionRoutingMetrics = {
    observedAt: OBSERVED_AT,
    validUntil: VALID_UNTIL,
    energyMilliwattHours: local ? '10' : null,
    devicePressureRatio: local ? '0.10' : null,
    failureProbability: local ? '0.01' : '0.05',
    fallbackExposureProbability: fallbackVisible ? '0.20' : '0'
  }
  const payload = {
    schemaVersion: 1 as const,
    planId: planValue.proposalId,
    planFingerprint: planValue.proposalFingerprint,
    generatedAt: OBSERVED_AT,
    validUntil: VALID_UNTIL,
    fallbackVisible,
    nodes,
    metrics: { ...defaults, ...metrics },
    evidenceRefs: [`routing/${planValue.proposalId}`]
  }
  return { ...payload, id: stableFingerprint(payload) }
}

function node(nodeId: string, entry: ExecutionCandidate, runtimeKind: 'local' | 'cloud', boundary: 'local-device' | 'provider-managed', role: 'primary' | 'fallback' = 'primary') {
  return { nodeId, candidateId: entry.id, runtimeKind, boundary, role, observedAt: OBSERVED_AT, validUntil: VALID_UNTIL, evidenceRefs: [`evidence/${nodeId}`] }
}

function policy(overrides: Partial<Parameters<typeof createExecutionRoutingPolicy>[0]> = {}) {
  return createExecutionRoutingPolicy({
    version: 'routing/v1',
    generatedAt: OBSERVED_AT,
    validUntil: VALID_UNTIL,
    settlementCurrency: 'USD',
    runtimePreference: ['local', 'cloud', 'hybrid'],
    privacyPreference: ['local-device', 'customer-controlled', 'provider-managed', 'unknown'],
    comparisonOrder: [
      'preferred-runtime',
      'preferred-privacy-boundary',
      'lower-energy-mwh',
      'lower-device-pressure',
      'lower-failure-probability',
      'lower-fallback-exposure',
      'lower-max-path-latency',
      'lower-expected-money',
      'lower-max-money',
      'fewer-nodes',
      'canonical-plan-id'
    ],
    thresholds: {
      maximumPathLatencyP95Ms: 5_000,
      maximumEnergyMilliwattHours: '100',
      maximumDevicePressureRatio: '1',
      maximumFailureProbability: '1',
      maximumFallbackExposureProbability: '1',
      maximumPlanNodes: 8,
      requireEvidenceRefs: true
    },
    ...overrides
  })
}

function firstRule(rule: ExecutionRoutingComparisonRule): ExecutionRoutingComparisonRule[] {
  const all: ExecutionRoutingComparisonRule[] = [
    'preferred-runtime',
    'preferred-privacy-boundary',
    'lower-energy-mwh',
    'lower-device-pressure',
    'lower-failure-probability',
    'lower-fallback-exposure',
    'lower-max-path-latency',
    'lower-expected-money',
    'lower-max-money',
    'fewer-nodes',
    'canonical-plan-id'
  ]
  return [rule, ...all.filter((entry) => entry !== rule)]
}

describe('execution routing contracts (#756)', () => {
  it('selects deterministically over qualified plans without comparing money', () => {
    const local = candidate('local-model', 'local', 'local-device')
    const cloud = candidate('cloud-model', 'cloud', 'provider-managed')
    const localPlan = plan('plan/local', local, 900)
    const cloudPlan = plan('plan/cloud', cloud, 500)
    const evidence = [evidenceFor(localPlan, [node('primary', local, 'local', 'local-device')]), evidenceFor(cloudPlan, [node('primary', cloud, 'cloud', 'provider-managed')])]

    const first = selectExecutionRoute([localPlan, cloudPlan], catalogue([local, cloud]), requirements(), evidence, policy(), EVALUATED_AT)
    const second = selectExecutionRoute([cloudPlan, localPlan], catalogue([cloud, local]), requirements(), [...evidence].reverse(), policy(), EVALUATED_AT)

    expect(first.status).toBe('selected')
    expect(first.selectedPlanId).toBe('plan/local')
    expect(first).toEqual(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(first.selectedPlan?.expectedAggregateP95.amount).toBe('0.0000')
  })

  it('requires all fallback nodes to be visible and rejects cloud fallback for local-only requirements', () => {
    const local = candidate('local-model', 'local', 'local-device')
    const cloud = candidate('cloud-model', 'cloud', 'provider-managed')
    const fallback = plan('plan/fallback', local, 900, 2, cloud)
    const fallbackEvidence = evidenceFor(fallback, [node('primary', local, 'local', 'local-device'), node('fallback-1', cloud, 'cloud', 'provider-managed', 'fallback')], true)

    const localOnly = selectExecutionRoute([fallback], catalogue([local, cloud]), requirements(true), [fallbackEvidence], policy(), EVALUATED_AT)
    expect(localOnly.status).toBe('unroutable')
    expect(localOnly.exclusions).toEqual([expect.objectContaining({ code: 'privacy-mismatch', detailCode: 'cloud-fallback-forbidden-by-local-only-requirement' })])

    const hiddenEvidence = evidenceFor(fallback, fallbackEvidence.nodes, false, { fallbackExposureProbability: '0.20' })
    const hidden = selectExecutionRoute([fallback], catalogue([local, cloud]), requirements(), [hiddenEvidence], policy(), EVALUATED_AT)
    expect(hidden.exclusions).toEqual([expect.objectContaining({ code: 'fallback-not-visible', detailCode: 'fallback-not-declared' })])
  })

  it.each([
    ['energy', 'lower-energy-mwh', { energyMilliwattHours: '20' }, { energyMilliwattHours: '10' }],
    ['device pressure', 'lower-device-pressure', { devicePressureRatio: '0.80' }, { devicePressureRatio: '0.20' }],
    ['failure probability', 'lower-failure-probability', { failureProbability: '0.40' }, { failureProbability: '0.05' }],
    ['fallback exposure', 'lower-fallback-exposure', { fallbackExposureProbability: '0.80' }, { fallbackExposureProbability: '0.10' }]
  ] as const)('lets a zero-cost local plan lose on %s independently', (_label, rule, worseMetrics, betterMetrics) => {
    const worse = candidate('worse', 'local', 'local-device')
    const better = candidate('better', 'local', 'local-device')
    const cloudFallback = candidate('fallback', 'cloud', 'provider-managed')
    const worsePlan = rule === 'lower-fallback-exposure' ? plan('plan/worse', worse, 900, 2, cloudFallback) : plan('plan/worse', worse, 900)
    const betterPlan = rule === 'lower-fallback-exposure' ? plan('plan/better', better, 900, 2, cloudFallback) : plan('plan/better', better, 900)
    const worseNodes =
      rule === 'lower-fallback-exposure'
        ? [node('primary', worse, 'local', 'local-device'), node('fallback-1', cloudFallback, 'cloud', 'provider-managed', 'fallback')]
        : [node('primary', worse, 'local', 'local-device')]
    const betterNodes =
      rule === 'lower-fallback-exposure'
        ? [node('primary', better, 'local', 'local-device'), node('fallback-1', cloudFallback, 'cloud', 'provider-managed', 'fallback')]
        : [node('primary', better, 'local', 'local-device')]
    const evidence = [evidenceFor(worsePlan, worseNodes, rule === 'lower-fallback-exposure', worseMetrics), evidenceFor(betterPlan, betterNodes, rule === 'lower-fallback-exposure', betterMetrics)]
    const result = selectExecutionRoute(
      [worsePlan, betterPlan],
      catalogue(rule === 'lower-fallback-exposure' ? [worse, better, cloudFallback] : [worse, better]),
      requirements(),
      evidence,
      policy({ comparisonOrder: firstRule(rule) }),
      EVALUATED_AT
    )

    expect(result.selectedPlanId).toBe('plan/better')
    expect(result.selectedReason).toBe(rule)
    expect(result.selectedMetrics).toMatchObject(betterMetrics)
  })

  it('compares exact expected and maximum money already carried by qualified plans', () => {
    const local = candidate('local', 'local', 'local-device')
    const cloud = candidate('cloud', 'cloud', 'provider-managed')
    const localPlan = plan('plan/local-fallback', local, 900, 2, cloud, '2', '4')
    const cloudPlan = plan('plan/cloud', cloud, 900, 1, cloud, '1', '3')
    localPlan.expectedAggregateP95 = { currency: 'USD', numerator: '101', denominator: '100', amount: '1.0100', scale: 4, rounding: 'ceiling' }
    localPlan.maximumPathP95 = { currency: 'USD', numerator: '201', denominator: '100', amount: '2.0100', scale: 4, rounding: 'ceiling' }
    cloudPlan.expectedAggregateP95 = { currency: 'USD', numerator: '501', denominator: '500', amount: '1.0020', scale: 4, rounding: 'ceiling' }
    cloudPlan.maximumPathP95 = { currency: 'USD', numerator: '1001', denominator: '500', amount: '2.0020', scale: 4, rounding: 'ceiling' }
    const evidence = [
      evidenceFor(localPlan, [node('primary', local, 'local', 'local-device'), node('fallback-1', cloud, 'cloud', 'provider-managed', 'fallback')], true, { fallbackExposureProbability: '0.20' }),
      evidenceFor(cloudPlan, [node('primary', cloud, 'cloud', 'provider-managed')])
    ]
    const result = selectExecutionRoute([localPlan, cloudPlan], catalogue([local, cloud]), requirements(), evidence, policy({ comparisonOrder: firstRule('lower-expected-money') }), EVALUATED_AT)

    expect(result.selectedPlanId).toBe('plan/cloud')
    expect(result.comparisons[0]).toMatchObject({ rule: 'lower-expected-money', winnerPlanId: 'plan/cloud', loserPlanId: 'plan/local-fallback' })
  })

  it('accepts exact metric threshold boundaries and rejects the first unit beyond them', () => {
    const local = candidate('local', 'local', 'local-device')
    const checks = [
      ['energy-threshold', { maximumEnergyMilliwattHours: '10' }, { energyMilliwattHours: '10' }, { energyMilliwattHours: '10.1' }],
      ['device-pressure-threshold', { maximumDevicePressureRatio: '0.5' }, { devicePressureRatio: '0.5' }, { devicePressureRatio: '0.51' }],
      ['failure-threshold', { maximumFailureProbability: '0.2' }, { failureProbability: '0.2' }, { failureProbability: '0.21' }],
      ['fallback-exposure-threshold', { maximumFallbackExposureProbability: '0.3' }, { fallbackExposureProbability: '0.3' }, { fallbackExposureProbability: '0.31' }]
    ] as const
    for (const [code, threshold, acceptedMetrics, rejectedMetrics] of checks) {
      const cloudFallback = candidate(`fallback-${code}`, 'cloud', 'provider-managed')
      const nodeEntries =
        code === 'fallback-exposure-threshold'
          ? [node('primary', local, 'local', 'local-device'), node('fallback-1', cloudFallback, 'cloud', 'provider-managed', 'fallback')]
          : [node('primary', local, 'local', 'local-device')]
      const accepted = code === 'fallback-exposure-threshold' ? plan(`plan/accepted-${code}`, local, 900, 2, cloudFallback) : plan(`plan/accepted-${code}`, local, 900)
      const rejected = code === 'fallback-exposure-threshold' ? plan(`plan/rejected-${code}`, local, 900, 2, cloudFallback) : plan(`plan/rejected-${code}`, local, 900)
      const entries = code === 'fallback-exposure-threshold' ? [local, cloudFallback] : [local]
      const acceptedResult = selectExecutionRoute(
        [accepted],
        catalogue(entries),
        requirements(),
        [evidenceFor(accepted, nodeEntries, code === 'fallback-exposure-threshold', acceptedMetrics)],
        policy({ thresholds: { ...policy().thresholds, ...threshold } }),
        EVALUATED_AT
      )
      expect(acceptedResult.status).toBe('selected')
      const rejectedResult = selectExecutionRoute(
        [rejected],
        catalogue(entries),
        requirements(),
        [evidenceFor(rejected, nodeEntries, code === 'fallback-exposure-threshold', rejectedMetrics)],
        policy({ thresholds: { ...policy().thresholds, ...threshold } }),
        EVALUATED_AT
      )
      expect(rejectedResult.exclusions).toEqual([expect.objectContaining({ code })])
    }
  })

  it('enforces declared latency thresholds, current candidate evidence, and stable contract fingerprints', () => {
    const local = candidate('local-model', 'local', 'local-device')
    const slow = plan('plan/slow', local, 6_000)
    const result = selectExecutionRoute([slow], catalogue([local]), requirements(), [evidenceFor(slow, [node('primary', local, 'local', 'local-device')])], policy(), EVALUATED_AT)
    expect(result.status).toBe('unroutable')
    expect(result.exclusions).toEqual([expect.objectContaining({ code: 'latency-threshold' })])

    const tampered = evidenceFor(slow, [node('primary', local, 'local', 'local-device')]) as unknown as Record<string, unknown>
    tampered.evidenceRefs = ['routing/tampered']
    expect(() => assertExecutionRoutingEvidence(tampered)).toThrow(/canonical content/)
    expect(() => assertExecutionRoutingDecision(JSON.parse(JSON.stringify(result)))).not.toThrow()
  })

  it('supports cloud-only plans and rejects stale or missing operational evidence', () => {
    const cloud = candidate('cloud-model', 'cloud', 'provider-managed')
    const cloudPlan = plan('plan/cloud-only', cloud, 700)
    const current = evidenceFor(cloudPlan, [node('primary', cloud, 'cloud', 'provider-managed')])
    expect(selectExecutionRoute([cloudPlan], catalogue([cloud]), requirements(), [current], policy(), EVALUATED_AT).status).toBe('selected')
    expect(selectExecutionRoute([cloudPlan], catalogue([cloud]), requirements(), [], policy(), EVALUATED_AT).status).toBe('unroutable')

    const stale = { ...current, validUntil: OBSERVED_AT }
    const result = selectExecutionRoute([cloudPlan], catalogue([cloud]), requirements(), [stale], policy(), EVALUATED_AT)
    expect(result.exclusions).toEqual([expect.objectContaining({ code: 'evidence-mismatch' })])
  })
})
