import {
  authorizeAdaptiveExecutionRoute,
  createExecutionCloudDispatchManifest,
  selectAdaptiveExecutionRoute,
  type AdaptiveExecutionHostAuthority,
  type ExecutionCloudBoundaryApprovalGrant,
  type ExecutionCloudBoundaryContext
} from '../../../execution/route-authority'
import { createExecutionCandidateId } from '../../../execution/catalogue'
import { classifyTaskIntent } from '../../../execution/classifier'
import { assertAdaptiveExecutionRouteExplanation, explainAdaptiveExecutionRoute } from '../../../execution/explanations'
import { stableFingerprint } from '../../../execution/overrides'
import { selectMinimumCostExecutionPlan } from '../../../execution/planner'
import type { ExecutionPlanProposal, ExecutionPlanSelectionPolicy } from '../../../execution/plans'
import { createExecutionRoutingPolicy, type ExecutionRoutingEvidence } from '../../../execution/routing'
import type { ExecutionCandidate, ExecutionCandidateCatalogueSnapshot } from '../../../execution/types'
import type { ExecutionBudgetApprovalGrant, SessionWorkloadEvidence } from '../../../execution/budget'

const OBSERVED_AT = '2026-09-14T10:00:00.000Z'
const PLANNING_AT = '2026-09-14T12:00:00.000Z'
const EVALUATED_AT = '2026-09-14T12:01:00.000Z'
const APPROVED_AT = '2026-09-14T12:02:00.000Z'
const VALID_UNTIL = '2026-09-15T12:00:00.000Z'

function candidate(model: string, runtime: 'local' | 'cloud', boundary: 'local-device' | 'provider-managed', price: string): ExecutionCandidate {
  return {
    id: createExecutionCandidateId('fixture', runtime, model, 'medium'),
    provider: { id: 'fixture' },
    runtime: { id: runtime, kind: runtime },
    model: { id: model },
    effort: { normalized: 'medium', sourceId: 'medium' },
    context: { windowTokens: 64_000, maxOutputTokens: 8_000 },
    capabilities: ['code', 'text'],
    availability: { state: 'available', checkedAt: OBSERVED_AT, validUntil: VALID_UNTIL },
    pricing: { observedAt: OBSERVED_AT, validUntil: VALID_UNTIL, dimensions: [{ kind: 'request', amount: price, currency: 'USD', unit: 'request', per: 1, sourceUnit: 'request' }] },
    privacy: { boundary, trainingUse: 'none', retentionDays: 0 },
    tools: { mode: 'none', supported: [], parallelCalls: false, requiresApproval: false },
    source: { adapterId: 'fixture', candidateRef: `models/${model}`, retrievedAt: OBSERVED_AT }
  }
}

function fallbackProposal(local: ExecutionCandidate, cloud: ExecutionCandidate): ExecutionPlanProposal {
  return {
    schemaVersion: 1,
    id: 'plan/local-with-cloud-fallback',
    rootNodeId: 'primary',
    nodes: [
      {
        id: 'primary',
        role: 'primary',
        candidateId: local.id,
        estimate: { usageP95: { request: '1' }, latencyP95Ms: 800, observedAt: OBSERVED_AT, validUntil: VALID_UNTIL, evidenceRef: 'estimate/local', independenceDomain: 'host/local' },
        tools: [],
        checks: ['automated-tests', 'self-review', 'type-check'],
        outcomes: [
          { code: 'success', conditionalProbability: '0.9', evidenceRef: 'outcomes/local-success' },
          { code: 'execution-failed', conditionalProbability: '0.1', nextNodeId: 'fallback', evidenceRef: 'outcomes/local-failure' }
        ]
      },
      {
        id: 'fallback',
        role: 'fallback',
        candidateId: cloud.id,
        estimate: { usageP95: { request: '1' }, latencyP95Ms: 1_200, observedAt: OBSERVED_AT, validUntil: VALID_UNTIL, evidenceRef: 'estimate/cloud', independenceDomain: 'provider/cloud' },
        tools: [],
        checks: [],
        outcomes: [{ code: 'success', conditionalProbability: '1', evidenceRef: 'outcomes/cloud-success' }]
      }
    ]
  }
}

