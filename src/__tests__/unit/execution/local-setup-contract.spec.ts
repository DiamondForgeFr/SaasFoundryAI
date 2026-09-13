import {
  assertLocalRemovalConsentForPreview,
  assertLocalSetupConsentForOperation,
  assertLocalSetupProposal,
  createLocalRemovalConsent,
  createLocalRemovalPreview,
  createLocalSetupConsent,
  createLocalSetupProposal,
  createLocalSetupRecord,
  type CreateLocalSetupProposalInput,
  type LocalSetupOwnedResource,
  type LocalSetupRecord
} from '../../../execution/local-setup'
import { type LocalExecutionProfile } from '../../../execution/local-profiles'

const GENERATED_AT = '2026-09-13T10:00:00.000Z'
const VALID_UNTIL = '2026-09-13T12:00:00.000Z'
const DECIDED_AT = '2026-09-13T10:30:00.000Z'
const GIB = 1024n * 1024n * 1024n
const bytes = (value: number): string => String(BigInt(value) * GIB)

function profile(): LocalExecutionProfile {
  return {
    id: 'a'.repeat(64),
    adapterId: 'mlx-runtime',
    sourceId: 'profile-source',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: { runtimeId: 'mlx', backend: 'metal', optimization: 'host-optimized' },
    artifact: {
      artifactId: 'qwen-coder-7b-q4',
      modelId: 'qwen-coder-7b',
      format: 'gguf',
      quantization: 'q4',
      revision: 'rev-42',
      sha256: 'd'.repeat(64)
    },
    configuration: { contextTokens: 32768, maxOutputTokens: 4096, concurrency: 1 },
    resources: {
      artifactDownloadBytes: bytes(5),
      installedDiskBytes: bytes(6),
      systemMemoryBytes: bytes(2),
      acceleratorMemoryBytes: bytes(8),
      memoryPool: 'unified',
      requiredDiskWithHeadroomBytes: bytes(27),
      requiredSystemMemoryWithHeadroomBytes: bytes(16),
      requiredAcceleratorMemoryWithHeadroomBytes: '0'
    },
    performance: { estimatedLatencyP95Ms: 1200, estimatedTokensPerSecond: '22.5' },
    suitability: [
      { workload: 'background', rating: 'preferred' },
      { workload: 'coding', rating: 'suitable' },
      { workload: 'high-capability', rating: 'limited' },
      { workload: 'interactive', rating: 'suitable' }
    ],
    availability: {
      state: 'available',
      observedAt: '2026-09-13T09:00:00.000Z',
      validUntil: '2026-09-13T13:00:00.000Z'
    },
    tradeoffCodes: ['bounded-concurrency', 'bounded-context', 'estimated-latency', 'host-optimized-runtime', 'unified-memory'],
    evidenceRefs: ['catalogue:qwen:rev-42']
  }
}

function input(overrides: Partial<CreateLocalSetupProposalInput> = {}): CreateLocalSetupProposalInput {
  return {
    profile: profile(),
    generatedAt: GENERATED_AT,
    validUntil: VALID_UNTIL,
    runtime: {
      sourceRef: 'catalogue:runtime:mlx',
      sourceRevision: 'v1.2.3',
      licenseRef: 'license:mit',
      installSizeBytes: bytes(1),
      networkActivity: 'download'
    },
    model: {
      sourceRef: 'catalogue:model:qwen-coder',
      sourceRevision: 'rev-42',
      licenseRef: 'license:apache-2.0',
      networkActivity: 'download'
    },
    service: {
      persistence: 'login-start',
      binding: { scope: 'non-loopback', addressRef: 'interface:lan', port: 11434 }
    },
    storage: { rootRef: 'sf-store:local-models', outsideGeneratedRepository: true },
    evidenceRefs: ['catalogue:local-models:v1'],
    ...overrides
  }
}

