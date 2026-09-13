import {
  createLocalRemovalConsent,
  createLocalRemovalPreview,
  createLocalSetupConsent,
  createLocalSetupProposal,
  createLocalSetupRecord,
  type LocalRemovalConsent,
  type LocalSetupConsent,
  type LocalSetupOwnedResource,
  type LocalSetupProposal,
  type LocalSetupRecord
} from '../../../execution/local-setup'
import {
  removeLocalSetup,
  resumeLocalSetup,
  type LocalRemovalOperationResult,
  type LocalSetupAdapter,
  type LocalSetupConsentAuthority,
  type LocalSetupOperationResult,
  type LocalSetupStateStore
} from '../../../execution/local-setup-lifecycle'
import { type LocalExecutionProfile } from '../../../execution/local-profiles'

const NOW = '2026-09-13T10:30:00.000Z'
const SHA = 'd'.repeat(64)

function profile(): LocalExecutionProfile {
  return {
    id: 'a'.repeat(64),
    adapterId: 'runtime-adapter',
    sourceId: 'profile-source',
    hostSnapshotId: 'b'.repeat(64),
    policyId: 'c'.repeat(64),
    rank: 1,
    runtime: { runtimeId: 'local-runtime', backend: 'none', optimization: 'portable' },
    artifact: {
      artifactId: 'model-q4',
      modelId: 'model',
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
    evidenceRefs: ['profile:evidence']
  }
}

function proposal(options: { persistence?: 'none' | 'login-start'; scope?: 'loopback' | 'non-loopback' } = {}): LocalSetupProposal {
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
      persistence: options.persistence ?? 'none',
      binding: {
        scope: options.scope ?? 'loopback',
        addressRef: options.scope === 'non-loopback' ? 'interface:lan' : 'loopback',
        port: 11434
      }
    },
    storage: { rootRef: 'sf-store:models', outsideGeneratedRepository: true },
    evidenceRefs: ['catalogue:v1']
  })
}

function consents(setup: LocalSetupProposal, decisions: Partial<Record<string, 'approved' | 'declined'>> = {}): LocalSetupConsent[] {
  return setup.operations
    .filter((operation) => operation.consentScope)
    .map((operation, index) =>
      createLocalSetupConsent(setup, {
        operationId: operation.id,
        decision: decisions[operation.consentScope!] ?? 'approved',
        decidedAt: NOW,
        validUntil: '2026-09-13T11:30:00.000Z',
        actorRef: 'user:owner',
        nonceRef: `event:${index}`
      })
    )
}

class Store implements LocalSetupStateStore {
  current: LocalSetupRecord
  rejectNext = false

  constructor(current: LocalSetupRecord) {
    this.current = current
  }

  compareAndSwap(setupId: string, expectedRevision: number, next: Readonly<LocalSetupRecord>): boolean {
    if (this.rejectNext) {
      this.rejectNext = false
      return false
    }
    if (setupId !== this.current.id || expectedRevision !== this.current.revision) return false
    this.current = next as LocalSetupRecord
    return true
  }
}

class Authority implements LocalSetupConsentAuthority {
  setupCalls: string[] = []
  removalCalls: string[] = []
  accept = true

  consumeSetupConsent(input: { consent: Readonly<LocalSetupConsent> }): boolean {
    this.setupCalls.push(input.consent.id)
    return this.accept
  }

  consumeRemovalConsent(input: { consent: Readonly<LocalRemovalConsent> }): boolean {
    this.removalCalls.push(input.consent.id)
    return this.accept
  }
}

class Adapter implements LocalSetupAdapter {
  readonly id = 'fake-runtime'
  executeCalls: string[] = []
  activateCalls: string[] = []
  removeCalls: string[] = []
  failOnceOn?: string
  wrongDigest = false

