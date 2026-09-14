import { type TaskCategory } from './requirements'
import { assertLocalExecutionProfileCandidate, localExecutionProfileId, type LocalExecutionProfile, type LocalExecutionProfileCandidate } from './local-profiles'
import { assertLocalSetupProposal, assertLocalSetupRecord, type LocalSetupProposal, type LocalSetupRecord } from './local-setup'
import { stableFingerprint } from './overrides'

const COMPONENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/
const POSITIVE_DECIMAL = /^(?:0\.(?:0*[1-9]\d*)|[1-9]\d*(?:\.\d+)?)$/
const RATIO = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/
const MAX_BYTES = 2n ** 64n - 1n
const MAX_TASKS = 64
const MAX_ITERATIONS = 32
const MAX_WARMUP_ITERATIONS = 8
const MAX_TIMEOUT_MS = 60 * 60 * 1000
const MAX_TOTAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_EVIDENCE_REFS = 128
const TASK_CLASSES: TaskCategory[] = ['mechanical', 'implementation', 'architecture', 'security', 'data-sensitive']
const QUALITY_CHECKS: LocalBenchmarkQualityCheckKind[] = ['code-correctness', 'instruction-adherence', 'structured-output', 'tool-use']
const SAMPLE_STATUSES: LocalBenchmarkSampleStatus[] = ['completed', 'failed', 'timed-out', 'cancelled', 'unknown']
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i

export type LocalBenchmarkQualityCheckKind = 'structured-output' | 'tool-use' | 'instruction-adherence' | 'code-correctness'
export type LocalBenchmarkQualityCheckStatus = 'passed' | 'failed' | 'unknown'
export type LocalBenchmarkSampleStatus = 'completed' | 'failed' | 'timed-out' | 'cancelled' | 'unknown'

export interface LocalBenchmarkTask {
  id: string
  taskClass: TaskCategory
  contextTokens: number
  maxOutputTokens: number
  requiredChecks: LocalBenchmarkQualityCheckKind[]
}

export interface LocalBenchmarkSuite {
  schemaVersion: 1
  id: string
  version: string
  corpusSha256: string
  validatorVersion: string
  tasks: LocalBenchmarkTask[]
  evidenceRefs: string[]
}

export interface CreateLocalBenchmarkSuiteInput {
  version: string
  corpusSha256: string
  validatorVersion: string
  tasks: LocalBenchmarkTask[]
  evidenceRefs: string[]
}

export interface LocalBenchmarkBinding {
  setupId: string
  setupRevision: number
  proposalId: string
  profileId: string
  hostSnapshotId: string
  profilePolicyId: string
  runtimeId: string
  runtimeSourceRevision: string
  artifactId: string
  artifactRevision: string
  artifactSha256: string
  artifactFormat: string
  quantization: string
  contextTokens: number
  maxOutputTokens: number
  concurrency: number
}

export interface LocalBenchmarkPlan {
  schemaVersion: 1
  id: string
  binding: LocalBenchmarkBinding
  suiteId: string
  adapterId: string
  validatorId: string
  generatedAt: string
  validUntil: string
  execution: {
    iterations: number
    warmupIterations: number
    timeoutMs: number
    maximumTotalDurationMs: number
  }
  isolation: {
    corpus: 'synthetic-only'
    network: 'disabled'
    repositoryAccess: 'none'
    tools: 'mock-only'
    persistence: 'none'
    binding: 'loopback'
  }
  evidenceRefs: string[]
}

export interface CreateLocalBenchmarkPlanInput {
  profile: LocalExecutionProfile
  proposal: LocalSetupProposal
  record: LocalSetupRecord
  suite: LocalBenchmarkSuite
  adapterId: string
  validatorId: string
  generatedAt: string
  validUntil: string
  iterations: number
  warmupIterations: number
  timeoutMs: number
  maximumTotalDurationMs: number
  evidenceRefs: string[]
}

export interface LocalBenchmarkPerformanceMetrics {
  startupMs: number | null
  firstTokenLatencyMs: number | null
  throughputTokensPerSecond: string | null
  stableContextTokens: number | null
  peakSystemMemoryBytes: string | null
  peakAcceleratorMemoryBytes: string | null
  sustainedThroughputRatio: string | null
  thermalState: 'nominal' | 'degraded' | 'unknown'
}

export interface LocalBenchmarkAdapterObservation {
  status: LocalBenchmarkSampleStatus
  startedAt: string
  finishedAt: string
  metrics: LocalBenchmarkPerformanceMetrics
  reasonCode?: string
  evidenceRefs: string[]
}

export interface LocalBenchmarkQualityCheck {
  kind: LocalBenchmarkQualityCheckKind
  status: LocalBenchmarkQualityCheckStatus
  evidenceRef: string
}

export interface LocalBenchmarkValidationResult {
  checks: LocalBenchmarkQualityCheck[]
  evidenceRefs: string[]
}

