import { admitLocalExecutionCandidate } from '../../../execution/local-candidates'
import { createLocalBenchmarkPlan, createLocalBenchmarkSuite, resolveLocalBenchmarkCurrentState, runLocalBenchmark } from '../../../execution/local-benchmark'
import { localExecutionProfileId, type LocalExecutionProfile, type LocalExecutionProfileCandidate } from '../../../execution/local-profiles'
import { createLocalQualificationPolicy, qualifyLocalBenchmark, type LocalQualificationThreshold } from '../../../execution/local-qualification'
import { createLocalSetupProposal, createLocalSetupRecord } from '../../../execution/local-setup'
import { createExecutionCandidateId } from '../../../execution/catalogue'
import { classifyTaskIntent } from '../../../execution/classifier'
import { authorizeAdaptiveExecutionRoute, selectAdaptiveExecutionRoute, type AdaptiveExecutionHostAuthority, type ExecutionCloudBoundaryContext } from '../../../execution/route-authority'
import { stableFingerprint } from '../../../execution/overrides'
import { selectMinimumCostExecutionPlan } from '../../../execution/planner'
import { createExecutionRoutingPolicy, type ExecutionRoutingEvidence } from '../../../execution/routing'
import type { ExecutionPlanProposal, ExecutionPlanSelectionPolicy } from '../../../execution/plans'
import type { ExecutionCandidate, ExecutionCandidateCatalogueSnapshot } from '../../../execution/types'
import type { SessionWorkloadEvidence } from '../../../execution/budget'

const OBSERVED = '2026-09-14T10:00:00.000Z'
const PLANNING = '2026-09-14T10:30:00.000Z'
const EVALUATED = '2026-09-14T10:31:00.000Z'
const VALID_UNTIL = '2026-09-15T10:00:00.000Z'
const bytes = (value: number): string => String(BigInt(value) * 1024n * 1024n * 1024n)

function profile(): LocalExecutionProfile {
  const candidate: LocalExecutionProfileCandidate = {
    schemaVersion: 1,
    runtime: { runtimeId: 'runtime-portable', backend: 'none', optimization: 'portable' },
    artifact: { artifactId: 'artifact-small', modelId: 'model-local', format: 'gguf', quantization: 'q4', revision: 'r1', sha256: 'a'.repeat(64) },
    configuration: { contextTokens: 16_384, maxOutputTokens: 2_048, concurrency: 1 },
    resources: { artifactDownloadBytes: bytes(2), installedDiskBytes: bytes(2), systemMemoryBytes: bytes(2), acceleratorMemoryBytes: '0', memoryPool: 'system' },
    performance: { estimatedLatencyP95Ms: 500, estimatedTokensPerSecond: '30' },
    suitability: [
      { workload: 'coding', rating: 'preferred' },
      { workload: 'background', rating: 'suitable' },
      { workload: 'interactive', rating: 'suitable' },
      { workload: 'high-capability', rating: 'limited' }
    ],
    availability: { state: 'available', observedAt: OBSERVED, validUntil: VALID_UNTIL },
    evidenceRefs: ['profile/evidence']
  }
  return {
    id: localExecutionProfileId(candidate),
    adapterId: 'profile-adapter',
    sourceId: 'profile-source',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: candidate.runtime,
    artifact: candidate.artifact,
    configuration: candidate.configuration,
    resources: { ...candidate.resources, requiredDiskWithHeadroomBytes: bytes(3), requiredSystemMemoryWithHeadroomBytes: bytes(3), requiredAcceleratorMemoryWithHeadroomBytes: '0' },
    performance: candidate.performance,
    suitability: candidate.suitability,
    availability: candidate.availability,
    tradeoffCodes: ['portable-runtime', 'cpu-system-memory', 'bounded-context'],
    evidenceRefs: candidate.evidenceRefs
  }
}

function threshold(): LocalQualificationThreshold {
  return {
    taskClass: 'mechanical',
    minimumCompletedSamples: 2,
    maximumFailureRatio: '0',
    maximumStartupP95Ms: 100,
    maximumFirstTokenLatencyP95Ms: 300,
    minimumThroughputMedianTokensPerSecond: '20',
    minimumStableContextTokens: 8_192,
    maximumPeakSystemMemoryBytes: bytes(4),
    maximumPeakAcceleratorMemoryBytes: bytes(1),
    minimumSustainedThroughputRatio: '0.8',
    rejectThermalDegradation: false,
    requiredChecks: ['structured-output']
  }
}

