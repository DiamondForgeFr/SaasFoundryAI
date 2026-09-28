import type { QualifiedExecutionPlan } from './plans'
import { assertExactCostEvidence, compareExactCosts, ExactRational } from './exact-cost'
import { stableFingerprint } from './overrides'
import type { ExecutionCandidateCatalogueSnapshot, PrivacyBoundary, RuntimeKind } from './types'
import type { ExecutionRequirementSet } from './requirements'

const ID = /^[a-z0-9][a-z0-9._:/-]{0,127}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RUNTIMES: RuntimeKind[] = ['cloud', 'local', 'hybrid']
const BOUNDARIES: PrivacyBoundary[] = ['local-device', 'customer-controlled', 'provider-managed', 'unknown']
const RULES = [
  'preferred-runtime',
  'preferred-privacy-boundary',
  'lower-energy-mwh',
  'lower-device-pressure',
  'lower-failure-probability',
  'lower-fallback-exposure',
  'lower-max-path-latency',
  'lower-expected-money',
  'lower-max-money',
  'fewer-nodes',
  'canonical-plan-id'
] as const
const ROLES = ['primary', 'fallback', 'retry', 'validation'] as const
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const CURRENCY = /^[A-Z]{3}$/
const MAX_PLANS = 256
const MAX_NODES = 64

export type ExecutionRoutingComparisonRule = (typeof RULES)[number]
export type ExecutionRoutingDecisionStatus = 'selected' | 'unroutable'
export type ExecutionRoutingExclusionCode =
  | 'invalid-policy'
  | 'invalid-plan'
  | 'duplicate-plan'
  | 'plan-stale'
  | 'evidence-missing'
  | 'evidence-stale'
  | 'evidence-mismatch'
  | 'fallback-not-visible'
  | 'candidate-missing'
  | 'candidate-stale'
  | 'privacy-mismatch'
  | 'latency-threshold'
  | 'energy-threshold'
  | 'device-pressure-threshold'
  | 'failure-threshold'
  | 'fallback-exposure-threshold'
  | 'metrics-missing'
  | 'metrics-stale'
  | 'fallback-role-mismatch'
  | 'money-currency-mismatch'
  | 'plan-limit'
  | 'no-qualified-plan'

export interface ExecutionRoutingPolicy {
  schemaVersion: 1
  id: string
  version: string
  generatedAt: string
  validUntil: string
  settlementCurrency: string
  runtimePreference: RuntimeKind[]
  privacyPreference: PrivacyBoundary[]
  comparisonOrder: ExecutionRoutingComparisonRule[]
  thresholds: {
    maximumPathLatencyP95Ms: number | null
    maximumEnergyMilliwattHours: string | null
    maximumDevicePressureRatio: string | null
    maximumFailureProbability: string
    maximumFallbackExposureProbability: string
    maximumPlanNodes: number
    requireEvidenceRefs: boolean
  }
}

export type CreateExecutionRoutingPolicyInput = Omit<ExecutionRoutingPolicy, 'schemaVersion' | 'id'>

export interface ExecutionRoutingNodeEvidence {
  nodeId: string
  candidateId: string
  role: (typeof ROLES)[number]
  runtimeKind: RuntimeKind
  boundary: PrivacyBoundary
  observedAt: string
  validUntil: string
  evidenceRefs: string[]
}

/** Exact operational measurements. Energy is always expressed in milliWattHours. */
export interface ExecutionRoutingMetrics {
  observedAt: string
  validUntil: string
  energyMilliwattHours: string | null
  devicePressureRatio: string | null
  failureProbability: string
  fallbackExposureProbability: string
}

export interface ExecutionRoutingEvidence {
  schemaVersion: 1
  id: string
  planId: string
  planFingerprint: string
  generatedAt: string
  validUntil: string
  fallbackVisible: boolean
  nodes: ExecutionRoutingNodeEvidence[]
  metrics: ExecutionRoutingMetrics
  evidenceRefs: string[]
}

export interface ExecutionRoutingExclusion {
  planId: string
  code: ExecutionRoutingExclusionCode
  detailCode: string
  evidenceId?: string
}