export interface LocalBenchmarkSample {
  id: string
  taskId: string
  taskClass: TaskCategory
  iteration: number
  warmup: boolean
  status: LocalBenchmarkSampleStatus
  startedAt: string
  finishedAt: string
  metrics: LocalBenchmarkPerformanceMetrics
  qualityChecks: LocalBenchmarkQualityCheck[]
  reasonCode?: string
  evidenceRefs: string[]
}

export interface LocalBenchmarkEvidence {
  schemaVersion: 1
  id: string
  planId: string
  binding: LocalBenchmarkBinding
  suiteId: string
  startedAt: string
  finishedAt: string
  samples: LocalBenchmarkSample[]
  evidenceRefs: string[]
}

export interface LocalBenchmarkAdapter {
  readonly id: string
  run(input: {
    plan: Readonly<LocalBenchmarkPlan>
    task: Readonly<LocalBenchmarkTask>
    iteration: number
    warmup: boolean
    idempotencyKey: string
  }): Promise<LocalBenchmarkAdapterObservation> | LocalBenchmarkAdapterObservation
}

export interface LocalBenchmarkValidator {
  readonly id: string
  validate(input: {
    plan: Readonly<LocalBenchmarkPlan>
    task: Readonly<LocalBenchmarkTask>
    observation: Readonly<LocalBenchmarkAdapterObservation>
  }): Promise<LocalBenchmarkValidationResult> | LocalBenchmarkValidationResult
}

export type LocalBenchmarkAppendResult = { status: 'accepted' | 'replayed'; evidenceId: string } | { status: 'rejected' }

export interface LocalBenchmarkHostAuthority {
  claimBenchmark(input: { plan: Readonly<LocalBenchmarkPlan>; setupId: string; setupRevision: number }): Promise<boolean> | boolean
  appendEvidence(evidence: Readonly<LocalBenchmarkEvidence>): Promise<LocalBenchmarkAppendResult> | LocalBenchmarkAppendResult
}

export interface RunLocalBenchmarkInput {
  plan: LocalBenchmarkPlan
  profile: LocalExecutionProfile
  proposal: LocalSetupProposal
  record: LocalSetupRecord
  suite: LocalBenchmarkSuite
  adapter: LocalBenchmarkAdapter
  validator: LocalBenchmarkValidator
  authority: LocalBenchmarkHostAuthority
  evaluatedAt: string
}

export class LocalBenchmarkContractError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid local benchmark contract: ${issues.join('; ')}`)
    this.name = 'LocalBenchmarkContractError'
    this.issues = [...issues]
  }
}

export class LocalBenchmarkLifecycleError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Local benchmark lifecycle failed: ${code}`)
    this.name = 'LocalBenchmarkLifecycleError'
    this.code = code
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

function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

function byteString(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value) || value.length > 20) return false
  try {
    return BigInt(value) <= MAX_BYTES
  } catch {
    return false
  }
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && POSITIVE_DECIMAL.test(value)
}

function ratio(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && RATIO.test(value)
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function canonicalReferences(value: readonly string[]): string[] {
  return [...new Set(value)].sort()
}

function validateReferences(value: unknown, label: string, issues: string[], allowEmpty = true): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS || !value.every(safeReference) || new Set(value).size !== value.length) {
    issues.push(`${label} must contain bounded unique safe references`)
    return false
  }
  if (!allowEmpty && value.length === 0) issues.push(`${label} must not be empty`)
  if (JSON.stringify(value) !== JSON.stringify([...value].sort())) issues.push(`${label} must be canonical`)
  return true
}

function canonicalTask(task: LocalBenchmarkTask): LocalBenchmarkTask {
  return { ...task, requiredChecks: [...new Set(task.requiredChecks)].sort() }
}

function validateTask(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(value, ['id', 'taskClass', 'contextTokens', 'maxOutputTokens', 'requiredChecks'], label, issues)
  if (!safeReference(value.id)) issues.push(`${label}.id must be a safe reference`)
  if (!TASK_CLASSES.includes(value.taskClass as TaskCategory)) issues.push(`${label}.taskClass is unsupported`)
  if (!boundedInteger(value.contextTokens, 1, 2_000_000)) issues.push(`${label}.contextTokens must be a bounded positive integer`)
  if (!boundedInteger(value.maxOutputTokens, 1, 1_000_000)) issues.push(`${label}.maxOutputTokens must be a bounded positive integer`)
  if (
    !Array.isArray(value.requiredChecks) ||
    value.requiredChecks.length === 0 ||
    value.requiredChecks.length > QUALITY_CHECKS.length ||
    !value.requiredChecks.every((entry) => QUALITY_CHECKS.includes(entry as LocalBenchmarkQualityCheckKind)) ||
    JSON.stringify(value.requiredChecks) !== JSON.stringify([...new Set(value.requiredChecks)].sort())
  )
    issues.push(`${label}.requiredChecks must contain canonical unique quality checks`)
}