  execute(input: { operation: { kind: string } }): LocalSetupOperationResult {
    this.executeCalls.push(input.operation.kind)
    if (this.failOnceOn === input.operation.kind) {
      this.failOnceOn = undefined
      throw new Error('credential=must-not-leak')
    }
    if (input.operation.kind === 'download-model') {
      return {
        status: 'completed',
        stagedArtifact: { ref: 'staging:model', bytes: '100', sha256: this.wrongDigest ? 'e'.repeat(64) : SHA },
        evidenceRefs: ['download:complete']
      }
    }
    const resourceByKind: Record<string, LocalSetupOwnedResource | undefined> = {
      'install-runtime': { kind: 'runtime', ref: 'runtime:local:v1', bytes: '20', shared: true },
      'update-runtime': { kind: 'runtime', ref: 'runtime:local:v1', bytes: '20', shared: true },
      'configure-runtime': { kind: 'configuration', ref: 'config:local:model', bytes: '1', shared: false },
      'enable-login-start': { kind: 'service', ref: 'service:login-start', bytes: '0', shared: false },
      'expose-network': { kind: 'binding', ref: 'binding:lan:11434', bytes: '0', shared: false },
      'start-runtime': { kind: 'service', ref: 'service:runtime', bytes: '0', shared: false }
    }
    return { status: 'completed', resource: resourceByKind[input.operation.kind], evidenceRefs: ['operation:complete'] }
  }

  activateModel(input: { stagedArtifact: { sha256: string } }): LocalSetupOwnedResource {
    this.activateCalls.push(input.stagedArtifact.sha256)
    return { kind: 'model', ref: 'artifact:model:rev-1', bytes: '120', sha256: input.stagedArtifact.sha256, shared: false }
  }

  remove(input: { resource: { ref: string } }): LocalRemovalOperationResult {
    this.removeCalls.push(input.resource.ref)
    return { status: 'removed', evidenceRefs: ['removal:complete'] }
  }
}