export interface ExecutionRoutingComparisonDecision {
  rule: ExecutionRoutingComparisonRule
  winnerPlanId: string
  loserPlanId: string
}

export interface ExecutionRoutingDecision {
  schemaVersion: 1
  id: string
  status: ExecutionRoutingDecisionStatus
  evaluatedAt: string
  policyId: string
  selectedPlanId?: string
  selectedEvidenceId?: string
  selectedMetrics?: ExecutionRoutingMetrics
  selectedReason?: ExecutionRoutingComparisonRule | 'only-qualified-plan'
  selectedPlan?: QualifiedExecutionPlan
  consideredPlanIds: string[]
  exclusions: ExecutionRoutingExclusion[]
  comparisons: ExecutionRoutingComparisonDecision[]
}

export class ExecutionRoutingContractError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid execution routing contract: ${issues.join('; ')}`)
    this.name = 'ExecutionRoutingContractError'
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

function id(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string, issues: string[]): void {
  for (const field of Object.keys(value)) if (!allowed.includes(field)) issues.push(`${label}.${field} is not allowed`)
}

function validRange(observedAt: string, validUntil: string): boolean {
  return timestamp(observedAt) && timestamp(validUntil) && observedAt < validUntil
}

function decimal(value: unknown): boolean {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return false
  try {
    ExactRational.decimal(value)
    return true
  } catch {
    return false
  }
}

function ratio(value: unknown): boolean {
  if (!decimal(value)) return false
  return ExactRational.decimal(value as string).compare(new ExactRational(1n)) <= 0
}

function compareDecimal(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return ExactRational.decimal(left).compare(ExactRational.decimal(right))
}

export function createExecutionRoutingPolicy(input: CreateExecutionRoutingPolicyInput): ExecutionRoutingPolicy {
  const value = { schemaVersion: 1 as const, ...input, id: stableFingerprint({ schemaVersion: 1, ...input }) }
  assertExecutionRoutingPolicy(value)
  return freeze(value)
}

export function assertExecutionRoutingPolicy(value: unknown): asserts value is ExecutionRoutingPolicy {
  const issues: string[] = []
  if (!object(value)) throw new ExecutionRoutingContractError(['policy must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'version', 'generatedAt', 'validUntil', 'settlementCurrency', 'runtimePreference', 'privacyPreference', 'comparisonOrder', 'thresholds'], 'policy', issues)
  if (value.schemaVersion !== 1) issues.push('policy.schemaVersion must be 1')
  if (!fingerprint(value.id)) issues.push('policy.id must be a SHA-256 fingerprint')
  if (!id(value.version)) issues.push('policy.version must be a safe identifier')
  if (!timestamp(value.generatedAt) || !timestamp(value.validUntil) || value.generatedAt >= value.validUntil) issues.push('policy validity range is invalid')
  if (typeof value.settlementCurrency !== 'string' || !CURRENCY.test(value.settlementCurrency)) issues.push('policy.settlementCurrency must be an ISO currency')
  if (
    !Array.isArray(value.runtimePreference) ||
    value.runtimePreference.length === 0 ||
    new Set(value.runtimePreference).size !== value.runtimePreference.length ||
    value.runtimePreference.some((entry) => !RUNTIMES.includes(entry as RuntimeKind))
  )
    issues.push('policy.runtimePreference must contain unique runtime kinds')
  if (
    !Array.isArray(value.privacyPreference) ||
    value.privacyPreference.length === 0 ||
    new Set(value.privacyPreference).size !== value.privacyPreference.length ||
    value.privacyPreference.some((entry) => !BOUNDARIES.includes(entry as PrivacyBoundary))
  )
    issues.push('policy.privacyPreference must contain unique privacy boundaries')
  if (
    !Array.isArray(value.comparisonOrder) ||
    value.comparisonOrder.length !== RULES.length ||
    new Set(value.comparisonOrder).size !== value.comparisonOrder.length ||
    value.comparisonOrder.some((entry) => !RULES.includes(entry as ExecutionRoutingComparisonRule))
  )
    issues.push('policy.comparisonOrder must declare every comparison rule exactly once')
  if (!object(value.thresholds)) issues.push('policy.thresholds must be an object')
  else {
    const thresholds = value.thresholds
    exactFields(
      thresholds,
      [
        'maximumPathLatencyP95Ms',
        'maximumEnergyMilliwattHours',
        'maximumDevicePressureRatio',
        'maximumFailureProbability',
        'maximumFallbackExposureProbability',
        'maximumPlanNodes',
        'requireEvidenceRefs'
      ],
      'policy.thresholds',
      issues
    )
    if (thresholds.maximumPathLatencyP95Ms !== null && (!Number.isSafeInteger(thresholds.maximumPathLatencyP95Ms) || Number(thresholds.maximumPathLatencyP95Ms) < 0))
      issues.push('policy.thresholds.maximumPathLatencyP95Ms is invalid')
    if (thresholds.maximumEnergyMilliwattHours !== null && !decimal(thresholds.maximumEnergyMilliwattHours)) issues.push('policy.thresholds.maximumEnergyMilliwattHours is invalid')
    if (thresholds.maximumDevicePressureRatio !== null && !ratio(thresholds.maximumDevicePressureRatio)) issues.push('policy.thresholds.maximumDevicePressureRatio is invalid')
    if (!ratio(thresholds.maximumFailureProbability)) issues.push('policy.thresholds.maximumFailureProbability is invalid')
    if (!ratio(thresholds.maximumFallbackExposureProbability)) issues.push('policy.thresholds.maximumFallbackExposureProbability is invalid')
    if (!Number.isSafeInteger(thresholds.maximumPlanNodes) || Number(thresholds.maximumPlanNodes) < 1 || Number(thresholds.maximumPlanNodes) > MAX_NODES)
      issues.push('policy.thresholds.maximumPlanNodes is invalid')
    if (typeof thresholds.requireEvidenceRefs !== 'boolean') issues.push('policy.thresholds.requireEvidenceRefs must be boolean')
  }
  if (issues.length === 0 && stableFingerprint({ ...value, id: undefined }) !== value.id) issues.push('policy.id does not match canonical content')
  if (issues.length) throw new ExecutionRoutingContractError(issues)
}

function assertNodeEvidence(value: unknown, label: string, issues: string[]): value is ExecutionRoutingNodeEvidence {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return false
  }
  exactFields(value, ['nodeId', 'candidateId', 'role', 'runtimeKind', 'boundary', 'observedAt', 'validUntil', 'evidenceRefs'], label, issues)
  if (!id(value.nodeId) || !id(value.candidateId)) issues.push(`${label} identifiers are invalid`)
  if (!ROLES.includes(value.role as (typeof ROLES)[number])) issues.push(`${label}.role is unsupported`)
  if (!RUNTIMES.includes(value.runtimeKind as RuntimeKind)) issues.push(`${label}.runtimeKind is unsupported`)
  if (!BOUNDARIES.includes(value.boundary as PrivacyBoundary)) issues.push(`${label}.boundary is unsupported`)
  if (!validRange(String(value.observedAt), String(value.validUntil))) issues.push(`${label} validity range is invalid`)
  if (
    !Array.isArray(value.evidenceRefs) ||
    value.evidenceRefs.length === 0 ||
    value.evidenceRefs.length > 32 ||
    value.evidenceRefs.some((entry) => !id(entry)) ||
    new Set(value.evidenceRefs).size !== value.evidenceRefs.length
  )
    issues.push(`${label}.evidenceRefs must contain unique safe references`)
  return true
}

function assertMetrics(value: unknown, label: string, issues: string[]): value is ExecutionRoutingMetrics {
  if (!object(value)) {
    issues.push(`${label} must be an object`)
    return false
  }
  exactFields(value, ['observedAt', 'validUntil', 'energyMilliwattHours', 'devicePressureRatio', 'failureProbability', 'fallbackExposureProbability'], label, issues)
  if (!validRange(String(value.observedAt), String(value.validUntil))) issues.push(`${label} validity range is invalid`)
  if (value.energyMilliwattHours !== null && !decimal(value.energyMilliwattHours)) issues.push(`${label}.energyMilliwattHours must be a non-negative milliWattHour decimal`)
  if (value.devicePressureRatio !== null && !ratio(value.devicePressureRatio)) issues.push(`${label}.devicePressureRatio must be a ratio from zero to one`)
  if (!ratio(value.failureProbability)) issues.push(`${label}.failureProbability must be a ratio from zero to one`)
  if (!ratio(value.fallbackExposureProbability)) issues.push(`${label}.fallbackExposureProbability must be a ratio from zero to one`)
  return true
}

export function assertExecutionRoutingEvidence(value: unknown): asserts value is ExecutionRoutingEvidence {
  const issues: string[] = []
  if (!object(value)) throw new ExecutionRoutingContractError(['evidence must be an object'])
  exactFields(value, ['schemaVersion', 'id', 'planId', 'planFingerprint', 'generatedAt', 'validUntil', 'fallbackVisible', 'nodes', 'metrics', 'evidenceRefs'], 'evidence', issues)
  if (value.schemaVersion !== 1) issues.push('evidence.schemaVersion must be 1')
  if (!fingerprint(value.id) || !fingerprint(value.planFingerprint)) issues.push('evidence IDs must be fingerprints')
  if (!id(value.planId)) issues.push('evidence.planId must be a safe identifier')
  if (!validRange(String(value.generatedAt), String(value.validUntil))) issues.push('evidence validity range is invalid')
  if (typeof value.fallbackVisible !== 'boolean') issues.push('evidence.fallbackVisible must be boolean')
  assertMetrics(value.metrics, 'evidence.metrics', issues)
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > MAX_NODES) issues.push('evidence.nodes is invalid')
  else {
    value.nodes.forEach((node, index) => assertNodeEvidence(node, `evidence.nodes[${index}]`, issues))
    const keys = value.nodes.map((node) => (object(node) ? String(node.nodeId) : ''))
    if (new Set(keys).size !== keys.length) issues.push('evidence.nodes must have unique node IDs')
    const primaryCount = value.nodes.filter((node) => object(node) && node.role === 'primary').length
    const fallbackCount = value.nodes.filter((node) => object(node) && (node.role === 'fallback' || node.role === 'retry')).length
    if (primaryCount !== 1) issues.push('evidence.nodes must contain exactly one primary role')
    if (object(value.metrics)) {
      if (value.nodes.some((node) => object(node) && node.runtimeKind === 'local') && (value.metrics.energyMilliwattHours === null || value.metrics.devicePressureRatio === null))
        issues.push('local evidence requires energy and device pressure metrics')
      if (fallbackCount === 0 && value.metrics.fallbackExposureProbability !== '0') issues.push('evidence without fallback roles must have zero fallback exposure')
      if (fallbackCount > 0 && value.metrics.fallbackExposureProbability === '0') issues.push('visible fallback evidence must have non-zero fallback exposure')
    }
  }
  if (
    !Array.isArray(value.evidenceRefs) ||
    value.evidenceRefs.length === 0 ||
    value.evidenceRefs.length > 32 ||
    value.evidenceRefs.some((entry) => !id(entry)) ||
    new Set(value.evidenceRefs).size !== value.evidenceRefs.length
  )
    issues.push('evidence.evidenceRefs must contain unique safe references')
  if (issues.length === 0 && stableFingerprint({ ...value, id: undefined }) !== value.id) issues.push('evidence.id does not match canonical content')
  if (issues.length) throw new ExecutionRoutingContractError(issues)
}

function planShape(plan: QualifiedExecutionPlan): string[] {
  const issues: string[] = []
  if (!id(plan.proposalId) || !fingerprint(plan.proposalFingerprint) || !id(plan.rootCandidateId)) issues.push('plan identity is invalid')
  if (!RUNTIMES.includes(plan.rootRuntimeKind) || !BOUNDARIES.includes(plan.rootBoundary as PrivacyBoundary)) issues.push('plan root runtime or boundary is invalid')
  if (!Number.isSafeInteger(plan.nodeCount) || plan.nodeCount < 1 || plan.nodeCount > MAX_NODES) issues.push('plan node count is invalid')
  if (plan.maximumPathLatencyP95Ms !== null && (!Number.isSafeInteger(plan.maximumPathLatencyP95Ms) || plan.maximumPathLatencyP95Ms < 0)) issues.push('plan maximum path latency is invalid')
  if (!timestamp(plan.validUntil)) issues.push('plan validUntil is invalid')
  if (!Array.isArray(plan.nodeCosts) || plan.nodeCosts.length !== plan.nodeCount) issues.push('plan node costs must cover every node')
  else {
    const nodes = new Set<string>()
    for (const node of plan.nodeCosts) {
      if (!id(node.nodeId) || !id(node.candidateId) || nodes.has(node.nodeId)) issues.push('plan node costs must use unique safe node IDs')
      nodes.add(node.nodeId)
      try {
        assertExactCostEvidence(node.invocationP95, 'plan invocation cost')
        assertExactCostEvidence(node.weightedP95, 'plan weighted cost')
      } catch {
        issues.push('plan node costs contain invalid exact evidence')
      }
    }
  }
  try {
    assertExactCostEvidence(plan.expectedAggregateP95, 'plan expected cost')
    assertExactCostEvidence(plan.maximumPathP95, 'plan maximum cost')
  } catch {
    issues.push('plan aggregate costs contain invalid exact evidence')
  }
  return issues
}

function excluded(planId: string, code: ExecutionRoutingExclusionCode, detailCode: string, evidenceId?: string): ExecutionRoutingExclusion {
  return { planId, code, detailCode, ...(evidenceId ? { evidenceId } : {}) }
}

function current(observedAt: string, validUntil: string, at: string): boolean {
  return observedAt <= at && at < validUntil
}

function runtimeRank(runtime: RuntimeKind, preference: RuntimeKind[]): number {
  const rank = preference.indexOf(runtime)
  return rank < 0 ? preference.length : rank
}

function boundaryRank(boundary: PrivacyBoundary, preference: PrivacyBoundary[]): number {
  const rank = preference.indexOf(boundary)
  return rank < 0 ? preference.length : rank
}

function comparePlans(
  left: QualifiedExecutionPlan,
  right: QualifiedExecutionPlan,
  leftEvidence: ExecutionRoutingEvidence,
  rightEvidence: ExecutionRoutingEvidence,
  policy: ExecutionRoutingPolicy
): { comparison: number; rule: ExecutionRoutingComparisonRule } {
  const leftRoot = leftEvidence.nodes.find((node) => node.candidateId === left.rootCandidateId)!
  const rightRoot = rightEvidence.nodes.find((node) => node.candidateId === right.rootCandidateId)!
  for (const rule of policy.comparisonOrder) {
    let comparison = 0
    if (rule === 'preferred-runtime') comparison = runtimeRank(leftRoot.runtimeKind, policy.runtimePreference) - runtimeRank(rightRoot.runtimeKind, policy.runtimePreference)
    if (rule === 'preferred-privacy-boundary') comparison = boundaryRank(leftRoot.boundary, policy.privacyPreference) - boundaryRank(rightRoot.boundary, policy.privacyPreference)
    if (rule === 'lower-energy-mwh') comparison = compareDecimal(leftEvidence.metrics.energyMilliwattHours, rightEvidence.metrics.energyMilliwattHours)
    if (rule === 'lower-device-pressure') comparison = compareDecimal(leftEvidence.metrics.devicePressureRatio, rightEvidence.metrics.devicePressureRatio)
    if (rule === 'lower-failure-probability') comparison = compareDecimal(leftEvidence.metrics.failureProbability, rightEvidence.metrics.failureProbability)
    if (rule === 'lower-fallback-exposure') comparison = compareDecimal(leftEvidence.metrics.fallbackExposureProbability, rightEvidence.metrics.fallbackExposureProbability)
    if (rule === 'lower-max-path-latency') comparison = (left.maximumPathLatencyP95Ms ?? Number.MAX_SAFE_INTEGER) - (right.maximumPathLatencyP95Ms ?? Number.MAX_SAFE_INTEGER)
    if (rule === 'lower-expected-money') comparison = compareExactCosts(left.expectedAggregateP95, right.expectedAggregateP95)
    if (rule === 'lower-max-money') comparison = compareExactCosts(left.maximumPathP95, right.maximumPathP95)
    if (rule === 'fewer-nodes') comparison = left.nodeCount - right.nodeCount
    if (rule === 'canonical-plan-id') comparison = left.proposalId.localeCompare(right.proposalId)
    if (comparison !== 0) return { comparison, rule }
  }
  return { comparison: left.proposalId.localeCompare(right.proposalId), rule: 'canonical-plan-id' }
}

export function selectExecutionRoute(
  plans: readonly QualifiedExecutionPlan[],
  catalogue: Readonly<ExecutionCandidateCatalogueSnapshot>,
  requirements: Readonly<ExecutionRequirementSet>,
  evidence: readonly ExecutionRoutingEvidence[],
  policy: ExecutionRoutingPolicy,
  evaluatedAt: string
): ExecutionRoutingDecision {
  assertExecutionRoutingPolicy(policy)
  if (!timestamp(evaluatedAt)) throw new ExecutionRoutingContractError(['evaluatedAt must be a canonical UTC timestamp'])
  if (plans.length > MAX_PLANS) throw new ExecutionRoutingContractError(['plans exceed the routing bound'])
  if (requirements.resolution.status !== 'resolved') return decision('unroutable', evaluatedAt, policy, [], [], [], undefined)
  const eligibleCandidates = new Map(catalogue.eligible.map((candidate) => [candidate.id, candidate]))
  const evidenceByPlan = new Map(evidence.map((entry) => [entry.planId, entry]))
  const seen = new Set<string>()
  const exclusions: ExecutionRoutingExclusion[] = []
  const valid: Array<{ plan: QualifiedExecutionPlan; evidence: ExecutionRoutingEvidence }> = []
  for (const plan of plans) {
    if (seen.has(plan.proposalId)) {
      exclusions.push(excluded(plan.proposalId, 'duplicate-plan', 'duplicate-proposal-id'))
      continue
    }
    seen.add(plan.proposalId)
    const shapeIssues = planShape(plan)
    if (shapeIssues.length) {
      exclusions.push(excluded(id(plan.proposalId) ? plan.proposalId : 'invalid-plan', 'invalid-plan', 'qualified-plan-contract'))
      continue
    }
    const planEvidence = evidenceByPlan.get(plan.proposalId)
    if (!planEvidence) {
      exclusions.push(excluded(plan.proposalId, 'evidence-missing', 'operational-evidence-not-declared'))
      continue
    }
    try {
      assertExecutionRoutingEvidence(planEvidence)
    } catch {
      exclusions.push(excluded(plan.proposalId, 'evidence-mismatch', 'operational-evidence-contract', planEvidence.id))
      continue
    }
    if (planEvidence.planFingerprint !== plan.proposalFingerprint) {
      exclusions.push(excluded(plan.proposalId, 'evidence-mismatch', 'proposal-fingerprint-mismatch', planEvidence.id))
      continue
    }
    if (plan.expectedAggregateP95.currency !== policy.settlementCurrency || plan.maximumPathP95.currency !== policy.settlementCurrency) {
      exclusions.push(excluded(plan.proposalId, 'money-currency-mismatch', 'plan-money-does-not-match-routing-currency', planEvidence.id))
      continue
    }
    if (!current(planEvidence.generatedAt, planEvidence.validUntil, evaluatedAt) || evaluatedAt >= plan.validUntil) {
      exclusions.push(excluded(plan.proposalId, 'plan-stale', 'plan-or-evidence-expired', planEvidence.id))
      continue
    }
    const hasFallbackRole = planEvidence.nodes.some((node) => node.role === 'fallback' || node.role === 'retry')
    if (hasFallbackRole !== planEvidence.fallbackVisible) {
      exclusions.push(
        excluded(
          plan.proposalId,
          hasFallbackRole ? 'fallback-not-visible' : 'fallback-role-mismatch',
          hasFallbackRole ? 'fallback-not-declared' : 'fallback-visible-without-fallback-role',
          planEvidence.id
        )
      )
      continue
    }
    if (plan.nodeCount > policy.thresholds.maximumPlanNodes) {
      exclusions.push(excluded(plan.proposalId, 'plan-limit', 'maximum-plan-nodes-exceeded', planEvidence.id))
      continue
    }
    const costs = new Map(plan.nodeCosts.map((node) => [node.nodeId, node]))
    const nodeIds = new Set(planEvidence.nodes.map((node) => node.nodeId))
    if (
      nodeIds.size !== plan.nodeCount ||
      !planEvidence.nodes.some((node) => node.candidateId === plan.rootCandidateId && node.role === 'primary') ||
      planEvidence.nodes.some((node) => !costs.has(node.nodeId) || costs.get(node.nodeId)!.candidateId !== node.candidateId)
    ) {
      exclusions.push(excluded(plan.proposalId, 'evidence-mismatch', 'all-node-evidence-required', planEvidence.id))
      continue
    }
    let rejected: ExecutionRoutingExclusion | undefined
    for (const node of planEvidence.nodes) {
      const candidate = eligibleCandidates.get(node.candidateId)
      if (!candidate) {
        rejected = excluded(plan.proposalId, 'candidate-missing', 'node-candidate-not-eligible', planEvidence.id)
        break
      }
      if (node.runtimeKind !== candidate.runtime.kind || node.boundary !== candidate.privacy.boundary) {
        rejected = excluded(plan.proposalId, 'evidence-mismatch', 'node-candidate-runtime-or-privacy-mismatch', planEvidence.id)
        break
      }
      if (!current(candidate.availability.checkedAt, candidate.availability.validUntil, evaluatedAt)) {
        rejected = excluded(plan.proposalId, 'candidate-stale', 'node-candidate-availability-expired', planEvidence.id)
        break
      }
      if (!current(node.observedAt, node.validUntil, evaluatedAt)) {
        rejected = excluded(plan.proposalId, 'evidence-stale', 'node-operational-evidence-expired', planEvidence.id)
        break
      }
      if (policy.thresholds.requireEvidenceRefs && node.evidenceRefs.length === 0) {
        rejected = excluded(plan.proposalId, 'evidence-missing', 'node-evidence-reference-required', planEvidence.id)
        break
      }
      if (requirements.effective.privacy.allowedBoundaries.length === 1 && requirements.effective.privacy.allowedBoundaries[0] === 'local-device' && node.runtimeKind !== 'local') {
        rejected = excluded(plan.proposalId, 'privacy-mismatch', 'cloud-fallback-forbidden-by-local-only-requirement', planEvidence.id)
        break
      }
      if (!requirements.effective.privacy.allowedBoundaries.includes(node.boundary)) {
        rejected = excluded(plan.proposalId, 'privacy-mismatch', 'node-boundary-not-allowed', planEvidence.id)
        break
      }
    }
    if (rejected) {
      exclusions.push(rejected)
      continue
    }
    if (!current(planEvidence.metrics.observedAt, planEvidence.metrics.validUntil, evaluatedAt)) {
      exclusions.push(excluded(plan.proposalId, 'metrics-stale', 'operational-metrics-expired', planEvidence.id))
      continue
    }
    const metrics = planEvidence.metrics
    if (
      metrics.energyMilliwattHours !== null &&
      policy.thresholds.maximumEnergyMilliwattHours !== null &&
      compareDecimal(metrics.energyMilliwattHours, policy.thresholds.maximumEnergyMilliwattHours) > 0
    ) {
      exclusions.push(excluded(plan.proposalId, 'energy-threshold', 'maximum-energy-exceeded', planEvidence.id))
      continue
    }
    if (
      metrics.devicePressureRatio !== null &&
      policy.thresholds.maximumDevicePressureRatio !== null &&
      compareDecimal(metrics.devicePressureRatio, policy.thresholds.maximumDevicePressureRatio) > 0
    ) {
      exclusions.push(excluded(plan.proposalId, 'device-pressure-threshold', 'maximum-device-pressure-exceeded', planEvidence.id))
      continue
    }
    if (compareDecimal(metrics.failureProbability, policy.thresholds.maximumFailureProbability) > 0) {
      exclusions.push(excluded(plan.proposalId, 'failure-threshold', 'maximum-failure-probability-exceeded', planEvidence.id))
      continue
    }
    if (compareDecimal(metrics.fallbackExposureProbability, policy.thresholds.maximumFallbackExposureProbability) > 0) {
      exclusions.push(excluded(plan.proposalId, 'fallback-exposure-threshold', 'maximum-fallback-exposure-exceeded', planEvidence.id))
      continue
    }
    if (policy.thresholds.maximumPathLatencyP95Ms !== null && (plan.maximumPathLatencyP95Ms === null || plan.maximumPathLatencyP95Ms > policy.thresholds.maximumPathLatencyP95Ms)) {
      exclusions.push(excluded(plan.proposalId, 'latency-threshold', 'maximum-path-latency-exceeded', planEvidence.id))
      continue
    }
    valid.push({ plan, evidence: planEvidence })
  }
  valid.sort((left, right) => comparePlans(left.plan, right.plan, left.evidence, right.evidence, policy).comparison)
  const comparisons: ExecutionRoutingComparisonDecision[] = []
  for (let index = 1; index < valid.length; index += 1) {
    const comparison = comparePlans(valid[index - 1].plan, valid[index].plan, valid[index - 1].evidence, valid[index].evidence, policy)
    comparisons.push({
      rule: comparison.rule,
      winnerPlanId: comparison.comparison <= 0 ? valid[index - 1].plan.proposalId : valid[index].plan.proposalId,
      loserPlanId: comparison.comparison <= 0 ? valid[index].plan.proposalId : valid[index - 1].plan.proposalId
    })
  }
  if (valid.length === 0)
    return decision(
      'unroutable',
      evaluatedAt,
      policy,
      plans.map((plan) => plan.proposalId).filter(id),
      exclusions.length ? exclusions : [excluded('none', 'no-qualified-plan', 'no-qualified-route')],
      comparisons,
      undefined
    )
  return decision(
    'selected',
    evaluatedAt,
    policy,
    valid.map((entry) => entry.plan.proposalId),
    exclusions,
    comparisons,
    valid[0]
  )
}

function decision(
  status: ExecutionRoutingDecisionStatus,
  evaluatedAt: string,
  policy: ExecutionRoutingPolicy,
  consideredPlanIds: string[],
  exclusions: ExecutionRoutingExclusion[],
  comparisons: ExecutionRoutingComparisonDecision[],
  selected: { plan: QualifiedExecutionPlan; evidence: ExecutionRoutingEvidence } | undefined
): ExecutionRoutingDecision {
  const payload = {
    schemaVersion: 1 as const,
    status,
    evaluatedAt,
    policyId: policy.id,
    ...(selected
      ? {
          selectedPlanId: selected.plan.proposalId,
          selectedEvidenceId: selected.evidence.id,
          selectedMetrics: selected.evidence.metrics,
          selectedReason: (comparisons.find((comparison) => comparison.winnerPlanId === selected.plan.proposalId)?.rule ?? 'only-qualified-plan') as ExecutionRoutingDecision['selectedReason'],
          selectedPlan: selected.plan
        }
      : {}),
    consideredPlanIds: [...consideredPlanIds].sort(),
    exclusions: [...exclusions].sort((left, right) => `${left.planId}/${left.code}/${left.detailCode}`.localeCompare(`${right.planId}/${right.code}/${right.detailCode}`)),
    comparisons
  }
  return freeze({ ...payload, id: stableFingerprint(payload) })
}

export function assertExecutionRoutingDecision(value: unknown): asserts value is ExecutionRoutingDecision {
  if (!object(value)) throw new ExecutionRoutingContractError(['decision must be an object'])
  if (value.schemaVersion !== 1 || !fingerprint(value.id) || !['selected', 'unroutable'].includes(String(value.status)) || !timestamp(value.evaluatedAt) || !fingerprint(value.policyId))
    throw new ExecutionRoutingContractError(['decision contract is invalid'])
  const { id: decisionId, ...payload } = value
  if (stableFingerprint(payload) !== decisionId) throw new ExecutionRoutingContractError(['decision.id does not match canonical content'])
}