export function createLocalBenchmarkSuite(input: CreateLocalBenchmarkSuiteInput): LocalBenchmarkSuite {
  const withoutId: Omit<LocalBenchmarkSuite, 'id'> = {
    schemaVersion: 1,
    version: input.version,
    corpusSha256: input.corpusSha256,
    validatorVersion: input.validatorVersion,
    tasks: input.tasks.map(canonicalTask).sort((left, right) => left.id.localeCompare(right.id)),
    evidenceRefs: canonicalReferences(input.evidenceRefs)
  }
  const suite = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalBenchmarkSuite(suite)
  return freeze(suite)
}

export function assertLocalBenchmarkSuite(value: unknown): asserts value is LocalBenchmarkSuite {
  const issues: string[] = []
  if (!object(value)) throw new LocalBenchmarkContractError(['suite must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'version', 'corpusSha256', 'validatorVersion', 'tasks', 'evidenceRefs'], 'suite', issues)
  if (value.schemaVersion !== 1) issues.push('suite.schemaVersion must be 1')
  if (!fingerprint(value.id)) issues.push('suite.id must be a fingerprint')
  if (!safeComponent(value.version)) issues.push('suite.version must be a safe component')
  if (!fingerprint(value.corpusSha256)) issues.push('suite.corpusSha256 must be a lowercase SHA-256 digest')
  if (!safeComponent(value.validatorVersion)) issues.push('suite.validatorVersion must be a safe component')
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > MAX_TASKS) issues.push(`suite.tasks must contain 1-${MAX_TASKS} tasks`)
  else {
    value.tasks.forEach((task, index) => validateTask(task, `suite.tasks[${index}]`, issues))
    const ids = value.tasks.map((task) => (object(task) ? task.id : undefined))
    if (new Set(ids).size !== ids.length) issues.push('suite.tasks must have unique IDs')
    if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) issues.push('suite.tasks must be canonical')
  }
  validateReferences(value.evidenceRefs, 'suite.evidenceRefs', issues, false)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('suite.id does not match its canonical content')
  }
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function profileCandidate(profile: LocalExecutionProfile): LocalExecutionProfileCandidate {
  return {
    schemaVersion: 1,
    runtime: { ...profile.runtime },
    artifact: { ...profile.artifact },
    configuration: { ...profile.configuration },
    resources: {
      artifactDownloadBytes: profile.resources.artifactDownloadBytes,
      installedDiskBytes: profile.resources.installedDiskBytes,
      systemMemoryBytes: profile.resources.systemMemoryBytes,
      acceleratorMemoryBytes: profile.resources.acceleratorMemoryBytes,
      memoryPool: profile.resources.memoryPool
    },
    performance: { ...profile.performance },
    suitability: profile.suitability.map((entry) => ({ ...entry })),
    availability: { ...profile.availability },
    evidenceRefs: [...profile.evidenceRefs]
  }
}

function assertProfile(profile: LocalExecutionProfile): void {
  const candidate = profileCandidate(profile)
  try {
    assertLocalExecutionProfileCandidate(candidate)
  } catch {
    throw new LocalBenchmarkContractError(['profile must be a valid local execution profile'])
  }
  if (localExecutionProfileId(candidate) !== profile.id) throw new LocalBenchmarkContractError(['profile ID does not match its runtime, artifact, and configuration'])
  if (!safeComponent(profile.adapterId) || !safeComponent(profile.sourceId)) throw new LocalBenchmarkContractError(['profile adapter and source IDs must be safe components'])
  if (!fingerprint(profile.hostSnapshotId) || !fingerprint(profile.policyId)) throw new LocalBenchmarkContractError(['profile host and policy IDs must be fingerprints'])
  for (const field of ['requiredDiskWithHeadroomBytes', 'requiredSystemMemoryWithHeadroomBytes', 'requiredAcceleratorMemoryWithHeadroomBytes'] as const)
    if (!byteString(profile.resources[field])) throw new LocalBenchmarkContractError([`profile.resources.${field} must be an exact byte string`])
}

function benchmarkBinding(profile: LocalExecutionProfile, proposal: LocalSetupProposal, record: LocalSetupRecord): LocalBenchmarkBinding {
  return {
    setupId: record.id,
    setupRevision: record.revision,
    proposalId: proposal.id,
    profileId: profile.id,
    hostSnapshotId: profile.hostSnapshotId,
    profilePolicyId: profile.policyId,
    runtimeId: profile.runtime.runtimeId,
    runtimeSourceRevision: proposal.runtime.sourceRevision,
    artifactId: profile.artifact.artifactId,
    artifactRevision: profile.artifact.revision,
    artifactSha256: profile.artifact.sha256,
    artifactFormat: profile.artifact.format,
    quantization: profile.artifact.quantization,
    contextTokens: profile.configuration.contextTokens,
    maxOutputTokens: profile.configuration.maxOutputTokens,
    concurrency: profile.configuration.concurrency
  }
}

