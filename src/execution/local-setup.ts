import { type LocalExecutionProfile } from './local-profiles'
import { stableFingerprint } from './overrides'

const COMPONENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/
const MAX_BYTES = 2n ** 64n - 1n
const MAX_OPERATIONS = 16
const MAX_RESOURCES = 64
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i

export type LocalSetupMode = 'install' | 'update'
export type LocalSetupNetworkActivity = 'none' | 'download' | 'download-and-authenticate'
export type LocalSetupPersistence = 'none' | 'login-start'
export type LocalSetupBindingScope = 'loopback' | 'non-loopback'
export type LocalSetupConsentScope = 'runtime-install' | 'runtime-update' | 'model-download' | 'login-start-persistence' | 'non-loopback-exposure'
export type LocalSetupOperationKind = 'install-runtime' | 'update-runtime' | 'download-model' | 'configure-runtime' | 'enable-login-start' | 'expose-network' | 'start-runtime'

export interface LocalSetupOperation {
  id: string
  kind: LocalSetupOperationKind
  targetRef: string
  dependsOn: string[]
  consentScope: LocalSetupConsentScope | null
  optional: boolean
}

export interface LocalSetupProposal {
  schemaVersion: 1
  id: string
  mode: LocalSetupMode
  replacesSetupId?: string
  profileId: string
  hostSnapshotId: string
  policyId: string
  generatedAt: string
  validUntil: string
  runtime: {
    runtimeId: string
    sourceRef: string
    sourceRevision: string
    licenseRef: string
    installSizeBytes: string
    networkActivity: LocalSetupNetworkActivity
  }
  model: {
    modelId: string
    artifactId: string
    sourceRef: string
    sourceRevision: string
    licenseRef: string
    downloadBytes: string
    installedDiskBytes: string
    systemMemoryBytes: string
    acceleratorMemoryBytes: string
    sha256: string
    networkActivity: Exclude<LocalSetupNetworkActivity, 'download-and-authenticate'>
  }
  service: {
    persistence: LocalSetupPersistence
    binding: {
      scope: LocalSetupBindingScope
      addressRef: string
      port: number
    }
  }
  storage: {
    rootRef: string
    outsideGeneratedRepository: true
  }
  operations: LocalSetupOperation[]
  evidenceRefs: string[]
}

export interface CreateLocalSetupProposalInput {
  profile: LocalExecutionProfile
  generatedAt: string
  validUntil: string
  mode?: LocalSetupMode
  replacesSetupId?: string
  runtime: {
    sourceRef: string
    sourceRevision: string
    licenseRef: string
    installSizeBytes: string
    networkActivity: LocalSetupNetworkActivity
  }
  model: {
    sourceRef: string
    sourceRevision: string
    licenseRef: string
    networkActivity: Exclude<LocalSetupNetworkActivity, 'download-and-authenticate'>
  }
  service: {
    persistence?: LocalSetupPersistence
    binding: {
      scope: LocalSetupBindingScope
      addressRef: string
      port: number
    }
  }
  storage: {
    rootRef: string
    outsideGeneratedRepository: true
  }
  evidenceRefs: string[]
}

export type LocalSetupConsentDecision = 'approved' | 'declined'

export interface LocalSetupConsent {
  schemaVersion: 1
  id: string
  proposalId: string
  profileId: string
  hostSnapshotId: string
  operationId: string
  scope: LocalSetupConsentScope
  decision: LocalSetupConsentDecision
  decidedAt: string
  validUntil: string
  actorRef: string
  nonceRef: string
}

export interface CreateLocalSetupConsentInput {
  operationId: string
  decision: LocalSetupConsentDecision
  decidedAt: string
  validUntil: string
  actorRef: string
  nonceRef: string
}

export type LocalSetupRecordState = 'proposed' | 'awaiting-consent' | 'executing' | 'paused' | 'ready' | 'failed' | 'removing' | 'removed'

export interface LocalSetupOwnedResource {
  kind: 'runtime' | 'model' | 'configuration' | 'service' | 'binding'
  ref: string
  bytes: string
  sha256?: string
  shared: boolean
}