describe('local setup lifecycle', () => {
  it('does not call the adapter or write state before the matching consent exists', async () => {
    const setup = proposal()
    const record = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const store = new Store(record)
    const adapter = new Adapter()

    const result = await resumeLocalSetup({
      proposal: setup,
      record,
      consents: [],
      adapter,
      authority: new Authority(),
      store,
      evaluatedAt: NOW
    })

    expect(result).toMatchObject({ status: 'awaiting-consent', pendingConsentScopes: ['runtime-install'] })
    expect(adapter.executeCalls).toEqual([])
    expect(store.current).toBe(record)
  })

  it('persists each operation and resumes without repeating completed work', async () => {
    const setup = proposal()
    const record = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const store = new Store(record)
    const authority = new Authority()
    const adapter = new Adapter()
    const all = consents(setup)

    const partial = await resumeLocalSetup({
      proposal: setup,
      record,
      consents: all.filter((entry) => entry.scope === 'runtime-install'),
      adapter,
      authority,
      store,
      evaluatedAt: NOW
    })
    expect(partial).toMatchObject({ status: 'awaiting-consent', pendingConsentScopes: ['model-download'] })
    expect(adapter.executeCalls).toEqual(['install-runtime'])

    const finished = await resumeLocalSetup({
      proposal: setup,
      record: store.current,
      consents: all,
      adapter,
      authority,
      store,
      evaluatedAt: NOW
    })
    expect(finished.status).toBe('ready')
    expect(finished.record.state).toBe('ready')
    expect(adapter.executeCalls.filter((kind) => kind === 'install-runtime')).toHaveLength(1)
    expect(adapter.activateCalls).toEqual([SHA])
  })

  it('honors independent declines for persistence and exposure while completing the safe setup', async () => {
    const setup = proposal({ persistence: 'login-start', scope: 'non-loopback' })
    const record = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const store = new Store(record)
    const adapter = new Adapter()

    const result = await resumeLocalSetup({
      proposal: setup,
      record,
      consents: consents(setup, {
        'login-start-persistence': 'declined',
        'non-loopback-exposure': 'declined'
      }),
      adapter,
      authority: new Authority(),
      store,
      evaluatedAt: NOW
    })

    expect(result.status).toBe('ready')
    expect(adapter.executeCalls).not.toContain('enable-login-start')
    expect(adapter.executeCalls).not.toContain('expose-network')
    expect(result.record.skippedOperationIds).toHaveLength(2)
  })

  it('blocks activation on digest mismatch and sanitizes adapter failures for resumable retry', async () => {
    const setup = proposal()
    const firstRecord = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const mismatchStore = new Store(firstRecord)
    const mismatchAdapter = new Adapter()
    mismatchAdapter.wrongDigest = true

    const mismatch = await resumeLocalSetup({
      proposal: setup,
      record: firstRecord,
      consents: consents(setup),
      adapter: mismatchAdapter,
      authority: new Authority(),
      store: mismatchStore,
      evaluatedAt: NOW
    })
    expect(mismatch).toMatchObject({ status: 'failed', reasonCode: 'artifact-integrity-mismatch' })
    expect(mismatchAdapter.activateCalls).toEqual([])

    const retryStore = new Store(createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z'))
    const retryAdapter = new Adapter()
    retryAdapter.failOnceOn = 'download-model'
    const approvals = consents(setup)
    const failed = await resumeLocalSetup({
      proposal: setup,
      record: retryStore.current,
      consents: approvals,
      adapter: retryAdapter,
      authority: new Authority(),
      store: retryStore,
      evaluatedAt: NOW
    })
    expect(failed).toMatchObject({ status: 'failed', reasonCode: 'adapter-operation-failed' })
    expect(JSON.stringify(failed)).not.toContain('must-not-leak')

    const resumed = await resumeLocalSetup({
      proposal: setup,
      record: retryStore.current,
      consents: approvals,
      adapter: retryAdapter,
      authority: new Authority(),
      store: retryStore,
      evaluatedAt: NOW
    })
    expect(resumed.status).toBe('ready')
    expect(retryAdapter.executeCalls.filter((kind) => kind === 'install-runtime')).toHaveLength(1)
  })

  it('rejects concurrent record updates instead of running past a lost compare-and-swap', async () => {
    const setup = proposal()
    const record = createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z')
    const store = new Store(record)
    store.rejectNext = true

    await expect(
      resumeLocalSetup({
        proposal: setup,
        record,
        consents: consents(setup),
        adapter: new Adapter(),
        authority: new Authority(),
        store,
        evaluatedAt: NOW
      })
    ).rejects.toThrow(/setup-revision-conflict/)
  })

  it('removes only approved owned resources and rejects stale previews before side effects', async () => {
    const setup = proposal()
    const store = new Store(createLocalSetupRecord(setup, '2026-09-13T10:05:00.000Z'))
    const authority = new Authority()
    const adapter = new Adapter()
    const ready = await resumeLocalSetup({
      proposal: setup,
      record: store.current,
      consents: consents(setup),
      adapter,
      authority,
      store,
      evaluatedAt: NOW
    })
    const preview = createLocalRemovalPreview(ready.record, {
      generatedAt: '2026-09-13T10:40:00.000Z',
      validUntil: '2026-09-13T11:40:00.000Z',
      evidenceRefs: ['setup:owned-resources']
    })
    const consent = createLocalRemovalConsent(preview, {
      decision: 'approved',
      decidedAt: '2026-09-13T10:45:00.000Z',
      validUntil: '2026-09-13T11:30:00.000Z',
      actorRef: 'user:owner',
      nonceRef: 'event:remove'
    })

    const removed = await removeLocalSetup({
      proposal: setup,
      record: ready.record,
      preview,
      consent,
      adapter,
      authority,
      store,
      evaluatedAt: '2026-09-13T10:50:00.000Z'
    })
    expect(removed.status).toBe('removed')
    expect(removed.record.state).toBe('removed')
    expect(adapter.removeCalls).not.toContain('runtime:local:v1')
    expect(adapter.removeCalls).toEqual(expect.arrayContaining(['service:runtime', 'config:local:model', 'artifact:model:rev-1']))

    const staleAdapter = new Adapter()
    const stale = await removeLocalSetup({
      proposal: setup,
      record: { ...ready.record, revision: ready.record.revision + 1 },
      preview,
      consent,
      adapter: staleAdapter,
      authority,
      store,
      evaluatedAt: '2026-09-13T10:50:00.000Z'
    })
    expect(stale).toMatchObject({ status: 'paused', reasonCode: 'invalid-removal-consent' })
    expect(staleAdapter.removeCalls).toEqual([])
  })
})
