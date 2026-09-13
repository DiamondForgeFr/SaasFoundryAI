import {
  createLocalRemovalConsent,
  createLocalRemovalPreview,
  createLocalSetupConsent,
  createLocalSetupProposal,
  createLocalSetupRecord,
  removeLocalSetup,
  resumeLocalSetup,
  type LocalExecutionProfile,
  type LocalRemovalOperationResult,
  type LocalSetupAdapter,
  type LocalSetupConsent,
  type LocalSetupConsentAuthority,
  type LocalSetupOperation,
  type LocalSetupOperationResult,
  type LocalSetupOwnedResource,
  type LocalSetupProposal,
  type LocalSetupRecord,
  type LocalSetupStateStore
} from '../../../execution'

const SHA = 'd'.repeat(64)
const EVALUATED_AT = '2026-09-13T10:30:00.000Z'

function profile(): LocalExecutionProfile {
  return {
    id: 'a'.repeat(64),
    adapterId: 'portable-runtime-adapter',
    sourceId: 'catalogue-profile',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: { runtimeId: 'portable-runtime', backend: 'none', optimization: 'portable' },
    artifact: {
      artifactId: 'coder-model-q4',
      modelId: 'coder-model',
      format: 'gguf',
      quantization: 'q4',
      revision: 'rev-1',
      sha256: SHA
    },
    configuration: { contextTokens: 8192, maxOutputTokens: 2048, concurrency: 1 },
    resources: {
      artifactDownloadBytes: '100',
      installedDiskBytes: '120',
      systemMemoryBytes: '80',
      acceleratorMemoryBytes: '0',
      memoryPool: 'system',
      requiredDiskWithHeadroomBytes: '200',
      requiredSystemMemoryWithHeadroomBytes: '160',
      requiredAcceleratorMemoryWithHeadroomBytes: '0'
    },
    performance: { estimatedLatencyP95Ms: 1000, estimatedTokensPerSecond: '10' },
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
    tradeoffCodes: ['bounded-concurrency', 'bounded-context', 'cpu-system-memory', 'estimated-latency', 'portable-runtime'],
    evidenceRefs: ['catalogue:profile:rev-1']
  }
}

function proposal(): LocalSetupProposal {
  return createLocalSetupProposal({
    profile: profile(),
    generatedAt: '2026-09-13T10:00:00.000Z',
    validUntil: '2026-09-13T12:00:00.000Z',
    runtime: {
      sourceRef: 'catalogue:runtime',
      sourceRevision: 'v1',
      licenseRef: 'license:mit',
      installSizeBytes: '20',
      networkActivity: 'download'
    },
    model: {
      sourceRef: 'catalogue:model',
      sourceRevision: 'rev-1',
      licenseRef: 'license:apache-2',
      networkActivity: 'download'
    },
    service: {
      persistence: 'login-start',
      binding: { scope: 'non-loopback', addressRef: 'interface:lan', port: 11434 }
    },
    storage: { rootRef: 'sf-store:models', outsideGeneratedRepository: true },
    evidenceRefs: ['catalogue:local:v1']
  })
}

class Store implements LocalSetupStateStore {
  current: LocalSetupRecord

  constructor(current: LocalSetupRecord) {
    this.current = current
  }

  compareAndSwap(setupId: string, expectedRevision: number, next: Readonly<LocalSetupRecord>): boolean {
    if (setupId !== this.current.id || expectedRevision !== this.current.revision) return false
    this.current = next as LocalSetupRecord
    return true
  }
}

class Authority implements LocalSetupConsentAuthority {
  consumeSetupConsent(): boolean {
    return true
  }

  consumeRemovalConsent(): boolean {
    return true
  }
}

class Adapter implements LocalSetupAdapter {
  readonly id = 'portable-runtime-adapter'
  readonly executed: string[] = []
  readonly removed: string[] = []