const requirements = classifyTaskIntent({ text: 'Document a public value', categories: ['mechanical'], signals: { operation: 'document' } })
const planningPolicy: ExecutionPlanSelectionPolicy = { schemaVersion: 1, planningAt: PLANNING_AT, settlementCurrency: 'USD', displayScale: 4, tieBreakers: ['lower-max-path-cost'] }
const routingPolicy = createExecutionRoutingPolicy({
  version: 'routing/v1',
  generatedAt: OBSERVED_AT,
  validUntil: VALID_UNTIL,
  settlementCurrency: 'USD',
  runtimePreference: ['local', 'cloud', 'hybrid'],
  privacyPreference: ['local-device', 'customer-controlled', 'provider-managed', 'unknown'],
  comparisonOrder: [
    'lower-failure-probability',
    'lower-device-pressure',
    'lower-max-path-latency',
    'lower-fallback-exposure',
    'lower-energy-mwh',
    'lower-expected-money',
    'lower-max-money',
    'preferred-runtime',
    'preferred-privacy-boundary',
    'fewer-nodes',
    'canonical-plan-id'
  ],
  thresholds: {
    maximumPathLatencyP95Ms: 10_000,
    maximumEnergyMilliwattHours: '100',
    maximumDevicePressureRatio: '0.9',
    maximumFailureProbability: '0.5',
    maximumFallbackExposureProbability: '0.5',
    maximumPlanNodes: 8,
    requireEvidenceRefs: true
  }
})

function fixture(evidenceValidUntil = VALID_UNTIL, sessionPrice = '10') {
  const sessionCandidate = candidate('session', 'cloud', 'provider-managed', sessionPrice)
  const local = candidate('local', 'local', 'local-device', '0')
  const cloud = candidate('fallback', 'cloud', 'provider-managed', '2')
  const proposals = [fallbackProposal(local, cloud)]
  const catalogue: ExecutionCandidateCatalogueSnapshot = { version: 1, generatedAt: OBSERVED_AT, eligible: [sessionCandidate, local, cloud], excluded: [] }
  const qualified = selectMinimumCostExecutionPlan(proposals, requirements, catalogue, planningPolicy).qualified[0]
  const evidencePayload = {
    schemaVersion: 1 as const,
    planId: qualified.proposalId,
    planFingerprint: qualified.proposalFingerprint,
    generatedAt: OBSERVED_AT,
    validUntil: evidenceValidUntil,
    fallbackVisible: true,
    nodes: [
      {
        nodeId: 'primary',
        candidateId: local.id,
        role: 'primary' as const,
        runtimeKind: 'local' as const,
        boundary: 'local-device' as const,
        observedAt: OBSERVED_AT,
        validUntil: evidenceValidUntil,
        evidenceRefs: ['routing/local']
      },
      {
        nodeId: 'fallback',
        candidateId: cloud.id,
        role: 'fallback' as const,
        runtimeKind: 'cloud' as const,
        boundary: 'provider-managed' as const,
        observedAt: OBSERVED_AT,
        validUntil: evidenceValidUntil,
        evidenceRefs: ['routing/cloud']
      }
    ],
    metrics: { observedAt: OBSERVED_AT, validUntil: evidenceValidUntil, energyMilliwattHours: '12', devicePressureRatio: '0.2', failureProbability: '0.1', fallbackExposureProbability: '0.1' },
    evidenceRefs: ['routing/route-1']
  }
  const routingEvidence: ExecutionRoutingEvidence[] = [{ ...evidencePayload, id: stableFingerprint(evidencePayload) }]
  const route = selectAdaptiveExecutionRoute(proposals, requirements, catalogue, planningPolicy, routingEvidence, routingPolicy)
  const session: SessionWorkloadEvidence = {
    schemaVersion: 1,
    sessionId: 'session/current',
    candidateId: sessionCandidate.id,
    usageP95: { request: '1' },
    observedAt: OBSERVED_AT,
    validUntil: VALID_UNTIL,
    evidenceRef: 'session/workload',
    authorityRevision: 'session/revision-1'
  }
  const consumed = new Set<string>()
  const host: AdaptiveExecutionHostAuthority = {
    requirements,
    proposals,
    routingEvidence,
    verifyRoutingEvidence: () => true,
    verifyDispatchManifest: () => true,
    verifySessionEvidence: () => true,
    verifyBudgetApprovalGrant: () => true,
    verifyCloudBoundaryApprovalGrant: () => true,
    consumeRouteAuthority: ({ permit, budgetApprovalEventId, cloudBoundaryApprovalEventId }) => {
      const key = [permit.id, budgetApprovalEventId, cloudBoundaryApprovalEventId].filter(Boolean).join('/')
      if (consumed.has(key)) return false
      consumed.add(key)
      return true
    }
  }
  return { catalogue, route, session, host, consumed }
}

