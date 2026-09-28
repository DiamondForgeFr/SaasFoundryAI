import { assertExecutionCandidate, createExecutionCandidateId } from './catalogue'
import { assertLocalBenchmarkPlan, type LocalBenchmarkCurrentState, type LocalBenchmarkPlan } from './local-benchmark'
import { assertLocalCandidateQualification, type LocalCandidateQualification } from './local-qualification'
import { assertLocalExecutionProfileCandidate, type LocalExecutionProfile } from './local-profiles'
import { assertLocalSetupProposal, assertLocalSetupRecord, type LocalSetupProposal, type LocalSetupRecord } from './local-setup'
import { stableFingerprint } from './overrides'
import type { ExecutionCandidate, NormalizedEffort, PriceDimensionKind, PriceUnit } from './types'
import type { TaskCategory } from './requirements'

const COMPONENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TASK_CLASSES: TaskCategory[] = ['mechanical', 'implementation', 'architecture', 'security', 'data-sensitive']
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i
const TASK_CAPABILITIES: Record<TaskCategory, string[]> = {
  mechanical: ['code', 'text'],
  implementation: ['code', 'repository-analysis', 'text', 'tool-use'],
  architecture: ['long-context', 'repository-analysis', 'system-design', 'text'],
  security: ['code', 'repository-analysis', 'security-analysis', 'text'],
  'data-sensitive': ['repository-analysis', 'text']
}
const PRICE_DIMENSIONS: PriceDimensionKind[] = ['input-token', 'output-token', 'cached-input-token', 'request', 'second', 'minute', 'tool-call']
const PRICE_UNITS: Record<PriceDimensionKind, PriceUnit> = {
  'input-token': 'token',
  'output-token': 'token',
  'cached-input-token': 'token',
  request: 'request',
  second: 'second',
  minute: 'minute',
  'tool-call': 'call'
}

export type LocalCandidateExclusionCode =
  | 'invalid-input'
  | 'qualification-not-qualified'
  | 'qualification-category-missing'
  | 'qualification-stale'
  | 'qualification-binding-mismatch'
  | 'profile-mismatch'
  | 'setup-not-ready'
  | 'setup-mismatch'
  | 'transport-unhealthy'
  | 'transport-unverified'
  | 'transport-stale'
  | 'transport-not-loopback'
  | 'host-mismatch'
  | 'qualified-context-unknown'
  | 'candidate-conflict'

export interface LocalCandidateTransportAttestation {
  schemaVersion: 1
  profileId: string
  setupId: string
  setupRevision: number
  hostSnapshotId: string
  protocol: 'http' | 'https' | 'unix'
  binding: { scope: 'loopback'; addressRef: string; port?: number }
  dataPath: {
    remoteUpstream: 'none'
    telemetry: 'disabled'
    toolTransport: 'none' | 'local-only'
    logging: 'local-only'
    crashReporting: 'disabled'
    retrieval: 'none' | 'local-only'
  }
  health: 'healthy' | 'unhealthy'
  checkedAt: string
  validUntil: string
  evidenceRefs: string[]
}

export interface LocalCandidateAdmissionInput {
  profile: LocalExecutionProfile
  proposal: LocalSetupProposal
  setup: LocalSetupRecord
  benchmarkPlan: LocalBenchmarkPlan
  qualification: LocalCandidateQualification
  currentState: LocalBenchmarkCurrentState
  currentQualificationPolicyId: string
  taskClass: TaskCategory
  transport: LocalCandidateTransportAttestation
  /** Capabilities are deliberately supplied for the selected qualification category only. */
  capabilities: string[]
  tools?: {
    mode: 'none' | 'adapter-mediated'
    supported: string[]
    parallelCalls: boolean
    requiresApproval: boolean
  }
  effort?: NormalizedEffort
  pricingCurrency?: string
  evaluatedAt: string
  authority: LocalCandidateAdmissionAuthority
}