  execute(input: { operation: Readonly<LocalSetupOperation> }): LocalSetupOperationResult {
    this.executed.push(input.operation.kind)
    if (input.operation.kind === 'download-model') {
      return {
        status: 'completed',
        stagedArtifact: { ref: 'staging:model', bytes: '100', sha256: SHA },
        evidenceRefs: ['download:verified']
      }
    }
    const resources: Partial<Record<LocalSetupOperation['kind'], LocalSetupOwnedResource>> = {
      'install-runtime': { kind: 'runtime', ref: 'runtime:portable:v1', bytes: '20', shared: true },
      'configure-runtime': { kind: 'configuration', ref: 'config:portable:model', bytes: '1', shared: false },
      'start-runtime': { kind: 'service', ref: 'service:portable', bytes: '0', shared: false }
    }
    return { status: 'completed', resource: resources[input.operation.kind], evidenceRefs: ['operation:complete'] }
  }

  activateModel(input: { stagedArtifact: Readonly<{ sha256: string }> }): LocalSetupOwnedResource {
    return { kind: 'model', ref: 'artifact:model:rev-1', bytes: '120', sha256: input.stagedArtifact.sha256, shared: false }
  }

  remove(input: { resource: Readonly<LocalSetupOwnedResource> }): LocalRemovalOperationResult {
    this.removed.push(input.resource.ref)
    return { status: 'removed', evidenceRefs: ['removal:complete'] }
  }
}

function consent(setup: LocalSetupProposal, scope: NonNullable<LocalSetupOperation['consentScope']>, decision: 'approved' | 'declined'): LocalSetupConsent {
  const operation = setup.operations.find((entry) => entry.consentScope === scope)!
  return createLocalSetupConsent(setup, {
    operationId: operation.id,
    decision,
    decidedAt: EVALUATED_AT,
    validUntil: '2026-09-13T11:30:00.000Z',
    actorRef: 'user:owner',
    nonceRef: `decision:${scope}`
  })
}

describe('local setup public lifecycle (#749)', () => {
  it('resumes after partial consent, applies safer optional decisions, and removes only owned resources', async () => {
    const setup = proposal()
    const initial = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const store = new Store(initial)
    const authority = new Authority()
    const adapter = new Adapter()

    const partial = await resumeLocalSetup({
      proposal: setup,
      record: initial,
      consents: [consent(setup, 'runtime-install', 'approved')],
      adapter,
      authority,
      store,
      evaluatedAt: EVALUATED_AT
    })

    expect(partial).toMatchObject({ status: 'awaiting-consent', pendingConsentScopes: ['model-download'] })
    expect(adapter.executed).toEqual(['install-runtime'])

    const ready = await resumeLocalSetup({
      proposal: setup,
      record: store.current,
      consents: [
        consent(setup, 'runtime-install', 'approved'),
        consent(setup, 'model-download', 'approved'),
        consent(setup, 'login-start-persistence', 'declined'),
        consent(setup, 'non-loopback-exposure', 'declined')
      ],
      adapter,
      authority,
      store,
      evaluatedAt: '2026-09-13T10:35:00.000Z'
    })

    expect(ready.status).toBe('ready')
    expect(adapter.executed).toEqual(['install-runtime', 'download-model', 'configure-runtime', 'start-runtime'])
    expect(ready.record.skippedOperationIds).toHaveLength(2)
    expect(ready.record.resources.map((resource) => resource.ref)).toEqual(['artifact:model:rev-1', 'config:portable:model', 'runtime:portable:v1', 'service:portable'])

    const preview = createLocalRemovalPreview(ready.record, {
      generatedAt: '2026-09-13T10:40:00.000Z',
      validUntil: '2026-09-13T11:40:00.000Z',
      evidenceRefs: ['setup:inventory']
    })
    const removalConsent = createLocalRemovalConsent(preview, {
      decision: 'approved',
      decidedAt: '2026-09-13T10:45:00.000Z',
      validUntil: '2026-09-13T11:30:00.000Z',
      actorRef: 'user:owner',
      nonceRef: 'decision:remove'
    })
    const removed = await removeLocalSetup({
      proposal: setup,
      record: ready.record,
      preview,
      consent: removalConsent,
      adapter,
      authority,
      store,
      evaluatedAt: '2026-09-13T11:00:00.000Z'
    })

    expect(removed.status).toBe('removed')
    expect(adapter.removed).toEqual(['service:portable', 'config:portable:model', 'artifact:model:rev-1'])
    expect(adapter.removed).not.toContain('runtime:portable:v1')
    expect(removed.record.removedResourceRefs).toEqual(adapter.removed)
  })
})
