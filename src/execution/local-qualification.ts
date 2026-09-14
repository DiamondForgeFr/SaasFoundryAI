import { ExactRational } from './exact-cost'
import {
  assertLocalBenchmarkBinding,
  assertLocalBenchmarkEvidence,
  assertLocalBenchmarkPlan,
  assertLocalBenchmarkSuite,
  type LocalBenchmarkCurrentState,
  type LocalBenchmarkEvidence,
  type LocalBenchmarkPlan,
  type LocalBenchmarkQualityCheckKind,
  type LocalBenchmarkSample,
  type LocalBenchmarkSuite
} from './local-benchmark'
import { stableFingerprint } from './overrides'
import { type TaskCategory } from './requirements'

const COMPONENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,191}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const RATIO = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/
const INTEGER = /^(?:0|[1-9]\d*)$/
const MAX_BYTES = 2n ** 64n - 1n
const MAX_REFERENCES = 128
const TASK_CLASSES: TaskCategory[] = ['mechanical', 'implementation', 'architecture', 'security', 'data-sensitive']
const QUALITY_CHECKS: LocalBenchmarkQualityCheckKind[] = ['code-correctness', 'instruction-adherence', 'structured-output', 'tool-use']
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i

export interface LocalQualificationThreshold {
  taskClass: TaskCategory
  minimumCompletedSamples: number
  maximumFailureRatio: string
  maximumStartupP95Ms: number
  maximumFirstTokenLatencyP95Ms: number
  minimumThroughputMedianTokensPerSecond: string
  minimumStableContextTokens: number
  maximumPeakSystemMemoryBytes: string
  maximumPeakAcceleratorMemoryBytes: string
  minimumSustainedThroughputRatio: string
  rejectThermalDegradation: boolean
  requiredChecks: LocalBenchmarkQualityCheckKind[]
}

export interface LocalQualificationPolicy {
  schemaVersion: 1
  id: string
  version: string
  evaluatorVersion: string
  generatedAt: string
  validUntil: string
  thresholds: LocalQualificationThreshold[]
  evidenceRefs: string[]
}

export interface CreateLocalQualificationPolicyInput {
  version: string
  evaluatorVersion: string
  generatedAt: string
  validUntil: string
  thresholds: LocalQualificationThreshold[]
  evidenceRefs: string[]
}

export type LocalTaskClassQualificationStatus = 'qualified' | 'rejected' | 'inconclusive' | 'stale'
export type LocalCandidateQualificationStatus = LocalTaskClassQualificationStatus

export type LocalQualificationReasonCode =
  | 'no-task-evidence'
  | 'insufficient-completed-samples'
  | 'failure-ratio-exceeded'
  | 'required-metric-unknown'
  | 'quality-check-failed'
  | 'quality-check-unknown'
  | 'startup-p95-exceeded'
  | 'first-token-latency-p95-exceeded'
  | 'throughput-median-below-minimum'
  | 'stable-context-below-minimum'
  | 'system-memory-exceeded'
  | 'accelerator-memory-exceeded'
  | 'sustained-throughput-below-minimum'
  | 'thermal-degradation-observed'
  | 'plan-expired'
  | 'policy-expired'
  | 'benchmark-binding-stale'
  | 'benchmark-suite-stale'
  | 'benchmark-adapter-stale'
  | 'benchmark-validator-stale'
  | 'qualification-policy-stale'
  | 'benchmark-evidence-mismatch'

export interface LocalQualificationMetricsSummary {
  startupP95Ms: number | null
  firstTokenLatencyP95Ms: number | null
  throughputMedianTokensPerSecond: string | null
  stableContextMinimumTokens: number | null
  peakSystemMemoryMaximumBytes: string | null
  peakAcceleratorMemoryMaximumBytes: string | null
  sustainedThroughputMinimumRatio: string | null
  thermalDegradedSamples: number
  thermalUnknownSamples: number
}

export interface LocalTaskClassQualification {
  taskClass: TaskCategory
  status: LocalTaskClassQualificationStatus
  attemptedSamples: number
  completedSamples: number
  failedSamples: number
  failureRatio: { numerator: string; denominator: string } | null
  metrics: LocalQualificationMetricsSummary
  reasonCodes: LocalQualificationReasonCode[]
  sourceSampleIds: string[]
}