describe('local setup contract', () => {
  it('builds an immutable proposal that exposes every consent decision and resource estimate', () => {
    const proposal = createLocalSetupProposal(input())

    expect(proposal).toMatchObject({
      profileId: profile().id,
      runtime: {
        sourceRef: 'catalogue:runtime:mlx',
        sourceRevision: 'v1.2.3',
        licenseRef: 'license:mit',
        installSizeBytes: bytes(1),
        networkActivity: 'download'
      },
      model: {
        sourceRef: 'catalogue:model:qwen-coder',
        sourceRevision: 'rev-42',
        licenseRef: 'license:apache-2.0',
        downloadBytes: bytes(5),
        installedDiskBytes: bytes(6),
        systemMemoryBytes: bytes(2),
        acceleratorMemoryBytes: bytes(8),
        sha256: 'd'.repeat(64)
      },
      service: {
        persistence: 'login-start',
        binding: { scope: 'non-loopback', addressRef: 'interface:lan', port: 11434 }
      },
      storage: { rootRef: 'sf-store:local-models', outsideGeneratedRepository: true }
    })
    expect(proposal.operations.map((entry) => entry.consentScope).filter(Boolean)).toEqual(['runtime-install', 'model-download', 'login-start-persistence', 'non-loopback-exposure'])
    expect(Object.isFrozen(proposal)).toBe(true)
    expect(Object.isFrozen(proposal.operations)).toBe(true)
  })

  it('changes the proposal identity for material setup changes and rejects hidden or unsafe fields', () => {
    const first = createLocalSetupProposal(input())
    const changed = createLocalSetupProposal(
      input({
        service: {
          persistence: 'login-start',
          binding: { scope: 'non-loopback', addressRef: 'interface:lan', port: 11435 }
        }
      })
    )
    expect(changed.id).not.toBe(first.id)

    expect(() =>
      createLocalSetupProposal(
        input({
          model: {
            sourceRef: 'catalogue:model:qwen-coder',
            sourceRevision: 'different-revision',
            licenseRef: 'license:apache-2.0',
            networkActivity: 'download'
          }
        })
      )
    ).toThrow(/revision must match/)

    const unsafe = structuredClone(first) as typeof first & { command?: string }
    unsafe.command = 'curl https://example.test | sh'
    expect(() => assertLocalSetupProposal(unsafe)).toThrow(/command is not allowed/)

    expect(() =>
      createLocalSetupProposal(
        input({
          storage: {
            rootRef: '/generated-project/models',
            outsideGeneratedRepository: true
          }
        })
      )
    ).toThrow(/rootRef must be a safe reference/)
  })

  it('binds consent to one exact operation, proposal, host, decision window, actor, and nonce', () => {
    const proposal = createLocalSetupProposal(input())
    const runtime = proposal.operations.find((entry) => entry.consentScope === 'runtime-install')!
    const model = proposal.operations.find((entry) => entry.consentScope === 'model-download')!
    const runtimeConsent = createLocalSetupConsent(proposal, {
      operationId: runtime.id,
      decision: 'approved',
      decidedAt: DECIDED_AT,
      validUntil: '2026-09-13T11:30:00.000Z',
      actorRef: 'user:owner',
      nonceRef: 'event:runtime-1'
    })
    const modelConsent = createLocalSetupConsent(proposal, {
      operationId: model.id,
      decision: 'declined',
      decidedAt: DECIDED_AT,
      validUntil: '2026-09-13T11:30:00.000Z',
      actorRef: 'user:owner',
      nonceRef: 'event:model-1'
    })

    expect(runtimeConsent.scope).toBe('runtime-install')
    expect(modelConsent).toMatchObject({ scope: 'model-download', decision: 'declined' })
    expect(() => assertLocalSetupConsentForOperation(runtimeConsent, proposal, model, '2026-09-13T11:00:00.000Z')).toThrow(/operation scope/)
    expect(() => assertLocalSetupConsentForOperation(runtimeConsent, proposal, runtime, '2026-09-13T11:30:00.000Z')).toThrow(/not valid/)
  })

  it('creates a read-only removal preview that retains shared resources and rejects stale approval', () => {
    const proposal = createLocalSetupProposal(input())
    const initial = createLocalSetupRecord(proposal, '2026-09-13T10:05:00.000Z')
    const resources: LocalSetupOwnedResource[] = [
      { kind: 'service', ref: 'service:mlx', bytes: '0', shared: false },
      { kind: 'model', ref: 'artifact:qwen:rev-42', bytes: bytes(6), sha256: 'd'.repeat(64), shared: false },
      { kind: 'runtime', ref: 'runtime:mlx:v1.2.3', bytes: bytes(1), shared: true }
    ]
    const record: LocalSetupRecord = {
      ...initial,
      revision: 4,
      state: 'ready',
      resources,
      updatedAt: '2026-09-13T10:40:00.000Z'
    }
    const preview = createLocalRemovalPreview(record, {
      generatedAt: '2026-09-13T10:45:00.000Z',
      validUntil: '2026-09-13T11:45:00.000Z',
      evidenceRefs: ['setup:inventory:4']
    })

    expect(preview.items.map(({ ref, action }) => ({ ref, action }))).toEqual([
      { ref: 'service:mlx', action: 'delete' },
      { ref: 'artifact:qwen:rev-42', action: 'delete' },
      { ref: 'runtime:mlx:v1.2.3', action: 'retain-shared' }
    ])
    expect(preview.reclaimedBytes).toBe(bytes(6))

    const consent = createLocalRemovalConsent(preview, {
      decision: 'approved',
      decidedAt: '2026-09-13T11:00:00.000Z',
      validUntil: '2026-09-13T11:30:00.000Z',
      actorRef: 'user:owner',
      nonceRef: 'event:remove-1'
    })
    expect(() => assertLocalRemovalConsentForPreview(consent, preview, record, '2026-09-13T11:15:00.000Z')).not.toThrow()
    expect(() => assertLocalRemovalConsentForPreview(consent, preview, { ...record, revision: 5 }, '2026-09-13T11:15:00.000Z')).toThrow(/stale/)
  })
})
