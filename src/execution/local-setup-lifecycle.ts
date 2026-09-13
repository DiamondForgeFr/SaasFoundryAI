import {
  assertLocalRemovalConsentForPreview,
  assertLocalRemovalPreview,
  assertLocalSetupConsentForOperation,
  assertLocalSetupProposal,
  assertLocalSetupRecord,
  type LocalRemovalConsent,
  type LocalRemovalPreview,
  type LocalSetupConsent,
  type LocalSetupConsentScope,
  type LocalSetupOperation,
  type LocalSetupOwnedResource,
  type LocalSetupProposal,
  type LocalSetupRecord
} from './local-setup'
import { stableFingerprint } from './overrides'

const COMPONENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/
const MAX_BYTES = 2n ** 64n - 1n
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i

export interface LocalSetupStagedArtifact {
  ref: string
  bytes: string
  sha256: string
}

export interface LocalSetupOperationResult {
  status: 'completed' | 'blocked'
  resource?: LocalSetupOwnedResource
  stagedArtifact?: LocalSetupStagedArtifact
  reasonCode?: string
  evidenceRefs: string[]
}

export interface LocalRemovalOperationResult {
  status: 'removed' | 'already-absent' | 'blocked'
  reasonCode?: string
  evidenceRefs: string[]
}

export interface LocalSetupAdapter {
  readonly id: string
  execute(input: {
    proposal: Readonly<LocalSetupProposal>
    operation: Readonly<LocalSetupOperation>
    setupId: string
    idempotencyKey: string
  }): Promise<LocalSetupOperationResult> | LocalSetupOperationResult
  activateModel(input: {
    proposal: Readonly<LocalSetupProposal>
    operation: Readonly<LocalSetupOperation>
    setupId: string
    idempotencyKey: string
    stagedArtifact: Readonly<LocalSetupStagedArtifact>
  }): Promise<LocalSetupOwnedResource> | LocalSetupOwnedResource
  remove(input: {
    proposal: Readonly<LocalSetupProposal>
    preview: Readonly<LocalRemovalPreview>
    resource: Readonly<LocalSetupOwnedResource>
    setupId: string
    idempotencyKey: string
  }): Promise<LocalRemovalOperationResult> | LocalRemovalOperationResult
}

export interface LocalSetupConsentAuthority {
  /**
   * Atomically records the exact decision. Repeated calls with the same setup,
   * operation, and consent ID must be idempotent and return the original result.
   */
  consumeSetupConsent(input: { consent: Readonly<LocalSetupConsent>; setupId: string; operationId: string }): Promise<boolean> | boolean
  /** Same idempotency contract as setup consent, bound to one removal preview. */
  consumeRemovalConsent(input: { consent: Readonly<LocalRemovalConsent>; setupId: string; previewId: string }): Promise<boolean> | boolean
}

export interface LocalSetupStateStore {
  /**
   * Persists only when the stored revision equals expectedRevision. Implementations
   * own durable storage and locking outside the generated application repository.
   */
  compareAndSwap(setupId: string, expectedRevision: number, next: Readonly<LocalSetupRecord>): Promise<boolean> | boolean
}

export type LocalSetupRunStatus = 'awaiting-consent' | 'paused' | 'ready' | 'failed' | 'removed'

export interface LocalSetupRunResult {
  status: LocalSetupRunStatus
  record: LocalSetupRecord
  pendingConsentScopes: LocalSetupConsentScope[]
  reasonCode?: string
}

export interface ResumeLocalSetupInput {
  proposal: LocalSetupProposal
  record: LocalSetupRecord
  consents: readonly LocalSetupConsent[]
  adapter: LocalSetupAdapter
  authority: LocalSetupConsentAuthority
  store: LocalSetupStateStore
  evaluatedAt: string
}

export interface RemoveLocalSetupInput {
  proposal: LocalSetupProposal
  record: LocalSetupRecord
  preview: LocalRemovalPreview
  consent: LocalRemovalConsent
  adapter: LocalSetupAdapter
  authority: LocalSetupConsentAuthority
  store: LocalSetupStateStore
  evaluatedAt: string
}

