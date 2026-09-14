import {
  createLocalBenchmarkPlan,
  createLocalBenchmarkSuite,
  createLocalQualificationPolicy,
  createLocalSetupProposal,
  createLocalSetupRecord,
  localExecutionProfileId,
  qualifyLocalBenchmark,
  resolveLocalBenchmarkCurrentState,
  runLocalBenchmark,
  type LocalBenchmarkAdapter,
  type LocalExecutionProfile,
  type LocalExecutionProfileCandidate
} from '../../../execution'

function profile(): LocalExecutionProfile {
  const candidate: LocalExecutionProfileCandidate = {
    schemaVersion: 1,
    runtime: { runtimeId: 'portable-runtime', backend: 'none', optimization: 'portable' },
    artifact: { artifactId: 'coder-q4', modelId: 'coder', format: 'gguf', quantization: 'q4', revision: 'r1', sha256: 'a'.repeat(64) },
    configuration: { contextTokens: 8192, maxOutputTokens: 2048, concurrency: 1 },
    resources: {
      artifactDownloadBytes: '100',
      installedDiskBytes: '120',
      systemMemoryBytes: '80',
      acceleratorMemoryBytes: '0',
      memoryPool: 'system'
    },
    performance: { estimatedLatencyP95Ms: 1000, estimatedTokensPerSecond: '10' },
    suitability: [
      { workload: 'background', rating: 'preferred' },
      { workload: 'coding', rating: 'suitable' },
      { workload: 'high-capability', rating: 'limited' },
      { workload: 'interactive', rating: 'suitable' }
    ],
    availability: { state: 'available', observedAt: '2026-09-13T09:00:00.000Z', validUntil: '2026-09-13T13:00:00.000Z' },
    evidenceRefs: ['catalogue:coder:r1']
  }
  return {
    id: localExecutionProfileId(candidate),
    adapterId: 'catalogue-adapter',
    sourceId: 'coder-profile',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: candidate.runtime,
    artifact: candidate.artifact,
    configuration: candidate.configuration,
    resources: {
      ...candidate.resources,
      requiredDiskWithHeadroomBytes: '200',
      requiredSystemMemoryWithHeadroomBytes: '160',
      requiredAcceleratorMemoryWithHeadroomBytes: '0'
    },
    performance: candidate.performance,
    suitability: candidate.suitability,
    availability: candidate.availability,
    tradeoffCodes: ['bounded-concurrency', 'bounded-context', 'cpu-system-memory', 'estimated-latency', 'portable-runtime'],
    evidenceRefs: candidate.evidenceRefs
  }
}