export interface LocalCandidateQualification {
  schemaVersion: 1
  id: string
  status: LocalCandidateQualificationStatus
  planId: string
  evidenceId: string
  suiteId: string
  qualificationPolicyId: string
  binding: LocalBenchmarkPlan['binding']
  generatedAt: string
  validUntil: string
  decisions: LocalTaskClassQualification[]
  reasonCodes: LocalQualificationReasonCode[]
  requiresRecommendation: boolean
  evidenceRefs: string[]
}

export interface QualifyLocalBenchmarkInput {
  plan: LocalBenchmarkPlan
  evidence: LocalBenchmarkEvidence
  suite: LocalBenchmarkSuite
  policy: LocalQualificationPolicy
  currentState: LocalBenchmarkCurrentState
  currentQualificationPolicyId: string
  evaluatedAt: string
}

export class LocalQualificationContractError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid local qualification contract: ${issues.join('; ')}`)
    this.name = 'LocalQualificationContractError'
    this.issues = [...issues]
  }
}

const REASON_CODES: LocalQualificationReasonCode[] = [
  'no-task-evidence',
  'insufficient-completed-samples',
  'failure-ratio-exceeded',
  'required-metric-unknown',
  'quality-check-failed',
  'quality-check-unknown',
  'startup-p95-exceeded',
  'first-token-latency-p95-exceeded',
  'throughput-median-below-minimum',
  'stable-context-below-minimum',
  'system-memory-exceeded',
  'accelerator-memory-exceeded',
  'sustained-throughput-below-minimum',
  'thermal-degradation-observed',
  'plan-expired',
  'policy-expired',
  'benchmark-binding-stale',
  'benchmark-suite-stale',
  'benchmark-adapter-stale',
  'benchmark-validator-stale',
  'qualification-policy-stale',
  'benchmark-evidence-mismatch'
]

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

function exactFields(value: Record<string, unknown>, fields: readonly string[], label: string, issues: string[]): void {
  for (const field of Object.keys(value)) if (!fields.includes(field)) issues.push(`${label}.${field} is not allowed`)
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function decimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && DECIMAL.test(value)
}

function ratio(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && RATIO.test(value)
}

function byteString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 20 || !INTEGER.test(value)) return false
  try {
    return BigInt(value) <= MAX_BYTES
  } catch {
    return false
  }
}

function canonical<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[]
}

function validateReferences(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REFERENCES || !value.every(safeReference) || JSON.stringify(value) !== JSON.stringify(canonical(value)))
    issues.push(`${label} must contain canonical unique safe references`)
}

function validateReasonCodes(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value) || !value.every((reason) => REASON_CODES.includes(reason as LocalQualificationReasonCode)) || JSON.stringify(value) !== JSON.stringify(canonical(value)))
    issues.push(`${label} must contain canonical unique qualification reasons`)
}

function canonicalThreshold(threshold: LocalQualificationThreshold): LocalQualificationThreshold {
  return { ...threshold, requiredChecks: canonical(threshold.requiredChecks) }
}

function validateThreshold(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(
    value,
    [
      'taskClass',
      'minimumCompletedSamples',
      'maximumFailureRatio',
      'maximumStartupP95Ms',
      'maximumFirstTokenLatencyP95Ms',
      'minimumThroughputMedianTokensPerSecond',
      'minimumStableContextTokens',
      'maximumPeakSystemMemoryBytes',
      'maximumPeakAcceleratorMemoryBytes',
      'minimumSustainedThroughputRatio',
      'rejectThermalDegradation',
      'requiredChecks'
    ],
    label,
    issues
  )
  if (!TASK_CLASSES.includes(value.taskClass as TaskCategory)) issues.push(`${label}.taskClass is unsupported`)
  if (!boundedInteger(value.minimumCompletedSamples, 1, 1024)) issues.push(`${label}.minimumCompletedSamples is invalid`)
  if (!ratio(value.maximumFailureRatio)) issues.push(`${label}.maximumFailureRatio is invalid`)
  if (!boundedInteger(value.maximumStartupP95Ms, 0, 3_600_000)) issues.push(`${label}.maximumStartupP95Ms is invalid`)
  if (!boundedInteger(value.maximumFirstTokenLatencyP95Ms, 0, 3_600_000)) issues.push(`${label}.maximumFirstTokenLatencyP95Ms is invalid`)
  if (!decimal(value.minimumThroughputMedianTokensPerSecond)) issues.push(`${label}.minimumThroughputMedianTokensPerSecond is invalid`)
  if (!boundedInteger(value.minimumStableContextTokens, 0, 2_000_000)) issues.push(`${label}.minimumStableContextTokens is invalid`)
  if (!byteString(value.maximumPeakSystemMemoryBytes)) issues.push(`${label}.maximumPeakSystemMemoryBytes is invalid`)
  if (!byteString(value.maximumPeakAcceleratorMemoryBytes)) issues.push(`${label}.maximumPeakAcceleratorMemoryBytes is invalid`)
  if (!ratio(value.minimumSustainedThroughputRatio)) issues.push(`${label}.minimumSustainedThroughputRatio is invalid`)
  if (typeof value.rejectThermalDegradation !== 'boolean') issues.push(`${label}.rejectThermalDegradation must be boolean`)
  if (
    !Array.isArray(value.requiredChecks) ||
    value.requiredChecks.length === 0 ||
    !value.requiredChecks.every((check) => QUALITY_CHECKS.includes(check as LocalBenchmarkQualityCheckKind)) ||
    JSON.stringify(value.requiredChecks) !== JSON.stringify(canonical(value.requiredChecks))
  )
    issues.push(`${label}.requiredChecks must contain canonical unique quality checks`)
}

export function createLocalQualificationPolicy(input: CreateLocalQualificationPolicyInput): LocalQualificationPolicy {
  const withoutId: Omit<LocalQualificationPolicy, 'id'> = {
    schemaVersion: 1,
    version: input.version,
    evaluatorVersion: input.evaluatorVersion,
    generatedAt: input.generatedAt,
    validUntil: input.validUntil,
    thresholds: input.thresholds.map(canonicalThreshold).sort((left, right) => left.taskClass.localeCompare(right.taskClass)),
    evidenceRefs: canonical(input.evidenceRefs)
  }
  const policy = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalQualificationPolicy(policy)
  return freeze(policy)
}

export function assertLocalQualificationPolicy(value: unknown): asserts value is LocalQualificationPolicy {
  const issues: string[] = []
  if (!object(value)) throw new LocalQualificationContractError(['policy must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'version', 'evaluatorVersion', 'generatedAt', 'validUntil', 'thresholds', 'evidenceRefs'], 'policy', issues)
  if (value.schemaVersion !== 1) issues.push('policy.schemaVersion must be 1')
  if (!FINGERPRINT.test(String(value.id))) issues.push('policy.id must be a fingerprint')
  if (!safeComponent(value.version) || !safeComponent(value.evaluatorVersion)) issues.push('policy version fields must be safe components')
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil) || Date.parse(String(value.validUntil)) <= Date.parse(String(value.generatedAt))) issues.push('policy timestamps are invalid')
  if (!Array.isArray(value.thresholds) || value.thresholds.length === 0 || value.thresholds.length > TASK_CLASSES.length) issues.push('policy.thresholds is invalid')
  else {
    value.thresholds.forEach((threshold, index) => validateThreshold(threshold, `policy.thresholds[${index}]`, issues))
    const classes = value.thresholds.map((threshold) => (object(threshold) ? threshold.taskClass : undefined))
    if (new Set(classes).size !== classes.length || JSON.stringify(classes) !== JSON.stringify([...classes].sort())) issues.push('policy thresholds must be canonical and unique by task class')
  }
  validateReferences(value.evidenceRefs, 'policy.evidenceRefs', issues)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('policy.id does not match its canonical content')
  }
  if (issues.length) throw new LocalQualificationContractError(issues)
}

function nearestRank<T>(values: readonly T[], quantile: number, compare: (left: T, right: T) => number): T | null {
  if (values.length === 0) return null
  const ordered = [...values].sort(compare)
  return ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)]
}

function exactCompare(left: string, right: string): number {
  return ExactRational.decimal(left).compare(ExactRational.decimal(right))
}

function maximumBytes(values: string[]): string | null {
  return values.length ? values.reduce((maximum, value) => (BigInt(value) > BigInt(maximum) ? value : maximum)) : null
}

function minimumDecimal(values: string[]): string | null {
  return values.length ? values.reduce((minimum, value) => (exactCompare(value, minimum) < 0 ? value : minimum)) : null
}

function failureRatioExceeds(failed: number, attempted: number, maximum: string): boolean {
  if (attempted === 0) return false
  return new ExactRational(BigInt(failed), BigInt(attempted)).compare(ExactRational.decimal(maximum)) > 0
}

function summarize(samples: LocalBenchmarkSample[]): LocalQualificationMetricsSummary {
  const completed = samples.filter((sample) => sample.status === 'completed')
  return {
    startupP95Ms: nearestRank(
      completed.flatMap((sample) => (sample.metrics.startupMs === null ? [] : [sample.metrics.startupMs])),
      0.95,
      (left, right) => left - right
    ),
    firstTokenLatencyP95Ms: nearestRank(
      completed.flatMap((sample) => (sample.metrics.firstTokenLatencyMs === null ? [] : [sample.metrics.firstTokenLatencyMs])),
      0.95,
      (left, right) => left - right
    ),
    throughputMedianTokensPerSecond: nearestRank(
      completed.flatMap((sample) => (sample.metrics.throughputTokensPerSecond === null ? [] : [sample.metrics.throughputTokensPerSecond])),
      0.5,
      exactCompare
    ),
    stableContextMinimumTokens: completed
      .flatMap((sample) => (sample.metrics.stableContextTokens === null ? [] : [sample.metrics.stableContextTokens]))
      .reduce<number | null>((minimum, value) => (minimum === null || value < minimum ? value : minimum), null),
    peakSystemMemoryMaximumBytes: maximumBytes(completed.flatMap((sample) => (sample.metrics.peakSystemMemoryBytes === null ? [] : [sample.metrics.peakSystemMemoryBytes]))),
    peakAcceleratorMemoryMaximumBytes: maximumBytes(completed.flatMap((sample) => (sample.metrics.peakAcceleratorMemoryBytes === null ? [] : [sample.metrics.peakAcceleratorMemoryBytes]))),
    sustainedThroughputMinimumRatio: minimumDecimal(completed.flatMap((sample) => (sample.metrics.sustainedThroughputRatio === null ? [] : [sample.metrics.sustainedThroughputRatio]))),
    thermalDegradedSamples: completed.filter((sample) => sample.metrics.thermalState === 'degraded').length,
    thermalUnknownSamples: completed.filter((sample) => sample.metrics.thermalState === 'unknown').length
  }
}

function evaluateThreshold(threshold: LocalQualificationThreshold, suite: LocalBenchmarkSuite, evidence: LocalBenchmarkEvidence): LocalTaskClassQualification {
  const taskIds = new Set(suite.tasks.filter((task) => task.taskClass === threshold.taskClass).map((task) => task.id))
  const samples = evidence.samples.filter((sample) => !sample.warmup && sample.taskClass === threshold.taskClass && taskIds.has(sample.taskId))
  const completed = samples.filter((sample) => sample.status === 'completed')
  const failed = samples.length - completed.length
  const metrics = summarize(samples)
  const rejection: LocalQualificationReasonCode[] = []
  const inconclusive: LocalQualificationReasonCode[] = []

  if (samples.length === 0) inconclusive.push('no-task-evidence')
  if (completed.length < threshold.minimumCompletedSamples) inconclusive.push('insufficient-completed-samples')
  if (failureRatioExceeds(failed, samples.length, threshold.maximumFailureRatio)) rejection.push('failure-ratio-exceeded')

  const requiredMetrics = [
    metrics.startupP95Ms,
    metrics.firstTokenLatencyP95Ms,
    metrics.throughputMedianTokensPerSecond,
    metrics.stableContextMinimumTokens,
    metrics.peakSystemMemoryMaximumBytes,
    metrics.peakAcceleratorMemoryMaximumBytes,
    metrics.sustainedThroughputMinimumRatio
  ]
  if (completed.length > 0 && requiredMetrics.some((metric) => metric === null)) inconclusive.push('required-metric-unknown')
  if (completed.some((sample) => threshold.requiredChecks.some((kind) => sample.qualityChecks.find((check) => check.kind === kind)?.status === 'failed'))) rejection.push('quality-check-failed')
  if (completed.some((sample) => threshold.requiredChecks.some((kind) => sample.qualityChecks.find((check) => check.kind === kind)?.status !== 'passed'))) inconclusive.push('quality-check-unknown')

  if (metrics.startupP95Ms !== null && metrics.startupP95Ms > threshold.maximumStartupP95Ms) rejection.push('startup-p95-exceeded')
  if (metrics.firstTokenLatencyP95Ms !== null && metrics.firstTokenLatencyP95Ms > threshold.maximumFirstTokenLatencyP95Ms) rejection.push('first-token-latency-p95-exceeded')
  if (metrics.throughputMedianTokensPerSecond !== null && exactCompare(metrics.throughputMedianTokensPerSecond, threshold.minimumThroughputMedianTokensPerSecond) < 0)
    rejection.push('throughput-median-below-minimum')
  if (metrics.stableContextMinimumTokens !== null && metrics.stableContextMinimumTokens < threshold.minimumStableContextTokens) rejection.push('stable-context-below-minimum')
  if (metrics.peakSystemMemoryMaximumBytes !== null && BigInt(metrics.peakSystemMemoryMaximumBytes) > BigInt(threshold.maximumPeakSystemMemoryBytes)) rejection.push('system-memory-exceeded')
  if (metrics.peakAcceleratorMemoryMaximumBytes !== null && BigInt(metrics.peakAcceleratorMemoryMaximumBytes) > BigInt(threshold.maximumPeakAcceleratorMemoryBytes))
    rejection.push('accelerator-memory-exceeded')
  if (metrics.sustainedThroughputMinimumRatio !== null && exactCompare(metrics.sustainedThroughputMinimumRatio, threshold.minimumSustainedThroughputRatio) < 0)
    rejection.push('sustained-throughput-below-minimum')
  if (threshold.rejectThermalDegradation && metrics.thermalDegradedSamples > 0) rejection.push('thermal-degradation-observed')

  const reasonCodes = canonical(rejection.length ? rejection : inconclusive)
  return freeze({
    taskClass: threshold.taskClass,
    status: rejection.length ? 'rejected' : inconclusive.length ? 'inconclusive' : 'qualified',
    attemptedSamples: samples.length,
    completedSamples: completed.length,
    failedSamples: failed,
    failureRatio: samples.length === 0 ? null : { numerator: String(failed), denominator: String(samples.length) },
    metrics,
    reasonCodes,
    sourceSampleIds: samples.map((sample) => sample.id).sort()
  })
}

function staleReasons(input: QualifyLocalBenchmarkInput): LocalQualificationReasonCode[] {
  const reasons: LocalQualificationReasonCode[] = []
  if (input.evidence.planId !== input.plan.id || input.evidence.suiteId !== input.plan.suiteId || stableFingerprint(input.evidence.binding) !== stableFingerprint(input.plan.binding))
    reasons.push('benchmark-evidence-mismatch')
  if (Date.parse(input.evaluatedAt) >= Date.parse(input.plan.validUntil)) reasons.push('plan-expired')
  if (Date.parse(input.evaluatedAt) >= Date.parse(input.policy.validUntil)) reasons.push('policy-expired')
  if (stableFingerprint(input.currentState.binding) !== stableFingerprint(input.plan.binding)) reasons.push('benchmark-binding-stale')
  if (input.currentState.suiteId !== input.plan.suiteId || input.suite.id !== input.plan.suiteId) reasons.push('benchmark-suite-stale')
  if (input.currentState.adapterId !== input.plan.adapterId) reasons.push('benchmark-adapter-stale')
  if (input.currentState.validatorId !== input.plan.validatorId) reasons.push('benchmark-validator-stale')
  if (input.currentQualificationPolicyId !== input.policy.id) reasons.push('qualification-policy-stale')
  return canonical(reasons)
}

export function qualifyLocalBenchmark(input: QualifyLocalBenchmarkInput): LocalCandidateQualification {
  assertLocalBenchmarkPlan(input.plan)
  assertLocalBenchmarkEvidence(input.evidence)
  assertLocalBenchmarkSuite(input.suite)
  assertLocalQualificationPolicy(input.policy)
  if (!timestamp(input.evaluatedAt) || Date.parse(input.evaluatedAt) < Date.parse(input.plan.generatedAt) || Date.parse(input.evaluatedAt) < Date.parse(input.policy.generatedAt))
    throw new LocalQualificationContractError(['evaluatedAt must be canonical and cannot predate the plan or policy'])
  if (!FINGERPRINT.test(input.currentQualificationPolicyId)) throw new LocalQualificationContractError(['current qualification policy ID must be a fingerprint'])

  const stale = staleReasons(input)
  let decisions = input.policy.thresholds.map((threshold) => evaluateThreshold(threshold, input.suite, input.evidence))
  if (stale.length) decisions = decisions.map((decision) => freeze({ ...decision, status: 'stale', reasonCodes: stale }))
  const status: LocalCandidateQualificationStatus = stale.length
    ? 'stale'
    : decisions.some((decision) => decision.status === 'qualified')
      ? 'qualified'
      : decisions.some((decision) => decision.status === 'inconclusive')
        ? 'inconclusive'
        : 'rejected'
  const reasonCodes = canonical(stale.length ? stale : decisions.flatMap((decision) => decision.reasonCodes))
  const validUntil = new Date(Math.min(Date.parse(input.plan.validUntil), Date.parse(input.policy.validUntil))).toISOString()
  const withoutId: Omit<LocalCandidateQualification, 'id'> = {
    schemaVersion: 1,
    status,
    planId: input.plan.id,
    evidenceId: input.evidence.id,
    suiteId: input.suite.id,
    qualificationPolicyId: input.policy.id,
    binding: { ...input.plan.binding },
    generatedAt: input.evaluatedAt,
    validUntil,
    decisions,
    reasonCodes,
    requiresRecommendation: status === 'stale',
    evidenceRefs: canonical([...input.evidence.evidenceRefs, ...input.policy.evidenceRefs])
  }
  const result = { id: stableFingerprint(withoutId), ...withoutId }
  assertLocalCandidateQualification(result)
  return freeze(result)
}

function validateMetricsSummary(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(
    value,
    [
      'startupP95Ms',
      'firstTokenLatencyP95Ms',
      'throughputMedianTokensPerSecond',
      'stableContextMinimumTokens',
      'peakSystemMemoryMaximumBytes',
      'peakAcceleratorMemoryMaximumBytes',
      'sustainedThroughputMinimumRatio',
      'thermalDegradedSamples',
      'thermalUnknownSamples'
    ],
    label,
    issues
  )
  for (const field of ['startupP95Ms', 'firstTokenLatencyP95Ms']) if (value[field] !== null && !boundedInteger(value[field], 0, 3_600_000)) issues.push(`${label}.${field} is invalid`)
  if (value.throughputMedianTokensPerSecond !== null && !decimal(value.throughputMedianTokensPerSecond)) issues.push(`${label}.throughputMedianTokensPerSecond is invalid`)
  if (value.stableContextMinimumTokens !== null && !boundedInteger(value.stableContextMinimumTokens, 0, 2_000_000)) issues.push(`${label}.stableContextMinimumTokens is invalid`)
  for (const field of ['peakSystemMemoryMaximumBytes', 'peakAcceleratorMemoryMaximumBytes']) if (value[field] !== null && !byteString(value[field])) issues.push(`${label}.${field} is invalid`)
  if (value.sustainedThroughputMinimumRatio !== null && !ratio(value.sustainedThroughputMinimumRatio)) issues.push(`${label}.sustainedThroughputMinimumRatio is invalid`)
  for (const field of ['thermalDegradedSamples', 'thermalUnknownSamples']) if (!boundedInteger(value[field], 0, 4096)) issues.push(`${label}.${field} is invalid`)
}

function validateDecision(value: unknown, label: string, issues: string[]): void {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return
  }
  exactFields(value, ['taskClass', 'status', 'attemptedSamples', 'completedSamples', 'failedSamples', 'failureRatio', 'metrics', 'reasonCodes', 'sourceSampleIds'], label, issues)
  if (!TASK_CLASSES.includes(value.taskClass as TaskCategory)) issues.push(`${label}.taskClass is unsupported`)
  if (!['qualified', 'rejected', 'inconclusive', 'stale'].includes(String(value.status))) issues.push(`${label}.status is unsupported`)
  for (const field of ['attemptedSamples', 'completedSamples', 'failedSamples']) if (!boundedInteger(value[field], 0, 4096)) issues.push(`${label}.${field} is invalid`)
  if (
    boundedInteger(value.attemptedSamples, 0, 4096) &&
    boundedInteger(value.completedSamples, 0, 4096) &&
    boundedInteger(value.failedSamples, 0, 4096) &&
    Number(value.completedSamples) + Number(value.failedSamples) !== Number(value.attemptedSamples)
  )
    issues.push(`${label} sample counts are inconsistent`)
  if (value.failureRatio === null) {
    if (value.attemptedSamples !== 0) issues.push(`${label}.failureRatio can be null only without samples`)
  } else if (!object(value.failureRatio) || !INTEGER.test(String(value.failureRatio.numerator)) || !/^[1-9]\d*$/.test(String(value.failureRatio.denominator))) {
    issues.push(`${label}.failureRatio must be an exact non-negative fraction`)
  } else if (value.failureRatio.numerator !== String(value.failedSamples) || value.failureRatio.denominator !== String(value.attemptedSamples)) {
    issues.push(`${label}.failureRatio must match sample counts`)
  }
  validateMetricsSummary(value.metrics, `${label}.metrics`, issues)
  validateReasonCodes(value.reasonCodes, `${label}.reasonCodes`, issues)
  if (
    !Array.isArray(value.sourceSampleIds) ||
    !value.sourceSampleIds.every((id) => FINGERPRINT.test(String(id))) ||
    JSON.stringify(value.sourceSampleIds) !== JSON.stringify(canonical(value.sourceSampleIds))
  )
    issues.push(`${label}.sourceSampleIds must contain canonical sample fingerprints`)
  if (value.status === 'qualified' && Array.isArray(value.reasonCodes) && value.reasonCodes.length > 0) issues.push(`${label} qualified decisions cannot have reason codes`)
}

export function assertLocalCandidateQualification(value: unknown): asserts value is LocalCandidateQualification {
  const issues: string[] = []
  if (!object(value)) throw new LocalQualificationContractError(['qualification must be an object'])
  exactFields(
    value,
    [
      'schemaVersion',
      'id',
      'status',
      'planId',
      'evidenceId',
      'suiteId',
      'qualificationPolicyId',
      'binding',
      'generatedAt',
      'validUntil',
      'decisions',
      'reasonCodes',
      'requiresRecommendation',
      'evidenceRefs'
    ],
    'qualification',
    issues
  )
  if (value.schemaVersion !== 1) issues.push('qualification.schemaVersion must be 1')
  for (const field of ['id', 'planId', 'evidenceId', 'suiteId', 'qualificationPolicyId']) if (!FINGERPRINT.test(String(value[field]))) issues.push(`qualification.${field} must be a fingerprint`)
  if (!['qualified', 'rejected', 'inconclusive', 'stale'].includes(String(value.status))) issues.push('qualification.status is unsupported')
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil)) issues.push('qualification timestamps are invalid')
  try {
    assertLocalBenchmarkBinding(value.binding)
  } catch {
    issues.push('qualification.binding must be a valid benchmark binding')
  }
  if (!Array.isArray(value.decisions) || value.decisions.length === 0 || value.decisions.length > TASK_CLASSES.length) issues.push('qualification.decisions is invalid')
  else {
    value.decisions.forEach((decision, index) => validateDecision(decision, `qualification.decisions[${index}]`, issues))
    const classes = value.decisions.map((decision) => (object(decision) ? decision.taskClass : undefined))
    if (new Set(classes).size !== classes.length || JSON.stringify(classes) !== JSON.stringify([...classes].sort())) issues.push('qualification decisions must be canonical and unique by task class')
    const statuses = value.decisions.map((decision) => (object(decision) ? decision.status : undefined))
    if (value.status === 'stale' && statuses.some((status) => status !== 'stale')) issues.push('stale qualification requires every decision to be stale')
    if (value.status === 'qualified' && !statuses.includes('qualified')) issues.push('qualified qualification requires an eligible task class')
    if (value.status === 'inconclusive' && (statuses.includes('qualified') || !statuses.includes('inconclusive'))) issues.push('inconclusive qualification has inconsistent decisions')
    if (value.status === 'rejected' && statuses.some((status) => status !== 'rejected')) issues.push('rejected qualification requires every decision to be rejected')
  }
  validateReasonCodes(value.reasonCodes, 'qualification.reasonCodes', issues)
  if (typeof value.requiresRecommendation !== 'boolean' || value.requiresRecommendation !== (value.status === 'stale')) issues.push('qualification.requiresRecommendation must match stale status')
  validateReferences(value.evidenceRefs, 'qualification.evidenceRefs', issues)
  if (issues.length === 0) {
    const { id, ...withoutId } = value
    if (stableFingerprint(withoutId) !== id) issues.push('qualification.id does not match its canonical content')
  }
  if (issues.length) throw new LocalQualificationContractError(issues)
}