function assertReadySetup(profile: LocalExecutionProfile, proposal: LocalSetupProposal, record: LocalSetupRecord): void {
  assertProfile(profile)
  assertLocalSetupProposal(proposal)
  assertLocalSetupRecord(record)
  const issues: string[] = []
  if (record.state !== 'ready') issues.push('setup record must be ready')
  if (proposal.profileId !== profile.id || record.profileId !== profile.id) issues.push('setup and proposal must match the profile')
  if (proposal.hostSnapshotId !== profile.hostSnapshotId) issues.push('proposal host must match the profile host')
  if (record.proposalId !== proposal.id || record.storageRootRef !== proposal.storage.rootRef) issues.push('setup record must match the proposal')
  if (proposal.runtime.runtimeId !== profile.runtime.runtimeId) issues.push('runtime must match the profile')
  if (proposal.model.artifactId !== profile.artifact.artifactId || proposal.model.sourceRevision !== profile.artifact.revision || proposal.model.sha256 !== profile.artifact.sha256)
    issues.push('model artifact must match the profile')
  const activeModel = record.resources.find((resource) => resource.kind === 'model' && resource.sha256 === profile.artifact.sha256)
  if (!activeModel) issues.push('ready setup must contain the verified model resource')
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function validateBinding(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  const fields = [
    'setupId',
    'setupRevision',
    'proposalId',
    'profileId',
    'hostSnapshotId',
    'profilePolicyId',
    'runtimeId',
    'runtimeSourceRevision',
    'artifactId',
    'artifactRevision',
    'artifactSha256',
    'artifactFormat',
    'quantization',
    'contextTokens',
    'maxOutputTokens',
    'concurrency'
  ]
  exactFields(value, fields, label, issues)
  for (const field of ['setupId', 'proposalId', 'profileId', 'hostSnapshotId', 'profilePolicyId', 'artifactSha256'])
    if (!fingerprint(value[field])) issues.push(`${label}.${field} must be a fingerprint`)
  if (!boundedInteger(value.setupRevision, 0, Number.MAX_SAFE_INTEGER)) issues.push(`${label}.setupRevision must be a non-negative safe integer`)
  for (const field of ['runtimeId', 'runtimeSourceRevision', 'artifactId', 'artifactRevision', 'artifactFormat', 'quantization'])
    if (!safeComponent(value[field])) issues.push(`${label}.${field} must be a safe component`)
  for (const field of ['contextTokens', 'maxOutputTokens', 'concurrency']) if (!boundedInteger(value[field], 1, 2_000_000)) issues.push(`${label}.${field} must be a bounded positive integer`)
}

export function createLocalBenchmarkPlan(input: CreateLocalBenchmarkPlanInput): LocalBenchmarkPlan {
  assertReadySetup(input.profile, input.proposal, input.record)
  assertLocalBenchmarkSuite(input.suite)
  const issues: string[] = []
  if (!safeComponent(input.adapterId) || !safeComponent(input.validatorId)) issues.push('adapter and validator IDs must be safe components')
  if (!timestamp(input.generatedAt) || !timestamp(input.validUntil) || Date.parse(input.validUntil) <= Date.parse(input.generatedAt))
    issues.push('plan timestamps must define a positive canonical UTC validity window')
  if (timestamp(input.generatedAt) && Date.parse(input.generatedAt) < Date.parse(input.record.updatedAt)) issues.push('plan cannot predate the ready setup')
  if (
    timestamp(input.generatedAt) &&
    (Date.parse(input.profile.availability.observedAt) > Date.parse(input.generatedAt) || Date.parse(input.profile.availability.validUntil) <= Date.parse(input.generatedAt))
  )
    issues.push('profile availability must be current when the plan is created')
  if (!boundedInteger(input.iterations, 1, MAX_ITERATIONS)) issues.push(`iterations must be between 1 and ${MAX_ITERATIONS}`)
  if (!boundedInteger(input.warmupIterations, 0, MAX_WARMUP_ITERATIONS)) issues.push(`warmupIterations must be between 0 and ${MAX_WARMUP_ITERATIONS}`)
  if (!boundedInteger(input.timeoutMs, 1, MAX_TIMEOUT_MS)) issues.push(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`)
  if (!boundedInteger(input.maximumTotalDurationMs, 1, MAX_TOTAL_DURATION_MS) || input.maximumTotalDurationMs < input.timeoutMs)
    issues.push('maximumTotalDurationMs must be bounded and at least timeoutMs')
  for (const task of input.suite.tasks) {
    if (task.contextTokens > input.profile.configuration.contextTokens) issues.push(`task ${task.id} exceeds the profile context limit`)
    if (task.maxOutputTokens > input.profile.configuration.maxOutputTokens) issues.push(`task ${task.id} exceeds the profile output limit`)
  }
  const evidenceRefs = canonicalReferences(input.evidenceRefs)
  validateReferences(evidenceRefs, 'plan.evidenceRefs', issues, false)
  if (issues.length) throw new LocalBenchmarkContractError(issues)
  const withoutId: Omit<LocalBenchmarkPlan, 'id'> = {
    schemaVersion: 1,
    binding: benchmarkBinding(input.profile, input.proposal, input.record),
    suiteId: input.suite.id,
    adapterId: input.adapterId,
    validatorId: input.validatorId,
    generatedAt: input.generatedAt,
    validUntil: input.validUntil,
    execution: {
      iterations: input.iterations,
      warmupIterations: input.warmupIterations,
      timeoutMs: input.timeoutMs,
      maximumTotalDurationMs: input.maximumTotalDurationMs
    },
    isolation: {
      corpus: 'synthetic-only',
      network: 'disabled',
      repositoryAccess: 'none',
      tools: 'mock-only',
      persistence: 'none',
      binding: 'loopback'
    },
    evidenceRefs
  }
  const plan = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalBenchmarkPlan(plan)
  return freeze(plan)
}

export function assertLocalBenchmarkPlan(value: unknown): asserts value is LocalBenchmarkPlan {
  const issues: string[] = []
  if (!object(value)) throw new LocalBenchmarkContractError(['plan must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'binding', 'suiteId', 'adapterId', 'validatorId', 'generatedAt', 'validUntil', 'execution', 'isolation', 'evidenceRefs'], 'plan', issues)
  if (value.schemaVersion !== 1) issues.push('plan.schemaVersion must be 1')
  if (!fingerprint(value.id)) issues.push('plan.id must be a fingerprint')
  validateBinding(value.binding, 'plan.binding', issues)
  if (!fingerprint(value.suiteId)) issues.push('plan.suiteId must be a fingerprint')
  if (!safeComponent(value.adapterId) || !safeComponent(value.validatorId)) issues.push('plan adapter and validator IDs must be safe components')
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.generatedAt))) issues.push('plan timestamps are invalid')
  if (!object(value.execution)) issues.push('plan.execution must be an object')
  else {
    exactFields(value.execution, ['iterations', 'warmupIterations', 'timeoutMs', 'maximumTotalDurationMs'], 'plan.execution', issues)
    if (!boundedInteger(value.execution.iterations, 1, MAX_ITERATIONS)) issues.push('plan.execution.iterations is invalid')
    if (!boundedInteger(value.execution.warmupIterations, 0, MAX_WARMUP_ITERATIONS)) issues.push('plan.execution.warmupIterations is invalid')
    if (!boundedInteger(value.execution.timeoutMs, 1, MAX_TIMEOUT_MS)) issues.push('plan.execution.timeoutMs is invalid')
    if (!boundedInteger(value.execution.maximumTotalDurationMs, 1, MAX_TOTAL_DURATION_MS) || Number(value.execution.maximumTotalDurationMs) < Number(value.execution.timeoutMs))
      issues.push('plan.execution.maximumTotalDurationMs is invalid')
  }
  if (!object(value.isolation)) issues.push('plan.isolation must be an object')
  else {
    exactFields(value.isolation, ['corpus', 'network', 'repositoryAccess', 'tools', 'persistence', 'binding'], 'plan.isolation', issues)
    const expected = { corpus: 'synthetic-only', network: 'disabled', repositoryAccess: 'none', tools: 'mock-only', persistence: 'none', binding: 'loopback' }
    for (const [field, expectedValue] of Object.entries(expected)) if (value.isolation[field] !== expectedValue) issues.push(`plan.isolation.${field} must be ${expectedValue}`)
  }
  validateReferences(value.evidenceRefs, 'plan.evidenceRefs', issues, false)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('plan.id does not match its canonical content')
  }
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function emptyMetrics(): LocalBenchmarkPerformanceMetrics {
  return {
    startupMs: null,
    firstTokenLatencyMs: null,
    throughputTokensPerSecond: null,
    stableContextTokens: null,
    peakSystemMemoryBytes: null,
    peakAcceleratorMemoryBytes: null,
    sustainedThroughputRatio: null,
    thermalState: 'unknown'
  }
}

function validateMetrics(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  const fields = [
    'startupMs',
    'firstTokenLatencyMs',
    'throughputTokensPerSecond',
    'stableContextTokens',
    'peakSystemMemoryBytes',
    'peakAcceleratorMemoryBytes',
    'sustainedThroughputRatio',
    'thermalState'
  ]
  exactFields(value, fields, label, issues)
  for (const field of ['startupMs', 'firstTokenLatencyMs'])
    if (value[field] !== null && !boundedInteger(value[field], 0, MAX_TIMEOUT_MS)) issues.push(`${label}.${field} must be null or bounded milliseconds`)
  if (value.throughputTokensPerSecond !== null && !positiveDecimal(value.throughputTokensPerSecond)) issues.push(`${label}.throughputTokensPerSecond must be null or a positive decimal string`)
  if (value.stableContextTokens !== null && !boundedInteger(value.stableContextTokens, 0, 2_000_000)) issues.push(`${label}.stableContextTokens must be null or bounded tokens`)
  for (const field of ['peakSystemMemoryBytes', 'peakAcceleratorMemoryBytes'])
    if (value[field] !== null && !byteString(value[field])) issues.push(`${label}.${field} must be null or an exact byte string`)
  if (value.sustainedThroughputRatio !== null && !ratio(value.sustainedThroughputRatio)) issues.push(`${label}.sustainedThroughputRatio must be null or a decimal ratio from 0 to 1`)
  if (!['nominal', 'degraded', 'unknown'].includes(String(value.thermalState))) issues.push(`${label}.thermalState is unsupported`)
}

function validateObservation(value: unknown, timeoutMs: number): asserts value is LocalBenchmarkAdapterObservation {
  const issues: string[] = []
  if (!object(value)) throw new LocalBenchmarkContractError(['adapter observation must be an object'])
  exactFields(value, ['status', 'startedAt', 'finishedAt', 'metrics', 'reasonCode', 'evidenceRefs'], 'adapter observation', issues)
  if (!SAMPLE_STATUSES.includes(value.status as LocalBenchmarkSampleStatus)) issues.push('adapter observation.status is unsupported')
  if (!timestamp(value.startedAt) || !timestamp(value.finishedAt) || Date.parse(String(value.finishedAt)) < Date.parse(String(value.startedAt)))
    issues.push('adapter observation timestamps are invalid')
  else if (Date.parse(String(value.finishedAt)) - Date.parse(String(value.startedAt)) > timeoutMs) issues.push('adapter observation exceeds the plan timeout')
  validateMetrics(value.metrics, 'adapter observation.metrics', issues)
  if (value.status === 'completed' && value.reasonCode !== undefined) issues.push('completed adapter observation cannot have a reason code')
  if (value.status !== 'completed' && !safeComponent(value.reasonCode)) issues.push('non-completed adapter observation requires a safe reason code')
  validateReferences(value.evidenceRefs, 'adapter observation.evidenceRefs', issues)
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function validateQualityChecks(value: unknown, task: LocalBenchmarkTask, issues: string[]): value is LocalBenchmarkQualityCheck[] {
  if (!Array.isArray(value) || value.length !== task.requiredChecks.length) {
    issues.push('validator checks must cover every required task check')
    return false
  }
  for (const [index, check] of value.entries()) {
    const label = `validator checks[${index}]`
    if (!object(check)) {
      issues.push(`${label} must be an object`)
      continue
    }
    exactFields(check, ['kind', 'status', 'evidenceRef'], label, issues)
    if (!QUALITY_CHECKS.includes(check.kind as LocalBenchmarkQualityCheckKind)) issues.push(`${label}.kind is unsupported`)
    if (!['passed', 'failed', 'unknown'].includes(String(check.status))) issues.push(`${label}.status is unsupported`)
    if (!safeReference(check.evidenceRef)) issues.push(`${label}.evidenceRef must be a safe reference`)
  }
  const kinds = value.map((check) => (object(check) ? check.kind : undefined))
  if (JSON.stringify(kinds) !== JSON.stringify(task.requiredChecks)) issues.push('validator checks must be canonical and match the task requirements')
  return issues.length === 0
}

function validateValidationResult(value: unknown, task: LocalBenchmarkTask): asserts value is LocalBenchmarkValidationResult {
  const issues: string[] = []
  if (!object(value)) throw new LocalBenchmarkContractError(['validator result must be an object'])
  exactFields(value, ['checks', 'evidenceRefs'], 'validator result', issues)
  validateQualityChecks(value.checks, task, issues)
  validateReferences(value.evidenceRefs, 'validator result.evidenceRefs', issues)
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function validateSample(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(value, ['id', 'taskId', 'taskClass', 'iteration', 'warmup', 'status', 'startedAt', 'finishedAt', 'metrics', 'qualityChecks', 'reasonCode', 'evidenceRefs'], label, issues)
  if (!fingerprint(value.id)) issues.push(`${label}.id must be a fingerprint`)
  if (!safeReference(value.taskId)) issues.push(`${label}.taskId must be a safe reference`)
  if (!TASK_CLASSES.includes(value.taskClass as TaskCategory)) issues.push(`${label}.taskClass is unsupported`)
  if (!boundedInteger(value.iteration, 0, MAX_ITERATIONS - 1)) issues.push(`${label}.iteration is invalid`)
  if (typeof value.warmup !== 'boolean') issues.push(`${label}.warmup must be boolean`)
  if (!SAMPLE_STATUSES.includes(value.status as LocalBenchmarkSampleStatus)) issues.push(`${label}.status is unsupported`)
  if (!timestamp(value.startedAt) || !timestamp(value.finishedAt) || Date.parse(String(value.finishedAt)) < Date.parse(String(value.startedAt))) issues.push(`${label} timestamps are invalid`)
  validateMetrics(value.metrics, `${label}.metrics`, issues)
  if (!Array.isArray(value.qualityChecks) || value.qualityChecks.length > QUALITY_CHECKS.length) issues.push(`${label}.qualityChecks is invalid`)
  else {
    for (const [index, check] of value.qualityChecks.entries()) {
      if (!object(check)) {
        issues.push(`${label}.qualityChecks[${index}] must be an object`)
        continue
      }
      exactFields(check, ['kind', 'status', 'evidenceRef'], `${label}.qualityChecks[${index}]`, issues)
      if (!QUALITY_CHECKS.includes(check.kind as LocalBenchmarkQualityCheckKind)) issues.push(`${label}.qualityChecks[${index}].kind is unsupported`)
      if (!['passed', 'failed', 'unknown'].includes(String(check.status))) issues.push(`${label}.qualityChecks[${index}].status is unsupported`)
      if (!safeReference(check.evidenceRef)) issues.push(`${label}.qualityChecks[${index}].evidenceRef is unsafe`)
    }
    const kinds = value.qualityChecks.map((check) => (object(check) ? check.kind : undefined))
    if (new Set(kinds).size !== kinds.length || JSON.stringify(kinds) !== JSON.stringify([...kinds].sort())) issues.push(`${label}.qualityChecks must be canonical and unique`)
  }
  if (value.status === 'completed' && value.reasonCode !== undefined) issues.push(`${label} completed sample cannot have a reason code`)
  if (value.status !== 'completed' && !safeComponent(value.reasonCode)) issues.push(`${label} non-completed sample requires a safe reason code`)
  validateReferences(value.evidenceRefs, `${label}.evidenceRefs`, issues)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push(`${label}.id does not match its canonical content`)
  }
}

export function assertLocalBenchmarkEvidence(value: unknown): asserts value is LocalBenchmarkEvidence {
  const issues: string[] = []
  if (!object(value)) throw new LocalBenchmarkContractError(['benchmark evidence must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'planId', 'binding', 'suiteId', 'startedAt', 'finishedAt', 'samples', 'evidenceRefs'], 'benchmark evidence', issues)
  if (value.schemaVersion !== 1) issues.push('benchmark evidence.schemaVersion must be 1')
  for (const field of ['id', 'planId', 'suiteId']) if (!fingerprint(value[field])) issues.push(`benchmark evidence.${field} must be a fingerprint`)
  validateBinding(value.binding, 'benchmark evidence.binding', issues)
  if (!timestamp(value.startedAt) || !timestamp(value.finishedAt) || Date.parse(String(value.finishedAt)) < Date.parse(String(value.startedAt)))
    issues.push('benchmark evidence timestamps are invalid')
  if (!Array.isArray(value.samples) || value.samples.length === 0 || value.samples.length > MAX_TASKS * (MAX_ITERATIONS + MAX_WARMUP_ITERATIONS)) issues.push('benchmark evidence.samples is invalid')
  else {
    value.samples.forEach((sample, index) => validateSample(sample, `benchmark evidence.samples[${index}]`, issues))
    const ids = value.samples.map((sample) => (object(sample) ? sample.id : undefined))
    if (new Set(ids).size !== ids.length) issues.push('benchmark evidence samples must have unique IDs')
  }
  validateReferences(value.evidenceRefs, 'benchmark evidence.evidenceRefs', issues, false)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('benchmark evidence.id does not match its canonical content')
  }
  if (issues.length) throw new LocalBenchmarkContractError(issues)
}

function failedObservation(at: string, reasonCode: string): LocalBenchmarkAdapterObservation {
  return { status: 'failed', startedAt: at, finishedAt: at, metrics: emptyMetrics(), reasonCode, evidenceRefs: [] }
}

function unknownChecks(task: LocalBenchmarkTask): LocalBenchmarkQualityCheck[] {
  return task.requiredChecks.map((kind) => ({ kind, status: 'unknown', evidenceRef: 'validation:not-run' }))
}

function createSample(
  task: LocalBenchmarkTask,
  iteration: number,
  warmup: boolean,
  observation: LocalBenchmarkAdapterObservation,
  validation: LocalBenchmarkValidationResult | null
): LocalBenchmarkSample {
  const qualityChecks = validation?.checks.map((check) => ({ ...check })) ?? unknownChecks(task)
  const evidenceRefs = canonicalReferences([...observation.evidenceRefs, ...(validation?.evidenceRefs ?? []), ...qualityChecks.map((check) => check.evidenceRef)])
  const withoutId: Omit<LocalBenchmarkSample, 'id'> = {
    taskId: task.id,
    taskClass: task.taskClass,
    iteration,
    warmup,
    status: observation.status,
    startedAt: observation.startedAt,
    finishedAt: observation.finishedAt,
    metrics: { ...observation.metrics },
    qualityChecks,
    ...(observation.reasonCode ? { reasonCode: observation.reasonCode } : {}),
    evidenceRefs
  }
  return freeze({ id: stableFingerprint(withoutId), ...withoutId })
}

function assertRuntimeBinding(input: RunLocalBenchmarkInput): void {
  assertLocalBenchmarkPlan(input.plan)
  assertLocalBenchmarkSuite(input.suite)
  assertReadySetup(input.profile, input.proposal, input.record)
  if (!timestamp(input.evaluatedAt)) throw new LocalBenchmarkLifecycleError('invalid-evaluation-time')
  if (Date.parse(input.evaluatedAt) < Date.parse(input.plan.generatedAt) || Date.parse(input.evaluatedAt) >= Date.parse(input.plan.validUntil))
    throw new LocalBenchmarkLifecycleError('benchmark-plan-expired')
  if (input.suite.id !== input.plan.suiteId) throw new LocalBenchmarkLifecycleError('benchmark-suite-mismatch')
  if (input.adapter.id !== input.plan.adapterId || input.validator.id !== input.plan.validatorId) throw new LocalBenchmarkLifecycleError('benchmark-adapter-mismatch')
  const currentBinding = benchmarkBinding(input.profile, input.proposal, input.record)
  if (stableFingerprint(currentBinding) !== stableFingerprint(input.plan.binding)) throw new LocalBenchmarkLifecycleError('benchmark-binding-stale')
}

export async function runLocalBenchmark(input: RunLocalBenchmarkInput): Promise<LocalBenchmarkEvidence> {
  assertRuntimeBinding(input)
  let claimed = false
  try {
    claimed = (await input.authority.claimBenchmark({ plan: input.plan, setupId: input.record.id, setupRevision: input.record.revision })) === true
  } catch {
    throw new LocalBenchmarkLifecycleError('benchmark-authority-failed')
  }
  if (!claimed) throw new LocalBenchmarkLifecycleError('benchmark-claim-rejected')

  const samples: LocalBenchmarkSample[] = []
  for (const task of input.suite.tasks) {
    const total = input.plan.execution.warmupIterations + input.plan.execution.iterations
    for (let ordinal = 0; ordinal < total; ordinal++) {
      const warmup = ordinal < input.plan.execution.warmupIterations
      const iteration = warmup ? ordinal : ordinal - input.plan.execution.warmupIterations
      const idempotencyKey = stableFingerprint({ planId: input.plan.id, taskId: task.id, iteration, warmup })
      let observation: LocalBenchmarkAdapterObservation
      try {
        const candidate = await input.adapter.run({ plan: input.plan, task, iteration, warmup, idempotencyKey })
        try {
          validateObservation(candidate, input.plan.execution.timeoutMs)
          observation = freeze({ ...candidate, metrics: { ...candidate.metrics }, evidenceRefs: canonicalReferences(candidate.evidenceRefs) })
        } catch {
          observation = failedObservation(input.evaluatedAt, 'invalid-adapter-observation')
        }
      } catch {
        observation = failedObservation(input.evaluatedAt, 'adapter-failed')
      }

      let validation: LocalBenchmarkValidationResult | null = null
      if (observation.status === 'completed') {
        try {
          const candidate = await input.validator.validate({ plan: input.plan, task, observation })
          validateValidationResult(candidate, task)
          validation = freeze({
            checks: candidate.checks.map((check) => ({ ...check })),
            evidenceRefs: canonicalReferences(candidate.evidenceRefs)
          })
        } catch {
          observation = failedObservation(observation.finishedAt, 'validator-failed')
        }
      }
      samples.push(createSample(task, iteration, warmup, observation, validation))
    }
  }

  const startedAt = samples.reduce((earliest, sample) => (sample.startedAt < earliest ? sample.startedAt : earliest), samples[0].startedAt)
  const finishedAt = samples.reduce((latest, sample) => (sample.finishedAt > latest ? sample.finishedAt : latest), samples[0].finishedAt)
  if (Date.parse(finishedAt) - Date.parse(startedAt) > input.plan.execution.maximumTotalDurationMs) throw new LocalBenchmarkLifecycleError('benchmark-duration-exceeded')
  const evidenceRefs = canonicalReferences([...input.plan.evidenceRefs, ...input.suite.evidenceRefs, ...samples.flatMap((sample) => sample.evidenceRefs)])
  const withoutId: Omit<LocalBenchmarkEvidence, 'id'> = {
    schemaVersion: 1,
    planId: input.plan.id,
    binding: { ...input.plan.binding },
    suiteId: input.suite.id,
    startedAt,
    finishedAt,
    samples,
    evidenceRefs
  }
  const evidence = freeze({ id: stableFingerprint(withoutId), ...withoutId })
  assertLocalBenchmarkEvidence(evidence)
  let append: LocalBenchmarkAppendResult
  try {
    append = await input.authority.appendEvidence(evidence)
  } catch {
    throw new LocalBenchmarkLifecycleError('benchmark-evidence-store-failed')
  }
  if (!object(append) || !['accepted', 'replayed', 'rejected'].includes(String(append.status))) throw new LocalBenchmarkLifecycleError('invalid-authority-result')
  if (append.status === 'rejected') throw new LocalBenchmarkLifecycleError('benchmark-evidence-rejected')
  if (append.evidenceId !== evidence.id) throw new LocalBenchmarkLifecycleError('benchmark-evidence-conflict')
  return evidence
}