function boundaryContext(route: ReturnType<typeof selectAdaptiveExecutionRoute>): ExecutionCloudBoundaryContext {
  return {
    dispatchManifest: createExecutionCloudDispatchManifest({
      routingDecisionId: route.id,
      proposalFingerprint: route.selectedPlan!.proposalFingerprint,
      cloudNodeIds: ['fallback'],
      generatedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      parts: [
        { scope: 'prompt', contentRef: 'content/prompt', byteLength: 1, sha256: 'a'.repeat(64) },
        { scope: 'source', contentRef: 'content/source', byteLength: 1, sha256: 'b'.repeat(64) },
        { scope: 'generated-content', contentRef: 'content/generated', byteLength: 1, sha256: 'c'.repeat(64) }
      ]
    }),
    triggerRefs: ['trigger/local-execution-failed'],
    rationaleRefs: ['policy/cloud-fallback']
  }
}

describe('adaptive execution route authority (#757)', () => {
  it('keeps an explicit cloud fallback blocked until the independent boundary grant exists', () => {
    const { catalogue, route, session, host } = fixture()
    const boundary = boundaryContext(route)
    const pending = authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED_AT, cloudBoundary: boundary }, host)

    expect(pending).toMatchObject({ status: 'approval-required', reasonCode: 'cloud-boundary-approval-required', cloudBoundaryRequired: true, dispatchAuthorized: false })
    expect(pending.budgetDecision).toMatchObject({ status: 'authorized', mode: 'automatic' })
    expect(pending.cloudBoundaryChallenge?.cloudNodes).toEqual([expect.objectContaining({ nodeId: 'fallback', role: 'fallback', boundary: 'provider-managed' })])
    const explanation = explainAdaptiveExecutionRoute(route, host.routingEvidence, pending)
    expect(explanation.selected?.fallbackNodes).toEqual([expect.objectContaining({ nodeId: 'fallback', candidateId: expect.stringContaining('/fallback/') })])
    expect(explanation.authority).toMatchObject({ status: 'approval-required', cloudBoundaryRequired: true, dispatchAuthorized: false })
    expect(() => assertAdaptiveExecutionRouteExplanation(explanation)).not.toThrow()
    expect(JSON.stringify(explanation)).not.toMatch(/prompt text|source code|completion|\/private\//)
    const unsafePayload = { ...explanation, prompt: 'secret prompt' }
    const unsafe = { ...unsafePayload, id: stableFingerprint(Object.fromEntries(Object.entries(unsafePayload).filter(([key]) => key !== 'id'))) }
    expect(() => assertAdaptiveExecutionRouteExplanation(unsafe)).toThrow(/unsupported fields/)
    const oversizedPayload = { ...explanation, evidenceRefs: Array.from({ length: 257 }, (_value, index) => `evidence/${String(index).padStart(3, '0')}`) }
    const oversized = { ...oversizedPayload, id: stableFingerprint(Object.fromEntries(Object.entries(oversizedPayload).filter(([key]) => key !== 'id'))) }
    expect(() => assertAdaptiveExecutionRouteExplanation(oversized)).toThrow(/evidence references are invalid/)
  })

  it('authorizes only the exact host-verified grant and consumes it once', () => {
    const { catalogue, route, session, host } = fixture()
    const boundary = boundaryContext(route)
    const pending = authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED_AT, cloudBoundary: boundary }, host)
    const challenge = pending.cloudBoundaryChallenge!
    const grant: ExecutionCloudBoundaryApprovalGrant = {
      schemaVersion: 1,
      id: 'approval/cloud-boundary-1',
      challengeId: challenge.id,
      routingDecisionId: challenge.routingDecisionId,
      budgetPlanDecisionId: challenge.budgetPlanDecisionId,
      approvedAt: EVALUATED_AT,
      validUntil: challenge.validUntil,
      approvedByRef: 'user/owner'
    }

    expect(
      authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: APPROVED_AT, cloudBoundary: { ...boundary, approval: grant } }, host)
    ).toMatchObject({
      status: 'authorized',
      reasonCode: 'route-authorized',
      cloudBoundaryApprovalEventId: grant.id,
      dispatchPermit: { dispatchManifestId: boundary.dispatchManifest.id, cloudNodeIds: ['fallback'] },
      dispatchAuthorized: true
    })
    expect(
      authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: APPROVED_AT, cloudBoundary: { ...boundary, approval: grant } }, host)
    ).toMatchObject({ status: 'rejected', reasonCode: 'approval-host-rejected', dispatchAuthorized: false })
  })

  it('rejects grants when the route-bound challenge changes', () => {
    const { catalogue, route, session, host } = fixture()
    const boundary = boundaryContext(route)
    const pending = authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED_AT, cloudBoundary: boundary }, host)
    const challenge = pending.cloudBoundaryChallenge!
    const forged: ExecutionCloudBoundaryApprovalGrant = {
      schemaVersion: 1,
      id: 'approval/cloud-boundary-forged',
      challengeId: stableFingerprint('other-challenge'),
      routingDecisionId: challenge.routingDecisionId,
      budgetPlanDecisionId: challenge.budgetPlanDecisionId,
      approvedAt: EVALUATED_AT,
      validUntil: challenge.validUntil,
      approvedByRef: 'user/owner'
    }
    expect(
      authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: APPROVED_AT, cloudBoundary: { ...boundary, approval: forged } }, host)
    ).toMatchObject({ status: 'rejected', reasonCode: 'cloud-boundary-approval-mismatch', dispatchAuthorized: false })
  })

  it('rejects routing evidence that the host cannot authenticate', () => {
    const { catalogue, route, session, host } = fixture()
    const boundary = boundaryContext(route)
    expect(
      authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED_AT, cloudBoundary: boundary }, { ...host, verifyRoutingEvidence: () => false })
    ).toMatchObject({ status: 'rejected', reasonCode: 'routing-evidence-host-rejected', dispatchAuthorized: false })
  })

  it('rejects a dispatch manifest whose cloud nodes do not match the selected route', () => {
    const { catalogue, route, session, host } = fixture()
    const boundary = boundaryContext(route)
    const manifest = createExecutionCloudDispatchManifest({
      routingDecisionId: boundary.dispatchManifest.routingDecisionId,
      proposalFingerprint: boundary.dispatchManifest.proposalFingerprint,
      cloudNodeIds: ['other-cloud-node'],
      generatedAt: boundary.dispatchManifest.generatedAt,
      validUntil: boundary.dispatchManifest.validUntil,
      parts: boundary.dispatchManifest.parts
    })
    expect(
      authorizeAdaptiveExecutionRoute(
        route,
        session,
        catalogue,
        planningPolicy,
        routingPolicy,
        {
          evaluatedAt: EVALUATED_AT,
          cloudBoundary: { ...boundary, dispatchManifest: manifest }
        },
        host
      )
    ).toMatchObject({ status: 'rejected', reasonCode: 'dispatch-manifest-rejected', dispatchAuthorized: false })
  })

  it('rejects a route when its operational evidence expires before dispatch', () => {
    const { catalogue, route, session, host } = fixture('2026-09-14T12:00:30.000Z')
    const boundary = boundaryContext(route)
    expect(authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED_AT, cloudBoundary: boundary }, host)).toMatchObject({
      status: 'rejected',
      reasonCode: 'route-evidence-stale',
      dispatchAuthorized: false
    })
  })

  it('keeps a budget grant reusable until budget and cloud authority commit together', () => {
    const { catalogue, route, session, host, consumed } = fixture(VALID_UNTIL, '0')
    const boundary = boundaryContext(route)
    const justification = { reasonCode: 'fallback-resilience' as const, expectedBenefitCodes: ['fallback-resilience' as const], evidenceRefs: ['routing/fallback-benefit'] }
    const pendingBudget = authorizeAdaptiveExecutionRoute(
      route,
      session,
      catalogue,
      planningPolicy,
      routingPolicy,
      { evaluatedAt: EVALUATED_AT, budget: { justification }, cloudBoundary: boundary },
      host
    )
    const budgetChallenge = pendingBudget.budgetDecision!.challenge!
    const budgetGrant: ExecutionBudgetApprovalGrant = {
      schemaVersion: 1,
      id: 'approval/budget-1',
      challengeId: budgetChallenge.id,
      sessionId: budgetChallenge.sessionId,
      planDecisionId: budgetChallenge.planDecisionId,
      expectedIncrement: budgetChallenge.expectedIncrement,
      pathIncrement: budgetChallenge.pathIncrement,
      approvedAt: EVALUATED_AT,
      validUntil: budgetChallenge.validUntil,
      approvedByRef: 'user/owner'
    }
    const badManifest = createExecutionCloudDispatchManifest({
      routingDecisionId: boundary.dispatchManifest.routingDecisionId,
      proposalFingerprint: boundary.dispatchManifest.proposalFingerprint,
      cloudNodeIds: ['wrong-node'],
      generatedAt: boundary.dispatchManifest.generatedAt,
      validUntil: boundary.dispatchManifest.validUntil,
      parts: boundary.dispatchManifest.parts
    })
    expect(
      authorizeAdaptiveExecutionRoute(
        route,
        session,
        catalogue,
        planningPolicy,
        routingPolicy,
        { evaluatedAt: APPROVED_AT, budget: { justification, approval: budgetGrant }, cloudBoundary: { ...boundary, dispatchManifest: badManifest } },
        host
      )
    ).toMatchObject({ status: 'rejected', reasonCode: 'dispatch-manifest-rejected' })
    expect(consumed.size).toBe(0)

    const pendingBoundary = authorizeAdaptiveExecutionRoute(
      route,
      session,
      catalogue,
      planningPolicy,
      routingPolicy,
      { evaluatedAt: APPROVED_AT, budget: { justification, approval: budgetGrant }, cloudBoundary: boundary },
      host
    )
    const boundaryChallenge = pendingBoundary.cloudBoundaryChallenge!
    const boundaryGrant: ExecutionCloudBoundaryApprovalGrant = {
      schemaVersion: 1,
      id: 'approval/cloud-boundary-budget-1',
      challengeId: boundaryChallenge.id,
      routingDecisionId: boundaryChallenge.routingDecisionId,
      budgetPlanDecisionId: boundaryChallenge.budgetPlanDecisionId,
      approvedAt: APPROVED_AT,
      validUntil: boundaryChallenge.validUntil,
      approvedByRef: 'user/owner'
    }
    const combinedInput = { evaluatedAt: APPROVED_AT, budget: { justification, approval: budgetGrant }, cloudBoundary: { ...boundary, approval: boundaryGrant } }
    expect(authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, combinedInput, host)).toMatchObject({
      status: 'authorized',
      dispatchAuthorized: true
    })
    expect(consumed.size).toBe(1)
    expect(authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, combinedInput, host)).toMatchObject({
      status: 'rejected',
      reasonCode: 'approval-host-rejected'
    })
    expect(consumed.size).toBe(1)
  })
})