async function localCandidate() {
  const selectedProfile = profile()
  const proposal = createLocalSetupProposal({
    profile: selectedProfile,
    generatedAt: OBSERVED,
    validUntil: VALID_UNTIL,
    runtime: { sourceRef: 'runtime/source', sourceRevision: 'r1', licenseRef: 'license/runtime', installSizeBytes: bytes(1), networkActivity: 'download' },
    model: { sourceRef: 'model/source', sourceRevision: selectedProfile.artifact.revision, licenseRef: 'license/model', networkActivity: 'download' },
    service: { binding: { scope: 'loopback', addressRef: 'interface:loopback', port: 11434 } },
    storage: { rootRef: 'store/local', outsideGeneratedRepository: true },
    evidenceRefs: ['setup/proposal']
  })
  const initial = createLocalSetupRecord(proposal, OBSERVED)
  const setup = {
    ...initial,
    revision: 2,
    state: 'ready' as const,
    resources: [
      { kind: 'runtime' as const, ref: 'runtime/r1', bytes: bytes(1), shared: true },
      { kind: 'model' as const, ref: 'model/r1', bytes: bytes(2), sha256: selectedProfile.artifact.sha256, shared: false }
    ],
    updatedAt: OBSERVED
  }
  const suite = createLocalBenchmarkSuite({
    version: 'suite-v1',
    corpusSha256: 'd'.repeat(64),
    validatorVersion: 'validator-v1',
    tasks: [{ id: 'task/mechanical', taskClass: 'mechanical', contextTokens: 4_096, maxOutputTokens: 512, requiredChecks: ['structured-output'] }],
    evidenceRefs: ['suite/evidence']
  })
  const plan = createLocalBenchmarkPlan({
    profile: selectedProfile,
    proposal,
    record: setup,
    suite,
    adapterId: 'adapter-v1',
    validatorId: 'validator-v1',
    generatedAt: OBSERVED,
    validUntil: VALID_UNTIL,
    iterations: 2,
    warmupIterations: 0,
    timeoutMs: 60_000,
    maximumTotalDurationMs: 300_000,
    evidenceRefs: ['plan/evidence']
  })
  const metrics = {
    startupMs: 50,
    firstTokenLatencyMs: 200,
    throughputTokensPerSecond: '25',
    stableContextTokens: 8_192,
    peakSystemMemoryBytes: bytes(2),
    peakAcceleratorMemoryBytes: '0',
    sustainedThroughputRatio: '0.9',
    thermalState: 'unknown' as const
  }
  const evidence = await runLocalBenchmark({
    plan,
    profile: selectedProfile,
    proposal,
    record: setup,
    suite,
    adapter: { id: plan.adapterId, run: () => ({ status: 'completed' as const, startedAt: OBSERVED, finishedAt: '2026-09-14T10:00:01.000Z', metrics, evidenceRefs: ['sample/evidence'] }) },
    validator: {
      id: plan.validatorId,
      validate: () => ({ checks: [{ kind: 'structured-output' as const, status: 'passed' as const, evidenceRef: 'check/evidence' }], evidenceRefs: ['check/evidence'] })
    },
    authority: { claimBenchmark: () => true, appendEvidence: (value: { id: string }) => ({ status: 'accepted' as const, evidenceId: value.id }) },
    evaluatedAt: OBSERVED
  })
  const currentState = resolveLocalBenchmarkCurrentState({ profile: selectedProfile, proposal, record: setup, suite, adapterId: plan.adapterId, validatorId: plan.validatorId })
  const qualificationPolicy = createLocalQualificationPolicy({
    version: 'qualification-v1',
    evaluatorVersion: 'evaluator-v1',
    generatedAt: OBSERVED,
    validUntil: VALID_UNTIL,
    thresholds: [threshold()],
    evidenceRefs: ['qualification/policy']
  })
  const qualification = qualifyLocalBenchmark({ plan, evidence, suite, policy: qualificationPolicy, currentState, currentQualificationPolicyId: qualificationPolicy.id, evaluatedAt: OBSERVED })
  const admission = admitLocalExecutionCandidate({
    profile: selectedProfile,
    proposal,
    setup,
    benchmarkPlan: plan,
    qualification,
    currentState,
    currentQualificationPolicyId: qualificationPolicy.id,
    taskClass: 'mechanical',
    authority: { verifyTransportAttestation: () => true },
    capabilities: ['code', 'text'],
    evaluatedAt: OBSERVED,
    transport: {
      schemaVersion: 1,
      profileId: selectedProfile.id,
      setupId: setup.id,
      setupRevision: setup.revision,
      hostSnapshotId: selectedProfile.hostSnapshotId,
      protocol: 'http',
      binding: { scope: 'loopback', addressRef: 'interface:loopback', port: 11434 },
      dataPath: { remoteUpstream: 'none', telemetry: 'disabled', toolTransport: 'local-only', logging: 'local-only', crashReporting: 'disabled', retrieval: 'none' },
      health: 'healthy',
      checkedAt: OBSERVED,
      validUntil: VALID_UNTIL,
      evidenceRefs: ['transport/health', 'transport/data-path']
    }
  })
  if (admission.status !== 'admitted') throw new Error(`local admission failed: ${admission.code}`)
  return { candidate: admission.candidate, setup, profile: selectedProfile, qualification }
}