export class LocalSetupLifecycleError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Local setup lifecycle failed: ${code}`)
    this.name = 'LocalSetupLifecycleError'
    this.code = code
  }
}

function safeComponent(value: unknown): value is string {
  return typeof value === 'string' && COMPONENT.test(value) && !SECRET_LIKE.test(value)
}

function safeReference(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE.test(value) && !SECRET_LIKE.test(value) && !value.startsWith('/') && !/^[a-z]:\//i.test(value) && !value.includes('://') && !value.includes('..')
}

function byteString(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value) || value.length > 20) return false
  try {
    return BigInt(value) <= MAX_BYTES
  } catch {
    return false
  }
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) freeze(entry)
    Object.freeze(value)
  }
  return value
}

function validateResource(value: unknown): asserts value is LocalSetupOwnedResource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LocalSetupLifecycleError('invalid-adapter-resource')
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((field) => !['kind', 'ref', 'bytes', 'sha256', 'shared'].includes(field))) throw new LocalSetupLifecycleError('invalid-adapter-resource')
  if (!['runtime', 'model', 'configuration', 'service', 'binding'].includes(String(candidate.kind))) throw new LocalSetupLifecycleError('invalid-adapter-resource')
  if (!safeReference(candidate.ref) || !byteString(candidate.bytes) || typeof candidate.shared !== 'boolean') throw new LocalSetupLifecycleError('invalid-adapter-resource')
  if (candidate.sha256 !== undefined && !FINGERPRINT.test(String(candidate.sha256))) throw new LocalSetupLifecycleError('invalid-adapter-resource')
}

function validateEvidence(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(safeReference) && new Set(value).size === value.length
}

function validateExecutionResult(value: unknown): asserts value is LocalSetupOperationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LocalSetupLifecycleError('invalid-adapter-result')
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((field) => !['status', 'resource', 'stagedArtifact', 'reasonCode', 'evidenceRefs'].includes(field))) throw new LocalSetupLifecycleError('invalid-adapter-result')
  if (!['completed', 'blocked'].includes(String(candidate.status)) || !validateEvidence(candidate.evidenceRefs)) throw new LocalSetupLifecycleError('invalid-adapter-result')
  if (candidate.status === 'blocked' && !safeComponent(candidate.reasonCode)) throw new LocalSetupLifecycleError('invalid-adapter-result')
  if (candidate.status === 'completed' && candidate.reasonCode !== undefined) throw new LocalSetupLifecycleError('invalid-adapter-result')
  if (candidate.resource !== undefined) validateResource(candidate.resource)
  if (candidate.stagedArtifact !== undefined) {
    const staged = candidate.stagedArtifact as Record<string, unknown>
    if (
      staged === null ||
      typeof staged !== 'object' ||
      Array.isArray(staged) ||
      Object.keys(staged).some((field) => !['ref', 'bytes', 'sha256'].includes(field)) ||
      !safeReference(staged.ref) ||
      !byteString(staged.bytes) ||
      !FINGERPRINT.test(String(staged.sha256))
    )
      throw new LocalSetupLifecycleError('invalid-staged-artifact')
  }
  if (candidate.resource !== undefined && candidate.stagedArtifact !== undefined) throw new LocalSetupLifecycleError('ambiguous-adapter-result')
}

function validateRemovalResult(value: unknown): asserts value is LocalRemovalOperationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LocalSetupLifecycleError('invalid-removal-result')
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((field) => !['status', 'reasonCode', 'evidenceRefs'].includes(field))) throw new LocalSetupLifecycleError('invalid-removal-result')
  if (!['removed', 'already-absent', 'blocked'].includes(String(candidate.status)) || !validateEvidence(candidate.evidenceRefs)) throw new LocalSetupLifecycleError('invalid-removal-result')
  if (candidate.status === 'blocked' && !safeComponent(candidate.reasonCode)) throw new LocalSetupLifecycleError('invalid-removal-result')
  if (candidate.status !== 'blocked' && candidate.reasonCode !== undefined) throw new LocalSetupLifecycleError('invalid-removal-result')
}

function unique<T>(value: readonly T[]): T[] {
  return [...new Set(value)]
}

function nextRecord(
  current: LocalSetupRecord,
  updatedAt: string,
  patch: Partial<Pick<LocalSetupRecord, 'state' | 'completedOperationIds' | 'skippedOperationIds' | 'consentIds' | 'resources' | 'removedResourceRefs' | 'lastErrorCode'>>
): LocalSetupRecord {
  const base = {
    ...current,
    ...patch,
    revision: current.revision + 1,
    completedOperationIds: unique(patch.completedOperationIds ?? current.completedOperationIds),
    skippedOperationIds: unique(patch.skippedOperationIds ?? current.skippedOperationIds),
    consentIds: unique(patch.consentIds ?? current.consentIds),
    resources: uniqueResources(patch.resources ?? current.resources),
    removedResourceRefs: unique(patch.removedResourceRefs ?? current.removedResourceRefs),
    updatedAt
  }
  if (patch.lastErrorCode === undefined) delete base.lastErrorCode
  const withoutHistory = Object.fromEntries(Object.entries(base).filter(([field]) => field !== 'historyHead'))
  const next = { ...base, historyHead: stableFingerprint({ previousHistoryHead: current.historyHead, record: withoutHistory }) }
  assertLocalSetupRecord(next)
  return freeze(next)
}

function uniqueResources(value: readonly LocalSetupOwnedResource[]): LocalSetupOwnedResource[] {
  const byRef = new Map<string, LocalSetupOwnedResource>()
  for (const resource of value) {
    validateResource(resource)
    byRef.set(resource.ref, { ...resource })
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref))
}

async function persist(store: LocalSetupStateStore, previous: LocalSetupRecord, next: LocalSetupRecord): Promise<LocalSetupRecord> {
  let stored = false
  try {
    stored = (await store.compareAndSwap(previous.id, previous.revision, next)) === true
  } catch {
    throw new LocalSetupLifecycleError('state-store-failed')
  }
  if (!stored) throw new LocalSetupLifecycleError('setup-revision-conflict')
  return next
}

function runResult(status: LocalSetupRunStatus, record: LocalSetupRecord, pendingConsentScopes: LocalSetupConsentScope[] = [], reasonCode?: string): LocalSetupRunResult {
  return freeze({ status, record, pendingConsentScopes: unique(pendingConsentScopes).sort(), ...(reasonCode ? { reasonCode } : {}) })
}

function assertSetupBinding(proposal: LocalSetupProposal, record: LocalSetupRecord, evaluatedAt: string): void {
  assertLocalSetupProposal(proposal)
  assertLocalSetupRecord(record)
  if (!timestamp(evaluatedAt)) throw new LocalSetupLifecycleError('invalid-evaluation-time')
  if (record.proposalId !== proposal.id || record.profileId !== proposal.profileId || record.storageRootRef !== proposal.storage.rootRef) throw new LocalSetupLifecycleError('setup-record-mismatch')
  if (Date.parse(evaluatedAt) < Date.parse(proposal.generatedAt)) throw new LocalSetupLifecycleError('evaluation-before-proposal')
}

export async function resumeLocalSetup(input: ResumeLocalSetupInput): Promise<LocalSetupRunResult> {
  assertSetupBinding(input.proposal, input.record, input.evaluatedAt)
  if (Date.parse(input.evaluatedAt) >= Date.parse(input.proposal.validUntil)) return runResult('paused', input.record, [], 'proposal-expired')
  if (!safeComponent(input.adapter.id)) throw new LocalSetupLifecycleError('invalid-adapter-id')
  if (input.record.state === 'removed' || input.record.state === 'removing') return runResult('failed', input.record, [], 'setup-not-resumable')
  if (input.record.state === 'ready') return runResult('ready', input.record)

  let current = input.record
  for (const operation of input.proposal.operations) {
    if (current.completedOperationIds.includes(operation.id) || current.skippedOperationIds.includes(operation.id)) continue
    if (!operation.dependsOn.every((dependency) => current.completedOperationIds.includes(dependency) || current.skippedOperationIds.includes(dependency)))
      throw new LocalSetupLifecycleError('operation-dependency-incomplete')

    let consent: LocalSetupConsent | undefined
    if (operation.consentScope) {
      const matches = input.consents.filter((entry) => entry.operationId === operation.id)
      if (matches.length === 0) return runResult('awaiting-consent', current, [operation.consentScope])
      if (matches.length > 1) return runResult('paused', current, [operation.consentScope], 'duplicate-consent')
      consent = matches[0]
      try {
        assertLocalSetupConsentForOperation(consent, input.proposal, operation, input.evaluatedAt)
      } catch {
        return runResult('paused', current, [operation.consentScope], 'invalid-consent')
      }
      if (!current.consentIds.includes(consent.id)) {
        let consumed = false
        try {
          consumed =
            (await input.authority.consumeSetupConsent({
              consent,
              setupId: current.id,
              operationId: operation.id
            })) === true
        } catch {
          return runResult('paused', current, [operation.consentScope], 'consent-authority-failed')
        }
        if (!consumed) return runResult('paused', current, [operation.consentScope], 'consent-host-rejected')
      }
      if (consent.decision === 'declined') {
        if (!operation.optional) return runResult('paused', current, [operation.consentScope], 'required-operation-declined')
        const skipped = nextRecord(current, input.evaluatedAt, {
          state: 'executing',
          skippedOperationIds: [...current.skippedOperationIds, operation.id],
          consentIds: [...current.consentIds, consent.id]
        })
        current = await persist(input.store, current, skipped)
        continue
      }
    }

    const idempotencyKey = stableFingerprint({ setupId: current.id, operationId: operation.id })
    let execution: LocalSetupOperationResult
    try {
      execution = await input.adapter.execute({
        proposal: input.proposal,
        operation,
        setupId: current.id,
        idempotencyKey
      })
      validateExecutionResult(execution)
    } catch (error) {
      if (error instanceof LocalSetupLifecycleError) throw error
      const failed = nextRecord(current, input.evaluatedAt, {
        state: 'failed',
        consentIds: consent ? [...current.consentIds, consent.id] : current.consentIds,
        lastErrorCode: 'adapter-operation-failed'
      })
      current = await persist(input.store, current, failed)
      return runResult('failed', current, [], 'adapter-operation-failed')
    }

    if (execution.status === 'blocked') {
      const paused = nextRecord(current, input.evaluatedAt, {
        state: 'paused',
        consentIds: consent ? [...current.consentIds, consent.id] : current.consentIds,
        lastErrorCode: execution.reasonCode
      })
      current = await persist(input.store, current, paused)
      return runResult('paused', current, [], execution.reasonCode)
    }

    let resource = execution.resource
    if (operation.kind === 'download-model') {
      if (
        !execution.stagedArtifact ||
        execution.stagedArtifact.sha256 !== input.proposal.model.sha256 ||
        BigInt(execution.stagedArtifact.bytes) > BigInt(input.proposal.model.downloadBytes) ||
        resource !== undefined
      ) {
        const failed = nextRecord(current, input.evaluatedAt, {
          state: 'failed',
          consentIds: consent ? [...current.consentIds, consent.id] : current.consentIds,
          lastErrorCode: 'artifact-integrity-mismatch'
        })
        current = await persist(input.store, current, failed)
        return runResult('failed', current, [], 'artifact-integrity-mismatch')
      }
      try {
        resource = await input.adapter.activateModel({
          proposal: input.proposal,
          operation,
          setupId: current.id,
          idempotencyKey,
          stagedArtifact: execution.stagedArtifact
        })
        validateResource(resource)
      } catch (error) {
        if (error instanceof LocalSetupLifecycleError) throw error
        const failed = nextRecord(current, input.evaluatedAt, {
          state: 'failed',
          consentIds: consent ? [...current.consentIds, consent.id] : current.consentIds,
          lastErrorCode: 'artifact-activation-failed'
        })
        current = await persist(input.store, current, failed)
        return runResult('failed', current, [], 'artifact-activation-failed')
      }
      if (resource.kind !== 'model' || resource.sha256 !== input.proposal.model.sha256 || BigInt(resource.bytes) > BigInt(input.proposal.model.installedDiskBytes))
        throw new LocalSetupLifecycleError('invalid-activated-artifact')
    } else if (execution.stagedArtifact !== undefined) throw new LocalSetupLifecycleError('unexpected-staged-artifact')

    const completedIds = [...current.completedOperationIds, operation.id]
    const allDone = input.proposal.operations.every((entry) => completedIds.includes(entry.id) || current.skippedOperationIds.includes(entry.id))
    const completed = nextRecord(current, input.evaluatedAt, {
      state: allDone ? 'ready' : 'executing',
      completedOperationIds: completedIds,
      consentIds: consent ? [...current.consentIds, consent.id] : current.consentIds,
      resources: resource ? [...current.resources, resource] : current.resources
    })
    current = await persist(input.store, current, completed)
  }

  if (current.state !== 'ready') {
    current = await persist(input.store, current, nextRecord(current, input.evaluatedAt, { state: 'ready' }))
  }
  return runResult('ready', current)
}

export async function removeLocalSetup(input: RemoveLocalSetupInput): Promise<LocalSetupRunResult> {
  assertSetupBinding(input.proposal, input.record, input.evaluatedAt)
  assertLocalRemovalPreview(input.preview)
  if (input.record.state === 'removed') return runResult('removed', input.record)
  try {
    assertLocalRemovalConsentForPreview(input.consent, input.preview, input.record, input.evaluatedAt)
  } catch {
    return runResult('paused', input.record, [], 'invalid-removal-consent')
  }
  if (input.consent.decision === 'declined') return runResult('paused', input.record, [], 'removal-declined')

  let consumed = false
  try {
    consumed =
      (await input.authority.consumeRemovalConsent({
        consent: input.consent,
        setupId: input.record.id,
        previewId: input.preview.id
      })) === true
  } catch {
    return runResult('paused', input.record, [], 'consent-authority-failed')
  }
  if (!consumed) return runResult('paused', input.record, [], 'consent-host-rejected')

  let current = input.record
  for (const item of input.preview.items) {
    if (item.action === 'retain-shared' || current.removedResourceRefs.includes(item.ref)) continue
    const idempotencyKey = stableFingerprint({ setupId: current.id, previewId: input.preview.id, resourceRef: item.ref })
    let removal: LocalRemovalOperationResult
    try {
      removal = await input.adapter.remove({
        proposal: input.proposal,
        preview: input.preview,
        resource: item,
        setupId: current.id,
        idempotencyKey
      })
      validateRemovalResult(removal)
    } catch (error) {
      if (error instanceof LocalSetupLifecycleError) throw error
      const failed = nextRecord(current, input.evaluatedAt, { state: 'failed', lastErrorCode: 'adapter-removal-failed' })
      current = await persist(input.store, current, failed)
      return runResult('failed', current, [], 'adapter-removal-failed')
    }
    if (removal.status === 'blocked') {
      const failed = nextRecord(current, input.evaluatedAt, { state: 'failed', lastErrorCode: removal.reasonCode })
      current = await persist(input.store, current, failed)
      return runResult('failed', current, [], removal.reasonCode)
    }
    current = await persist(
      input.store,
      current,
      nextRecord(current, input.evaluatedAt, {
        state: 'removing',
        removedResourceRefs: [...current.removedResourceRefs, item.ref]
      })
    )
  }
  if (current.state !== 'removed') current = await persist(input.store, current, nextRecord(current, input.evaluatedAt, { state: 'removed' }))
  return runResult('removed', current)
}