export interface LocalSetupRecord {
  schemaVersion: 1
  id: string
  proposalId: string
  profileId: string
  storageRootRef: string
  revision: number
  state: LocalSetupRecordState
  completedOperationIds: string[]
  skippedOperationIds: string[]
  consentIds: string[]
  resources: LocalSetupOwnedResource[]
  removedResourceRefs: string[]
  lastErrorCode?: string
  createdAt: string
  updatedAt: string
  historyHead: string
}

export interface LocalRemovalPreviewItem extends LocalSetupOwnedResource {
  action: 'delete' | 'retain-shared'
}

export interface LocalRemovalPreview {
  schemaVersion: 1
  id: string
  setupId: string
  setupRevision: number
  generatedAt: string
  validUntil: string
  items: LocalRemovalPreviewItem[]
  reclaimedBytes: string
  evidenceRefs: string[]
}

export interface LocalRemovalConsent {
  schemaVersion: 1
  id: string
  previewId: string
  setupId: string
  setupRevision: number
  decision: LocalSetupConsentDecision
  decidedAt: string
  validUntil: string
  actorRef: string
  nonceRef: string
}

export interface CreateLocalRemovalConsentInput {
  decision: LocalSetupConsentDecision
  decidedAt: string
  validUntil: string
  actorRef: string
  nonceRef: string
}