function cloudCandidate(): ExecutionCandidate {
  return {
    id: createExecutionCandidateId('cloud', 'provider-runtime', 'fallback-model', 'medium'),
    provider: { id: 'cloud' },
    runtime: { id: 'provider-runtime', kind: 'cloud' },
    model: { id: 'fallback-model' },
    effort: { normalized: 'medium', sourceId: 'medium' },
    context: { windowTokens: 16_384, maxOutputTokens: 2_048 },
    capabilities: ['code', 'text'],
    availability: { state: 'available', checkedAt: OBSERVED, validUntil: VALID_UNTIL },
    pricing: { observedAt: OBSERVED, validUntil: VALID_UNTIL, dimensions: [{ kind: 'request', amount: '2', currency: 'USD', unit: 'request', per: 1, sourceUnit: 'request' }] },
    privacy: { boundary: 'provider-managed', trainingUse: 'none', retentionDays: 0 },
    tools: { mode: 'none', supported: [], parallelCalls: false, requiresApproval: false },
    source: { adapterId: 'cloud-adapter', candidateRef: 'cloud/fallback', retrievedAt: OBSERVED }
  }
}

describe('local to cloud adaptive routing (#757)', () => {
  it('admits a qualified local candidate through the public pipeline and blocks cloud fallback pending a boundary grant', async () => {
    const local = await localCandidate()
    const cloud = cloudCandidate()
    const proposal: ExecutionPlanProposal = {
      schemaVersion: 1,
      id: 'plan/local-cloud-fallback',
      rootNodeId: 'primary',
      nodes: [
        {
          id: 'primary',
          role: 'primary',
          candidateId: local.candidate.id,
          estimate: {
            usageP95: { 'input-token': '0', 'output-token': '0', 'cached-input-token': '0', request: '1', second: '0', minute: '0', 'tool-call': '0' },
            latencyP95Ms: 500,
            observedAt: OBSERVED,
            validUntil: VALID_UNTIL,
            evidenceRef: 'estimate/local',
            independenceDomain: 'host/local'
          },
          tools: [],
          checks: ['self-review', 'automated-tests', 'type-check'],
          outcomes: [
            { code: 'success', conditionalProbability: '0.9', evidenceRef: 'outcome/local-success' },
            { code: 'execution-failed', conditionalProbability: '0.1', nextNodeId: 'fallback', evidenceRef: 'outcome/local-failure' }
          ]
        },
        {
          id: 'fallback',
          role: 'fallback',
          candidateId: cloud.id,
          estimate: {
            usageP95: { 'input-token': '0', 'output-token': '0', 'cached-input-token': '0', request: '1', second: '0', minute: '0', 'tool-call': '0' },
            latencyP95Ms: 900,
            observedAt: OBSERVED,
            validUntil: VALID_UNTIL,
            evidenceRef: 'estimate/cloud',
            independenceDomain: 'provider/cloud'
          },
          tools: [],
          checks: [],
          outcomes: [{ code: 'success', conditionalProbability: '1', evidenceRef: 'outcome/cloud-success' }]
        }
      ]
    }
    const requirements = classifyTaskIntent({ text: 'Document a public value', categories: ['mechanical'], signals: { operation: 'document', dataSensitivity: 'public' } })
    const catalogue: ExecutionCandidateCatalogueSnapshot = { version: 1, generatedAt: OBSERVED, eligible: [local.candidate, cloud], excluded: [] }
    const planningPolicy: ExecutionPlanSelectionPolicy = { schemaVersion: 1, planningAt: PLANNING, settlementCurrency: 'USD', displayScale: 4, tieBreakers: ['lower-max-path-cost'] }
    const planning = selectMinimumCostExecutionPlan([proposal], requirements, catalogue, planningPolicy)
    expect(planning.qualified).toHaveLength(1)
    const qualified = planning.qualified[0]
    expect(local.qualification.status).toBe('qualified')
    expect(local.candidate.runtime.kind).toBe('local')
    const evidencePayload = {
      schemaVersion: 1 as const,
      planId: qualified.proposalId,
      planFingerprint: qualified.proposalFingerprint,
      generatedAt: OBSERVED,
      validUntil: VALID_UNTIL,
      fallbackVisible: true,
      nodes: [
        {
          nodeId: 'primary',
          candidateId: local.candidate.id,
          role: 'primary' as const,
          runtimeKind: 'local' as const,
          boundary: 'local-device' as const,
          observedAt: OBSERVED,
          validUntil: VALID_UNTIL,
          evidenceRefs: ['routing/local']
        },
        {
          nodeId: 'fallback',
          candidateId: cloud.id,
          role: 'fallback' as const,
          runtimeKind: 'cloud' as const,
          boundary: 'provider-managed' as const,
          observedAt: OBSERVED,
          validUntil: VALID_UNTIL,
          evidenceRefs: ['routing/cloud']
        }
      ],
      metrics: { observedAt: OBSERVED, validUntil: VALID_UNTIL, energyMilliwattHours: '5', devicePressureRatio: '0.2', failureProbability: '0.1', fallbackExposureProbability: '0.1' },
      evidenceRefs: ['routing/evidence']
    }
    const routingEvidence: ExecutionRoutingEvidence[] = [{ ...evidencePayload, id: stableFingerprint(evidencePayload) }]
    const routingPolicy = createExecutionRoutingPolicy({
      version: 'routing/v1',
      generatedAt: OBSERVED,
      validUntil: VALID_UNTIL,
      settlementCurrency: 'USD',
      runtimePreference: ['local', 'cloud', 'hybrid'],
      privacyPreference: ['local-device', 'provider-managed', 'customer-controlled', 'unknown'],
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
        maximumPathLatencyP95Ms: 2_000,
        maximumEnergyMilliwattHours: '100',
        maximumDevicePressureRatio: '0.9',
        maximumFailureProbability: '0.5',
        maximumFallbackExposureProbability: '0.5',
        maximumPlanNodes: 8,
        requireEvidenceRefs: true
      }
    })
    const route = selectAdaptiveExecutionRoute([proposal], requirements, catalogue, planningPolicy, routingEvidence, routingPolicy)
    const session: SessionWorkloadEvidence = {
      schemaVersion: 1,
      sessionId: 'session/current',
      candidateId: cloud.id,
      usageP95: { request: '1' },
      observedAt: OBSERVED,
      validUntil: VALID_UNTIL,
      evidenceRef: 'session/evidence',
      authorityRevision: 'session/revision'
    }
    const dispatchManifestPayload = {
      schemaVersion: 1 as const,
      routingDecisionId: route.id,
      proposalFingerprint: qualified.proposalFingerprint,
      cloudNodeIds: ['fallback'],
      generatedAt: OBSERVED,
      validUntil: VALID_UNTIL,
      parts: [
        { scope: 'prompt' as const, contentRef: 'content/prompt', byteLength: 1, sha256: 'e'.repeat(64) },
        { scope: 'source' as const, contentRef: 'content/source', byteLength: 1, sha256: 'f'.repeat(64) },
        { scope: 'generated-content' as const, contentRef: 'content/generated', byteLength: 1, sha256: '1'.repeat(64) }
      ]
    }
    const host: AdaptiveExecutionHostAuthority = {
      requirements,
      proposals: [proposal],
      routingEvidence,
      verifyRoutingEvidence: () => true,
      verifyDispatchManifest: () => true,
      verifySessionEvidence: () => true,
      verifyBudgetApprovalGrant: () => true,
      verifyCloudBoundaryApprovalGrant: () => true,
      consumeRouteAuthority: () => true
    }
    const boundary: ExecutionCloudBoundaryContext = {
      dispatchManifest: { ...dispatchManifestPayload, id: stableFingerprint(dispatchManifestPayload) },
      triggerRefs: ['trigger/local-failure'],
      rationaleRefs: ['policy/fallback']
    }
    const authorization = authorizeAdaptiveExecutionRoute(route, session, catalogue, planningPolicy, routingPolicy, { evaluatedAt: EVALUATED, cloudBoundary: boundary }, host)
    expect(route.selectedPlanId).toBe(proposal.id)
    expect(authorization).toMatchObject({ status: 'approval-required', reasonCode: 'cloud-boundary-approval-required', dispatchAuthorized: false })
  })
})