export interface LocalCandidateAdmissionAuthority {
  verifyTransportAttestation(
    attestation: Readonly<LocalCandidateTransportAttestation>,
    binding: Readonly<{
      profileId: string
      setupId: string
      setupRevision: number
      hostSnapshotId: string
      runtimeId: string
      artifactSha256: string
      evaluatedAt: string
    }>
  ): boolean
}

export interface LocalCandidateAdmissionExclusion {
  status: 'excluded'
  code: LocalCandidateExclusionCode
  profileId: string
  setupId: string
  taskClass: TaskCategory
  evidenceRefs: string[]
}

export type LocalCandidateAdmissionResult = { status: 'admitted'; candidate: ExecutionCandidate; evidenceRefs: string[] } | LocalCandidateAdmissionExclusion

export class LocalCandidateAdmissionError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid local candidate admission: ${issues.join('; ')}`)
    this.name = 'LocalCandidateAdmissionError'
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

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function reference(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE.test(value) && !SECRET_LIKE.test(value)
}

function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

function component(value: unknown): value is string {
  return typeof value === 'string' && COMPONENT.test(value)
}

function earliest(values: string[]): string {
  return values.slice().sort()[0]
}

function exclusion(input: LocalCandidateAdmissionInput, code: LocalCandidateExclusionCode, refs: string[] = []): LocalCandidateAdmissionExclusion {
  const profileId = fingerprint(input.profile?.id) ? input.profile.id : '0'.repeat(64)
  const setupId = fingerprint(input.setup?.id) ? input.setup.id : '0'.repeat(64)
  const profileRefs = Array.isArray(input.profile?.evidenceRefs) ? input.profile.evidenceRefs : []
  const qualificationRefs = Array.isArray(input.qualification?.evidenceRefs) ? input.qualification.evidenceRefs : []
  const transportRefs = Array.isArray(input.transport?.evidenceRefs) ? input.transport.evidenceRefs : []
  return freeze({
    status: 'excluded' as const,
    code,
    profileId,
    setupId,
    taskClass: input.taskClass,
    evidenceRefs: [...new Set([...profileRefs, ...qualificationRefs, ...transportRefs, ...refs].filter(reference))].sort()
  })
}

function assertTransport(value: unknown): asserts value is LocalCandidateTransportAttestation {
  if (!object(value)) throw new LocalCandidateAdmissionError(['transport attestation must be an object'])
  const issues: string[] = []
  if (value.schemaVersion !== 1) issues.push('transport.schemaVersion must be 1')
  for (const field of ['profileId', 'setupId', 'hostSnapshotId'] as const) if (!fingerprint(value[field])) issues.push(`transport.${field} must be a fingerprint`)
  if (!Number.isSafeInteger(value.setupRevision) || Number(value.setupRevision) < 0) issues.push('transport.setupRevision must be a non-negative safe integer')
  if (!['http', 'https', 'unix'].includes(String(value.protocol))) issues.push('transport.protocol is unsupported')
  if (!object(value.binding) || value.binding.scope !== 'loopback' || !reference(value.binding.addressRef)) issues.push('transport.binding must be loopback with a safe address reference')
  if (object(value.binding) && value.binding.port !== undefined && (!Number.isSafeInteger(value.binding.port) || Number(value.binding.port) < 1 || Number(value.binding.port) > 65535))
    issues.push('transport.binding.port is invalid')
  if (!['healthy', 'unhealthy'].includes(String(value.health))) issues.push('transport.health is unsupported')
  if (!object(value.dataPath)) issues.push('transport.dataPath must be an object')
  else {
    const expected = ['remoteUpstream', 'telemetry', 'toolTransport', 'logging', 'crashReporting', 'retrieval']
    if (Object.keys(value.dataPath).some((field) => !expected.includes(field))) issues.push('transport.dataPath contains unsupported fields')
    if (value.dataPath.remoteUpstream !== 'none') issues.push('transport.dataPath.remoteUpstream must be none')
    if (value.dataPath.telemetry !== 'disabled') issues.push('transport.dataPath.telemetry must be disabled')
    if (!['none', 'local-only'].includes(String(value.dataPath.toolTransport))) issues.push('transport.dataPath.toolTransport is unsupported')
    if (value.dataPath.logging !== 'local-only') issues.push('transport.dataPath.logging must be local-only')
    if (value.dataPath.crashReporting !== 'disabled') issues.push('transport.dataPath.crashReporting must be disabled')
    if (!['none', 'local-only'].includes(String(value.dataPath.retrieval))) issues.push('transport.dataPath.retrieval is unsupported')
  }
  if (!timestamp(value.checkedAt) || !timestamp(value.validUntil) || value.checkedAt >= value.validUntil) issues.push('transport timestamps are invalid')
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || !value.evidenceRefs.every(reference) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length)
    issues.push('transport.evidenceRefs must contain unique safe references')
  if (issues.length) throw new LocalCandidateAdmissionError(issues)
}

export function assertLocalCandidateAdmission(value: unknown): asserts value is LocalCandidateAdmissionResult {
  if (!object(value)) throw new LocalCandidateAdmissionError(['admission result must be an object'])
  if (value.status === 'excluded') {
    if (!component(value.code) || !fingerprint(value.profileId) || !fingerprint(value.setupId) || !TASK_CLASSES.includes(value.taskClass as TaskCategory))
      throw new LocalCandidateAdmissionError(['admission exclusion is invalid'])
    return
  }
  if (value.status !== 'admitted' || !Array.isArray(value.evidenceRefs)) throw new LocalCandidateAdmissionError(['admission result status is invalid'])
  try {
    assertExecutionCandidate(value.candidate)
  } catch (error) {
    throw new LocalCandidateAdmissionError([error instanceof Error ? error.message : 'admitted candidate is invalid'])
  }
}

function zeroPricing(currency: string, observedAt: string, validUntil: string): ExecutionCandidate['pricing'] {
  return {
    observedAt,
    validUntil,
    dimensions: PRICE_DIMENSIONS.map((kind) => ({ kind, amount: '0', currency, unit: PRICE_UNITS[kind], per: 1, sourceUnit: 'no-provider-charge' }))
  }
}

export function admitLocalExecutionCandidate(input: LocalCandidateAdmissionInput): LocalCandidateAdmissionResult {
  try {
    assertLocalExecutionProfileCandidate({
      schemaVersion: 1,
      runtime: input.profile.runtime,
      artifact: input.profile.artifact,
      configuration: input.profile.configuration,
      resources: {
        artifactDownloadBytes: input.profile.resources.artifactDownloadBytes,
        installedDiskBytes: input.profile.resources.installedDiskBytes,
        systemMemoryBytes: input.profile.resources.systemMemoryBytes,
        acceleratorMemoryBytes: input.profile.resources.acceleratorMemoryBytes,
        memoryPool: input.profile.resources.memoryPool
      },
      performance: input.profile.performance,
      suitability: input.profile.suitability,
      availability: input.profile.availability,
      evidenceRefs: input.profile.evidenceRefs
    })
    assertLocalSetupProposal(input.proposal)
    assertLocalSetupRecord(input.setup)
    assertLocalBenchmarkPlan(input.benchmarkPlan)
    assertLocalCandidateQualification(input.qualification)
    assertTransport(input.transport)
    if (!timestamp(input.evaluatedAt)) throw new LocalCandidateAdmissionError(['evaluatedAt must be canonical'])
    if (!TASK_CLASSES.includes(input.taskClass)) throw new LocalCandidateAdmissionError(['taskClass is unsupported'])
    if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 || !input.capabilities.every(component) || new Set(input.capabilities).size !== input.capabilities.length)
      throw new LocalCandidateAdmissionError(['capabilities must contain unique safe identifiers'])
    if (input.capabilities.some((capability) => !TASK_CAPABILITIES[input.taskClass].includes(capability))) throw new LocalCandidateAdmissionError(['capabilities exceed the qualified task category'])
    if (!object(input.currentState) || !fingerprint(input.currentQualificationPolicyId)) throw new LocalCandidateAdmissionError(['current qualification state is invalid'])
    if (input.tools !== undefined) {
      if (!object(input.tools) || !['none', 'adapter-mediated'].includes(String(input.tools.mode)) || !Array.isArray(input.tools.supported) || input.tools.supported.some((tool) => !component(tool)))
        throw new LocalCandidateAdmissionError(['tools must contain a supported mode and safe identifiers'])
      if (new Set(input.tools.supported).size !== input.tools.supported.length || typeof input.tools.parallelCalls !== 'boolean' || typeof input.tools.requiresApproval !== 'boolean')
        throw new LocalCandidateAdmissionError(['tools must be canonical'])
      if (input.tools.mode === 'adapter-mediated' && input.transport.dataPath.toolTransport !== 'local-only')
        throw new LocalCandidateAdmissionError(['adapter-mediated tools require a local-only tool transport'])
      if (input.tools.mode === 'none' && input.tools.supported.length > 0) throw new LocalCandidateAdmissionError(['none tool mode cannot advertise tools'])
    }
    if (input.pricingCurrency !== undefined && !/^[A-Z]{3}$/.test(input.pricingCurrency)) throw new LocalCandidateAdmissionError(['pricingCurrency must be an ISO currency'])
    if (!object(input.authority) || typeof input.authority.verifyTransportAttestation !== 'function') throw new LocalCandidateAdmissionError(['host transport attestation authority is required'])
  } catch {
    return exclusion(input, 'invalid-input')
  }

  const decision = input.qualification.decisions.find((entry) => entry.taskClass === input.taskClass)
  if (!decision) return exclusion(input, 'qualification-category-missing')
  if (input.qualification.status !== 'qualified' || decision.status !== 'qualified')
    return exclusion(input, decision.status === 'stale' || input.qualification.status === 'stale' ? 'qualification-stale' : 'qualification-not-qualified')
  if (
    input.qualification.planId !== input.benchmarkPlan.id ||
    input.qualification.suiteId !== input.benchmarkPlan.suiteId ||
    input.qualification.qualificationPolicyId !== input.currentQualificationPolicyId ||
    stableFingerprint(input.qualification.binding) !== stableFingerprint(input.benchmarkPlan.binding) ||
    stableFingerprint(input.currentState.binding) !== stableFingerprint(input.benchmarkPlan.binding) ||
    input.currentState.suiteId !== input.benchmarkPlan.suiteId ||
    input.currentState.adapterId !== input.benchmarkPlan.adapterId ||
    input.currentState.validatorId !== input.benchmarkPlan.validatorId
  )
    return exclusion(input, 'qualification-binding-mismatch')
  if (
    input.profile.id !== input.qualification.binding.profileId ||
    input.profile.id !== input.setup.profileId ||
    input.profile.id !== input.proposal.profileId ||
    input.profile.id !== input.transport.profileId
  )
    return exclusion(input, 'profile-mismatch')
  if (input.setup.state !== 'ready') return exclusion(input, 'setup-not-ready')
  if (
    input.setup.id !== input.qualification.binding.setupId ||
    input.proposal.id !== input.qualification.binding.proposalId ||
    input.setup.proposalId !== input.proposal.id ||
    input.setup.revision !== input.qualification.binding.setupRevision ||
    input.transport.setupId !== input.setup.id ||
    input.transport.setupRevision !== input.setup.revision
  )
    return exclusion(input, 'setup-mismatch')
  if (
    input.profile.hostSnapshotId !== input.qualification.binding.hostSnapshotId ||
    input.profile.hostSnapshotId !== input.proposal.hostSnapshotId ||
    input.profile.hostSnapshotId !== input.transport.hostSnapshotId
  )
    return exclusion(input, 'host-mismatch')
  const binding = input.qualification.binding
  if (
    binding.profilePolicyId !== input.profile.policyId ||
    binding.runtimeId !== input.profile.runtime.runtimeId ||
    binding.runtimeSourceRevision !== input.proposal.runtime.sourceRevision ||
    binding.artifactId !== input.profile.artifact.artifactId ||
    binding.artifactRevision !== input.profile.artifact.revision ||
    binding.artifactSha256 !== input.profile.artifact.sha256 ||
    binding.artifactSha256 !== input.proposal.model.sha256 ||
    binding.artifactFormat !== input.profile.artifact.format ||
    binding.quantization !== input.profile.artifact.quantization ||
    binding.contextTokens !== input.profile.configuration.contextTokens ||
    binding.maxOutputTokens !== input.profile.configuration.maxOutputTokens ||
    binding.concurrency !== input.profile.configuration.concurrency
  )
    return exclusion(input, 'qualification-binding-mismatch')
  if (input.transport.health !== 'healthy') return exclusion(input, 'transport-unhealthy')
  if (input.evaluatedAt < input.transport.checkedAt || input.evaluatedAt >= input.transport.validUntil) return exclusion(input, 'transport-stale')
  if (input.evaluatedAt >= earliest([input.profile.availability.validUntil, input.proposal.validUntil, input.qualification.validUntil])) return exclusion(input, 'qualification-stale')
  if (decision.metrics.stableContextMinimumTokens === null || decision.metrics.stableContextMinimumTokens < 1) return exclusion(input, 'qualified-context-unknown')
  let transportVerified = false
  try {
    transportVerified =
      input.authority.verifyTransportAttestation(input.transport, {
        profileId: input.profile.id,
        setupId: input.setup.id,
        setupRevision: input.setup.revision,
        hostSnapshotId: input.profile.hostSnapshotId,
        runtimeId: input.profile.runtime.runtimeId,
        artifactSha256: input.profile.artifact.sha256,
        evaluatedAt: input.evaluatedAt
      }) === true
  } catch {
    transportVerified = false
  }
  if (!transportVerified) return exclusion(input, 'transport-unverified')

  const providerId = 'local'
  const runtimeId = input.profile.runtime.runtimeId
  const modelId = input.profile.artifact.modelId
  const effort = input.effort ?? 'medium'
  const candidate: ExecutionCandidate = {
    id: createExecutionCandidateId(providerId, runtimeId, modelId, effort),
    provider: { id: providerId, displayName: 'Local host' },
    runtime: { id: runtimeId, kind: 'local', displayName: runtimeId },
    model: { id: modelId, displayName: modelId },
    effort: { normalized: effort, sourceId: input.profile.artifact.revision },
    context: {
      windowTokens: Math.min(input.profile.configuration.contextTokens, decision.metrics.stableContextMinimumTokens),
      maxOutputTokens: input.profile.configuration.maxOutputTokens
    },
    capabilities: [...input.capabilities].sort(),
    availability: {
      state: 'available',
      checkedAt: input.transport.checkedAt,
      validUntil: earliest([input.profile.availability.validUntil, input.proposal.validUntil, input.qualification.validUntil, input.transport.validUntil])
    },
    pricing: zeroPricing(
      input.pricingCurrency ?? 'USD',
      input.transport.checkedAt,
      earliest([input.profile.availability.validUntil, input.proposal.validUntil, input.qualification.validUntil, input.transport.validUntil])
    ),
    privacy: { boundary: 'local-device', dataResidency: ['local-device'], trainingUse: 'none', retentionDays: 0 },
    tools: input.tools
      ? { mode: input.tools.mode, supported: [...input.tools.supported].sort(), parallelCalls: input.tools.parallelCalls, requiresApproval: input.tools.requiresApproval }
      : { mode: 'none', supported: [], parallelCalls: false, requiresApproval: false },
    source: { adapterId: `local-candidate:${input.profile.adapterId}`, candidateRef: input.profile.sourceId, retrievedAt: input.transport.checkedAt }
  }
  try {
    assertExecutionCandidate(candidate)
  } catch {
    return exclusion(input, 'candidate-conflict')
  }
  const evidenceRefs = [
    ...new Set([input.profile.id, input.qualification.id, input.setup.id, ...input.profile.evidenceRefs, ...input.qualification.evidenceRefs, ...input.transport.evidenceRefs])
  ].sort()
  return freeze({ status: 'admitted' as const, candidate, evidenceRefs })
}

export function fingerprintLocalCandidateAdmission(value: LocalCandidateAdmissionResult): string {
  assertLocalCandidateAdmission(value)
  return stableFingerprint(value)
}