export class LocalSetupContractError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid local setup contract: ${issues.join('; ')}`)
    this.name = 'LocalSetupContractError'
    this.issues = [...issues]
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) freeze(entry)
    Object.freeze(value)
  }
  return value
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string, issues: string[]): void {
  for (const field of Object.keys(value)) if (!allowed.includes(field)) issues.push(`${label}.${field} is not allowed`)
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
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

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function safeList(value: unknown, limit = 64): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(safeReference) && new Set(value).size === value.length
}

function canonicalRefs(value: readonly string[]): string[] {
  return [...value].sort()
}

function operation(kind: LocalSetupOperationKind, targetRef: string, dependsOn: readonly string[], consentScope: LocalSetupConsentScope | null, optional: boolean): LocalSetupOperation {
  const withoutId = { kind, targetRef, dependsOn: [...new Set(dependsOn)].sort(), consentScope, optional }
  return { id: stableFingerprint(withoutId), ...withoutId }
}

function proposalOperations(input: CreateLocalSetupProposalInput): LocalSetupOperation[] {
  const runtimeKind = (input.mode ?? 'install') === 'install' ? 'install-runtime' : 'update-runtime'
  const runtimeScope = runtimeKind === 'install-runtime' ? 'runtime-install' : 'runtime-update'
  const runtime = operation(runtimeKind, input.profile.runtime.runtimeId, [], runtimeScope, false)
  const model = operation('download-model', input.profile.artifact.artifactId, [runtime.id], 'model-download', false)
  const configure = operation('configure-runtime', input.profile.runtime.runtimeId, [runtime.id, model.id], null, false)
  const operations = [runtime, model, configure]
  let serviceDependency = configure.id
  if (input.service.persistence === 'login-start') {
    const persistence = operation('enable-login-start', input.profile.runtime.runtimeId, [configure.id], 'login-start-persistence', true)
    operations.push(persistence)
    serviceDependency = persistence.id
  }
  if (input.service.binding.scope === 'non-loopback') {
    const exposure = operation('expose-network', input.service.binding.addressRef, [configure.id], 'non-loopback-exposure', true)
    operations.push(exposure)
    serviceDependency = exposure.id
  }
  operations.push(operation('start-runtime', input.profile.runtime.runtimeId, [configure.id, serviceDependency], null, false))
  return operations
}

export function createLocalSetupProposal(input: CreateLocalSetupProposalInput): LocalSetupProposal {
  if (input.model.sourceRevision !== input.profile.artifact.revision) throw new LocalSetupContractError(['model source revision must match the selected profile artifact revision'])
  const mode = input.mode ?? 'install'
  const persistence = input.service.persistence ?? 'none'
  const binding = input.service.binding
  const withoutId: Omit<LocalSetupProposal, 'id'> = {
    schemaVersion: 1,
    mode,
    ...(input.replacesSetupId === undefined ? {} : { replacesSetupId: input.replacesSetupId }),
    profileId: input.profile.id,
    hostSnapshotId: input.profile.hostSnapshotId,
    policyId: input.profile.policyId,
    generatedAt: input.generatedAt,
    validUntil: input.validUntil,
    runtime: {
      runtimeId: input.profile.runtime.runtimeId,
      sourceRef: input.runtime.sourceRef,
      sourceRevision: input.runtime.sourceRevision,
      licenseRef: input.runtime.licenseRef,
      installSizeBytes: input.runtime.installSizeBytes,
      networkActivity: input.runtime.networkActivity
    },
    model: {
      modelId: input.profile.artifact.modelId,
      artifactId: input.profile.artifact.artifactId,
      sourceRef: input.model.sourceRef,
      sourceRevision: input.model.sourceRevision,
      licenseRef: input.model.licenseRef,
      downloadBytes: input.profile.resources.artifactDownloadBytes,
      installedDiskBytes: input.profile.resources.installedDiskBytes,
      systemMemoryBytes: input.profile.resources.systemMemoryBytes,
      acceleratorMemoryBytes: input.profile.resources.acceleratorMemoryBytes,
      sha256: input.profile.artifact.sha256,
      networkActivity: input.model.networkActivity
    },
    service: { persistence, binding: { ...binding } },
    storage: { ...input.storage },
    operations: proposalOperations(input),
    evidenceRefs: canonicalRefs(input.evidenceRefs)
  }
  const proposal = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalSetupProposal(proposal)
  return freeze(proposal)
}

function validateSource(value: unknown, label: string, issues: string[], runtime: boolean): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  const fields = runtime
    ? ['runtimeId', 'sourceRef', 'sourceRevision', 'licenseRef', 'installSizeBytes', 'networkActivity']
    : ['modelId', 'artifactId', 'sourceRef', 'sourceRevision', 'licenseRef', 'downloadBytes', 'installedDiskBytes', 'systemMemoryBytes', 'acceleratorMemoryBytes', 'sha256', 'networkActivity']
  exactFields(value, fields, label, issues)
  for (const field of runtime ? ['runtimeId', 'sourceRevision'] : ['modelId', 'artifactId', 'sourceRevision'])
    if (!safeComponent(value[field])) issues.push(`${label}.${field} must be a safe component`)
  for (const field of ['sourceRef', 'licenseRef']) if (!safeReference(value[field])) issues.push(`${label}.${field} must be a safe reference`)
  const byteFields = runtime ? ['installSizeBytes'] : ['downloadBytes', 'installedDiskBytes', 'systemMemoryBytes', 'acceleratorMemoryBytes']
  for (const field of byteFields) if (!byteString(value[field])) issues.push(`${label}.${field} must be an exact byte string`)
  if (!['none', 'download', ...(runtime ? ['download-and-authenticate'] : [])].includes(String(value.networkActivity))) issues.push(`${label}.networkActivity is unsupported`)
  if (!runtime && !FINGERPRINT.test(String(value.sha256))) issues.push(`${label}.sha256 must be a lowercase SHA-256 digest`)
}

function validateOperations(value: unknown, issues: string[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OPERATIONS) {
    issues.push(`proposal.operations must contain 1-${MAX_OPERATIONS} operations`)
    return
  }
  const ids = new Set<string>()
  for (const [index, operationValue] of value.entries()) {
    const label = `proposal.operations[${index}]`
    if (!object(operationValue)) {
      issues.push(`${label} must be an object`)
      continue
    }
    exactFields(operationValue, ['id', 'kind', 'targetRef', 'dependsOn', 'consentScope', 'optional'], label, issues)
    if (!FINGERPRINT.test(String(operationValue.id))) issues.push(`${label}.id must be a fingerprint`)
    if (!['install-runtime', 'update-runtime', 'download-model', 'configure-runtime', 'enable-login-start', 'expose-network', 'start-runtime'].includes(String(operationValue.kind)))
      issues.push(`${label}.kind is unsupported`)
    if (!safeReference(operationValue.targetRef)) issues.push(`${label}.targetRef must be a safe reference`)
    if (
      !Array.isArray(operationValue.dependsOn) ||
      !operationValue.dependsOn.every((entry) => FINGERPRINT.test(String(entry))) ||
      new Set(operationValue.dependsOn).size !== operationValue.dependsOn.length
    )
      issues.push(`${label}.dependsOn must contain unique operation fingerprints`)
    if (![null, 'runtime-install', 'runtime-update', 'model-download', 'login-start-persistence', 'non-loopback-exposure'].includes(operationValue.consentScope as never))
      issues.push(`${label}.consentScope is unsupported`)
    if (typeof operationValue.optional !== 'boolean') issues.push(`${label}.optional must be boolean`)
    if (FINGERPRINT.test(String(operationValue.id))) ids.add(String(operationValue.id))
    if (typeof operationValue.kind === 'string' && safeReference(operationValue.targetRef) && Array.isArray(operationValue.dependsOn)) {
      const expected = operation(
        operationValue.kind as LocalSetupOperationKind,
        operationValue.targetRef,
        operationValue.dependsOn as string[],
        operationValue.consentScope as LocalSetupConsentScope | null,
        Boolean(operationValue.optional)
      ).id
      if (expected !== operationValue.id) issues.push(`${label}.id does not match its canonical content`)
    }
  }
  if (ids.size !== value.length) issues.push('proposal.operations must have unique identities')
  for (const [index, operationValue] of value.entries()) {
    if (!object(operationValue) || !Array.isArray(operationValue.dependsOn)) continue
    for (const dependency of operationValue.dependsOn) {
      if (!ids.has(String(dependency))) issues.push(`proposal.operations[${index}] has an unknown dependency`)
      const dependencyIndex = value.findIndex((candidate) => object(candidate) && candidate.id === dependency)
      if (dependencyIndex >= index) issues.push(`proposal.operations[${index}] dependencies must precede it`)
    }
  }
}

export function assertLocalSetupProposal(value: unknown): asserts value is LocalSetupProposal {
  const issues: string[] = []
  if (!object(value)) throw new LocalSetupContractError(['proposal must be an object'])
  exactFields(
    value,
    ['schemaVersion', 'id', 'mode', 'replacesSetupId', 'profileId', 'hostSnapshotId', 'policyId', 'generatedAt', 'validUntil', 'runtime', 'model', 'service', 'storage', 'operations', 'evidenceRefs'],
    'proposal',
    issues
  )
  if (value.schemaVersion !== 1) issues.push('proposal.schemaVersion must be 1')
  if (!FINGERPRINT.test(String(value.id))) issues.push('proposal.id must be a fingerprint')
  if (!['install', 'update'].includes(String(value.mode))) issues.push('proposal.mode is unsupported')
  if (value.mode === 'update' && !FINGERPRINT.test(String(value.replacesSetupId))) issues.push('proposal.replacesSetupId is required for update mode')
  if (value.mode === 'install' && value.replacesSetupId !== undefined) issues.push('proposal.replacesSetupId is not allowed for install mode')
  for (const field of ['profileId', 'hostSnapshotId', 'policyId']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`proposal.${field} must be a fingerprint`)
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.generatedAt)))
    issues.push('proposal timestamps must define a positive canonical UTC validity window')
  validateSource(value.runtime, 'proposal.runtime', issues, true)
  validateSource(value.model, 'proposal.model', issues, false)
  if (!object(value.service)) issues.push('proposal.service must be an object')
  else {
    exactFields(value.service, ['persistence', 'binding'], 'proposal.service', issues)
    if (!['none', 'login-start'].includes(String(value.service.persistence))) issues.push('proposal.service.persistence is unsupported')
    if (!object(value.service.binding)) issues.push('proposal.service.binding must be an object')
    else {
      exactFields(value.service.binding, ['scope', 'addressRef', 'port'], 'proposal.service.binding', issues)
      if (!['loopback', 'non-loopback'].includes(String(value.service.binding.scope))) issues.push('proposal.service.binding.scope is unsupported')
      if (!safeReference(value.service.binding.addressRef)) issues.push('proposal.service.binding.addressRef must be a safe reference')
      if (!boundedInteger(value.service.binding.port, 1, 65535)) issues.push('proposal.service.binding.port must be between 1 and 65535')
    }
  }
  if (!object(value.storage)) issues.push('proposal.storage must be an object')
  else {
    exactFields(value.storage, ['rootRef', 'outsideGeneratedRepository'], 'proposal.storage', issues)
    if (!safeReference(value.storage.rootRef)) issues.push('proposal.storage.rootRef must be a safe reference')
    if (value.storage.outsideGeneratedRepository !== true) issues.push('proposal.storage must be outside the generated repository')
  }
  validateOperations(value.operations, issues)
  if (!safeList(value.evidenceRefs) || value.evidenceRefs.length === 0 || JSON.stringify(value.evidenceRefs) !== JSON.stringify(canonicalRefs(value.evidenceRefs as string[])))
    issues.push('proposal.evidenceRefs must contain canonical unique safe references')
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('proposal.id does not match its canonical content')
  }
  if (issues.length) throw new LocalSetupContractError(issues)
}

export function createLocalSetupConsent(proposal: LocalSetupProposal, input: CreateLocalSetupConsentInput): LocalSetupConsent {
  assertLocalSetupProposal(proposal)
  const operationValue = proposal.operations.find((entry) => entry.id === input.operationId)
  if (!operationValue?.consentScope) throw new LocalSetupContractError(['consent operation must require explicit consent'])
  const withoutId: Omit<LocalSetupConsent, 'id'> = {
    schemaVersion: 1,
    proposalId: proposal.id,
    profileId: proposal.profileId,
    hostSnapshotId: proposal.hostSnapshotId,
    operationId: operationValue.id,
    scope: operationValue.consentScope,
    decision: input.decision,
    decidedAt: input.decidedAt,
    validUntil: input.validUntil,
    actorRef: input.actorRef,
    nonceRef: input.nonceRef
  }
  const consent = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalSetupConsent(consent)
  assertLocalSetupConsentForOperation(consent, proposal, operationValue, input.decidedAt)
  return freeze(consent)
}

export function assertLocalSetupConsent(value: unknown): asserts value is LocalSetupConsent {
  const issues: string[] = []
  if (!object(value)) throw new LocalSetupContractError(['consent must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'proposalId', 'profileId', 'hostSnapshotId', 'operationId', 'scope', 'decision', 'decidedAt', 'validUntil', 'actorRef', 'nonceRef'], 'consent', issues)
  if (value.schemaVersion !== 1) issues.push('consent.schemaVersion must be 1')
  for (const field of ['id', 'proposalId', 'profileId', 'hostSnapshotId', 'operationId']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`consent.${field} must be a fingerprint`)
  if (!['runtime-install', 'runtime-update', 'model-download', 'login-start-persistence', 'non-loopback-exposure'].includes(String(value.scope))) issues.push('consent.scope is unsupported')
  if (!['approved', 'declined'].includes(String(value.decision))) issues.push('consent.decision is unsupported')
  if (!timestamp(value.decidedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.decidedAt)))
    issues.push('consent timestamps must define a positive canonical UTC validity window')
  if (!safeReference(value.actorRef)) issues.push('consent.actorRef must be a safe reference')
  if (!safeReference(value.nonceRef)) issues.push('consent.nonceRef must be a safe reference')
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('consent.id does not match its canonical content')
  }
  if (issues.length) throw new LocalSetupContractError(issues)
}

export function assertLocalSetupConsentForOperation(consent: LocalSetupConsent, proposal: LocalSetupProposal, operationValue: LocalSetupOperation, evaluatedAt: string): void {
  assertLocalSetupConsent(consent)
  assertLocalSetupProposal(proposal)
  const issues: string[] = []
  if (!timestamp(evaluatedAt)) issues.push('evaluatedAt must be a canonical UTC timestamp')
  if (consent.proposalId !== proposal.id || consent.profileId !== proposal.profileId || consent.hostSnapshotId !== proposal.hostSnapshotId) issues.push('consent does not match the proposal')
  if (consent.operationId !== operationValue.id || consent.scope !== operationValue.consentScope) issues.push('consent does not match the operation scope')
  if (Date.parse(consent.decidedAt) < Date.parse(proposal.generatedAt) || Date.parse(consent.decidedAt) >= Date.parse(proposal.validUntil))
    issues.push('consent was not decided during proposal validity')
  if (timestamp(evaluatedAt) && (Date.parse(evaluatedAt) < Date.parse(consent.decidedAt) || Date.parse(evaluatedAt) >= Date.parse(consent.validUntil)))
    issues.push('consent is not valid at evaluation time')
  if (issues.length) throw new LocalSetupContractError(issues)
}

function recordIdentity(proposal: LocalSetupProposal): string {
  return stableFingerprint({ proposalId: proposal.id, profileId: proposal.profileId, storageRootRef: proposal.storage.rootRef })
}

export function createLocalSetupRecord(proposal: LocalSetupProposal, createdAt: string): LocalSetupRecord {
  assertLocalSetupProposal(proposal)
  if (!timestamp(createdAt) || Date.parse(createdAt) < Date.parse(proposal.generatedAt) || Date.parse(createdAt) >= Date.parse(proposal.validUntil))
    throw new LocalSetupContractError(['record creation time must fall within proposal validity'])
  const id = recordIdentity(proposal)
  const base = {
    schemaVersion: 1 as const,
    id,
    proposalId: proposal.id,
    profileId: proposal.profileId,
    storageRootRef: proposal.storage.rootRef,
    revision: 0,
    state: 'proposed' as const,
    completedOperationIds: [],
    skippedOperationIds: [],
    consentIds: [],
    resources: [],
    removedResourceRefs: [],
    createdAt,
    updatedAt: createdAt
  }
  const record: LocalSetupRecord = { ...base, historyHead: stableFingerprint(base) }
  assertLocalSetupRecord(record)
  return freeze(record)
}

function validateResource(value: unknown, label: string, issues: string[], allowAction = false): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(value, ['kind', 'ref', 'bytes', 'sha256', 'shared', ...(allowAction ? ['action'] : [])], label, issues)
  if (!['runtime', 'model', 'configuration', 'service', 'binding'].includes(String(value.kind))) issues.push(`${label}.kind is unsupported`)
  if (!safeReference(value.ref)) issues.push(`${label}.ref must be a safe reference`)
  if (!byteString(value.bytes)) issues.push(`${label}.bytes must be an exact byte string`)
  if (value.sha256 !== undefined && !FINGERPRINT.test(String(value.sha256))) issues.push(`${label}.sha256 must be a lowercase SHA-256 digest`)
  if (typeof value.shared !== 'boolean') issues.push(`${label}.shared must be boolean`)
}

export function assertLocalSetupRecord(value: unknown): asserts value is LocalSetupRecord {
  const issues: string[] = []
  if (!object(value)) throw new LocalSetupContractError(['record must be an object'])
  exactFields(
    value,
    [
      'schemaVersion',
      'id',
      'proposalId',
      'profileId',
      'storageRootRef',
      'revision',
      'state',
      'completedOperationIds',
      'skippedOperationIds',
      'consentIds',
      'resources',
      'removedResourceRefs',
      'lastErrorCode',
      'createdAt',
      'updatedAt',
      'historyHead'
    ],
    'record',
    issues
  )
  if (value.schemaVersion !== 1) issues.push('record.schemaVersion must be 1')
  for (const field of ['id', 'proposalId', 'profileId', 'historyHead']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`record.${field} must be a fingerprint`)
  if (!safeReference(value.storageRootRef)) issues.push('record.storageRootRef must be a safe reference')
  if (!boundedInteger(value.revision, 0, Number.MAX_SAFE_INTEGER)) issues.push('record.revision must be a non-negative safe integer')
  if (!['proposed', 'awaiting-consent', 'executing', 'paused', 'ready', 'failed', 'removing', 'removed'].includes(String(value.state))) issues.push('record.state is unsupported')
  for (const field of ['completedOperationIds', 'skippedOperationIds', 'consentIds']) {
    const list = value[field]
    if (!Array.isArray(list) || list.length > MAX_OPERATIONS || !list.every((entry) => FINGERPRINT.test(String(entry))) || new Set(list).size !== list.length)
      issues.push(`record.${field} must contain unique operation fingerprints`)
  }
  if (!Array.isArray(value.resources) || value.resources.length > MAX_RESOURCES) issues.push('record.resources is invalid')
  else {
    value.resources.forEach((entry, index) => validateResource(entry, `record.resources[${index}]`, issues))
    const refs = value.resources.map((entry) => (object(entry) ? entry.ref : undefined))
    if (new Set(refs).size !== refs.length) issues.push('record.resources must have unique refs')
  }
  if (!safeList(value.removedResourceRefs, MAX_RESOURCES)) issues.push('record.removedResourceRefs must contain unique safe references')
  if (value.lastErrorCode !== undefined && !safeComponent(value.lastErrorCode)) issues.push('record.lastErrorCode must be a safe component')
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt) || Date.parse(String(value.updatedAt)) < Date.parse(String(value.createdAt))) issues.push('record timestamps are invalid')
  if (issues.length) throw new LocalSetupContractError(issues)
}

function removalSort(left: LocalRemovalPreviewItem, right: LocalRemovalPreviewItem): number {
  const order: Record<LocalSetupOwnedResource['kind'], number> = { binding: 0, service: 1, configuration: 2, model: 3, runtime: 4 }
  return order[left.kind] - order[right.kind] || left.ref.localeCompare(right.ref)
}

export function createLocalRemovalPreview(record: LocalSetupRecord, input: { generatedAt: string; validUntil: string; evidenceRefs: string[] }): LocalRemovalPreview {
  assertLocalSetupRecord(record)
  if (!timestamp(input.generatedAt) || !timestamp(input.validUntil) || Date.parse(input.validUntil) <= Date.parse(input.generatedAt))
    throw new LocalSetupContractError(['removal preview timestamps must define a positive canonical UTC validity window'])
  const removed = new Set(record.removedResourceRefs)
  const items = record.resources
    .filter((entry) => !removed.has(entry.ref))
    .map((entry) => ({ ...entry, action: entry.shared ? ('retain-shared' as const) : ('delete' as const) }))
    .sort(removalSort)
  const reclaimedBytes = String(items.filter((entry) => entry.action === 'delete').reduce((total, entry) => total + BigInt(entry.bytes), 0n))
  const withoutId: Omit<LocalRemovalPreview, 'id'> = {
    schemaVersion: 1,
    setupId: record.id,
    setupRevision: record.revision,
    generatedAt: input.generatedAt,
    validUntil: input.validUntil,
    items,
    reclaimedBytes,
    evidenceRefs: canonicalRefs(input.evidenceRefs)
  }
  const preview = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalRemovalPreview(preview)
  return freeze(preview)
}

export function assertLocalRemovalPreview(value: unknown): asserts value is LocalRemovalPreview {
  const issues: string[] = []
  if (!object(value)) throw new LocalSetupContractError(['removal preview must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'setupId', 'setupRevision', 'generatedAt', 'validUntil', 'items', 'reclaimedBytes', 'evidenceRefs'], 'removal preview', issues)
  if (value.schemaVersion !== 1) issues.push('removal preview.schemaVersion must be 1')
  for (const field of ['id', 'setupId']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`removal preview.${field} must be a fingerprint`)
  if (!boundedInteger(value.setupRevision, 0, Number.MAX_SAFE_INTEGER)) issues.push('removal preview.setupRevision is invalid')
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.generatedAt)))
    issues.push('removal preview timestamps are invalid')
  if (!Array.isArray(value.items) || value.items.length > MAX_RESOURCES) issues.push('removal preview.items is invalid')
  else {
    value.items.forEach((entry, index) => {
      validateResource(entry, `removal preview.items[${index}]`, issues, true)
      if (!object(entry) || !['delete', 'retain-shared'].includes(String(entry.action))) issues.push(`removal preview.items[${index}].action is unsupported`)
      if (object(entry) && entry.action === 'delete' && entry.shared !== false) issues.push(`removal preview.items[${index}] cannot delete a shared resource`)
    })
  }
  if (!byteString(value.reclaimedBytes)) issues.push('removal preview.reclaimedBytes must be an exact byte string')
  if (!safeList(value.evidenceRefs) || JSON.stringify(value.evidenceRefs) !== JSON.stringify(canonicalRefs(value.evidenceRefs as string[])))
    issues.push('removal preview.evidenceRefs must be canonical safe references')
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('removal preview.id does not match its canonical content')
  }
  if (issues.length) throw new LocalSetupContractError(issues)
}

export function createLocalRemovalConsent(preview: LocalRemovalPreview, input: CreateLocalRemovalConsentInput): LocalRemovalConsent {
  assertLocalRemovalPreview(preview)
  const withoutId: Omit<LocalRemovalConsent, 'id'> = {
    schemaVersion: 1,
    previewId: preview.id,
    setupId: preview.setupId,
    setupRevision: preview.setupRevision,
    decision: input.decision,
    decidedAt: input.decidedAt,
    validUntil: input.validUntil,
    actorRef: input.actorRef,
    nonceRef: input.nonceRef
  }
  const consent = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalRemovalConsent(consent)
  if (Date.parse(consent.decidedAt) < Date.parse(preview.generatedAt) || Date.parse(consent.decidedAt) >= Date.parse(preview.validUntil))
    throw new LocalSetupContractError(['removal consent was not decided during preview validity'])
  return freeze(consent)
}

export function assertLocalRemovalConsent(value: unknown): asserts value is LocalRemovalConsent {
  const issues: string[] = []
  if (!object(value)) throw new LocalSetupContractError(['removal consent must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'previewId', 'setupId', 'setupRevision', 'decision', 'decidedAt', 'validUntil', 'actorRef', 'nonceRef'], 'removal consent', issues)
  if (value.schemaVersion !== 1) issues.push('removal consent.schemaVersion must be 1')
  for (const field of ['id', 'previewId', 'setupId']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`removal consent.${field} must be a fingerprint`)
  if (!boundedInteger(value.setupRevision, 0, Number.MAX_SAFE_INTEGER)) issues.push('removal consent.setupRevision is invalid')
  if (!['approved', 'declined'].includes(String(value.decision))) issues.push('removal consent.decision is unsupported')
  if (!timestamp(value.decidedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.decidedAt))) issues.push('removal consent timestamps are invalid')
  if (!safeReference(value.actorRef) || !safeReference(value.nonceRef)) issues.push('removal consent actor and nonce must be safe references')
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('removal consent.id does not match its canonical content')
  }
  if (issues.length) throw new LocalSetupContractError(issues)
}

export function assertLocalRemovalConsentForPreview(consent: LocalRemovalConsent, preview: LocalRemovalPreview, record: LocalSetupRecord, evaluatedAt: string): void {
  assertLocalRemovalConsent(consent)
  assertLocalRemovalPreview(preview)
  assertLocalSetupRecord(record)
  const issues: string[] = []
  if (!timestamp(evaluatedAt)) issues.push('evaluatedAt must be a canonical UTC timestamp')
  if (preview.setupId !== record.id || preview.setupRevision !== record.revision) issues.push('removal preview is stale for the setup record')
  if (consent.previewId !== preview.id || consent.setupId !== record.id || consent.setupRevision !== record.revision) issues.push('removal consent does not match the current preview')
  if (timestamp(evaluatedAt) && (Date.parse(evaluatedAt) < Date.parse(consent.decidedAt) || Date.parse(evaluatedAt) >= Date.parse(consent.validUntil)))
    issues.push('removal consent is not valid at evaluation time')
  if (Date.parse(evaluatedAt) >= Date.parse(preview.validUntil)) issues.push('removal preview is expired')
  if (issues.length) throw new LocalSetupContractError(issues)
}