describe('local benchmark and qualification public pipeline (#753)', () => {
  it('qualifies an installed profile for only the task classes backed by current deterministic evidence', async () => {
    const selected = profile()
    const proposal = createLocalSetupProposal({
      profile: selected,
      generatedAt: '2026-09-13T10:00:00.000Z',
      validUntil: '2026-09-13T12:00:00.000Z',
      runtime: {
        sourceRef: 'catalogue:runtime:portable',
        sourceRevision: 'v1',
        licenseRef: 'license:mit',
        installSizeBytes: '20',
        networkActivity: 'download'
      },
      model: { sourceRef: 'catalogue:model:coder', sourceRevision: 'r1', licenseRef: 'license:apache-2', networkActivity: 'download' },
      service: { binding: { scope: 'loopback', addressRef: 'interface:loopback', port: 11434 } },
      storage: { rootRef: 'sf-store:models', outsideGeneratedRepository: true },
      evidenceRefs: ['catalogue:local:v1']
    })
    const initial = createLocalSetupRecord(proposal, '2026-09-13T10:05:00.000Z')
    const ready = {
      ...initial,
      revision: 4,
      state: 'ready' as const,
      resources: [
        { kind: 'runtime' as const, ref: 'runtime:portable:v1', bytes: '20', shared: true },
        { kind: 'model' as const, ref: 'artifact:coder:r1', bytes: '120', sha256: selected.artifact.sha256, shared: false }
      ],
      updatedAt: '2026-09-13T10:20:00.000Z'
    }
    const suite = createLocalBenchmarkSuite({
      version: 'benchmark-v1',
      corpusSha256: 'd'.repeat(64),
      validatorVersion: 'validator-v1',
      tasks: [{ id: 'synthetic:mechanical-json', taskClass: 'mechanical', contextTokens: 1024, maxOutputTokens: 256, requiredChecks: ['structured-output'] }],
      evidenceRefs: ['benchmark-corpus:v1']
    })
    const plan = createLocalBenchmarkPlan({
      profile: selected,
      proposal,
      record: ready,
      suite,
      adapterId: 'portable-adapter-v1',
      validatorId: 'host-validator-v1',
      generatedAt: '2026-09-13T10:25:00.000Z',
      validUntil: '2026-09-13T11:25:00.000Z',
      iterations: 2,
      warmupIterations: 1,
      timeoutMs: 30_000,
      maximumTotalDurationMs: 120_000,
      evidenceRefs: ['benchmark-request:1']
    })
    let clock = Date.parse('2026-09-13T10:30:00.000Z')
    const adapter: LocalBenchmarkAdapter = {
      id: plan.adapterId,
      run: () => {
        const startedAt = new Date(clock).toISOString()
        clock += 100
        const finishedAt = new Date(clock).toISOString()
        clock += 100
        return {
          status: 'completed',
          startedAt,
          finishedAt,
          metrics: {
            startupMs: 100,
            firstTokenLatencyMs: 300,
            throughputTokensPerSecond: '12',
            stableContextTokens: 4096,
            peakSystemMemoryBytes: '80',
            peakAcceleratorMemoryBytes: '0',
            sustainedThroughputRatio: '0.9',
            thermalState: 'unknown'
          },
          evidenceRefs: ['metrics:synthetic']
        }
      }
    }
    const validator = {
      id: plan.validatorId,
      validate: () => ({ checks: [{ kind: 'structured-output' as const, status: 'passed' as const, evidenceRef: 'validator:json-schema' }], evidenceRefs: ['validator:run'] })
    }
    const evidence = await runLocalBenchmark({
      plan,
      profile: selected,
      proposal,
      record: ready,
      suite,
      adapter,
      validator,
      authority: { claimBenchmark: () => true, appendEvidence: (value) => ({ status: 'accepted', evidenceId: value.id }) },
      evaluatedAt: '2026-09-13T10:29:00.000Z'
    })
    const qualificationPolicy = createLocalQualificationPolicy({
      version: 'qualification-v1',
      evaluatorVersion: 'evaluator-v1',
      generatedAt: '2026-09-13T10:00:00.000Z',
      validUntil: '2026-09-13T12:00:00.000Z',
      thresholds: [
        {
          taskClass: 'mechanical',
          minimumCompletedSamples: 2,
          maximumFailureRatio: '0',
          maximumStartupP95Ms: 100,
          maximumFirstTokenLatencyP95Ms: 300,
          minimumThroughputMedianTokensPerSecond: '12',
          minimumStableContextTokens: 4096,
          maximumPeakSystemMemoryBytes: '80',
          maximumPeakAcceleratorMemoryBytes: '0',
          minimumSustainedThroughputRatio: '0.9',
          rejectThermalDegradation: true,
          requiredChecks: ['structured-output']
        },
        {
          taskClass: 'implementation',
          minimumCompletedSamples: 2,
          maximumFailureRatio: '0',
          maximumStartupP95Ms: 100,
          maximumFirstTokenLatencyP95Ms: 300,
          minimumThroughputMedianTokensPerSecond: '12',
          minimumStableContextTokens: 4096,
          maximumPeakSystemMemoryBytes: '80',
          maximumPeakAcceleratorMemoryBytes: '0',
          minimumSustainedThroughputRatio: '0.9',
          rejectThermalDegradation: true,
          requiredChecks: ['structured-output']
        }
      ],
      evidenceRefs: ['qualification-policy:v1']
    })
    const currentState = resolveLocalBenchmarkCurrentState({ profile: selected, proposal, record: ready, suite, adapterId: adapter.id, validatorId: validator.id })
    const qualification = qualifyLocalBenchmark({
      plan,
      evidence,
      suite,
      policy: qualificationPolicy,
      currentState,
      currentQualificationPolicyId: qualificationPolicy.id,
      evaluatedAt: '2026-09-13T10:40:00.000Z'
    })

    expect(qualification.decisions.find((decision) => decision.taskClass === 'mechanical')).toMatchObject({ status: 'qualified', completedSamples: 2 })
    expect(qualification.decisions.find((decision) => decision.taskClass === 'implementation')).toMatchObject({
      status: 'inconclusive',
      reasonCodes: expect.arrayContaining(['no-task-evidence'])
    })
    expect(qualification).not.toHaveProperty('candidate')
    expect(qualification).not.toHaveProperty('route')
  })
})
