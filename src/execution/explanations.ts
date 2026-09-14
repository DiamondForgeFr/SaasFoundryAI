import type { ExecutionBudgetDecision, ExecutionRecoveryBudgetDecision } from './budget'
import { assertAdaptiveExecutionAuthorizationDecision, type AdaptiveExecutionAuthorizationDecision } from './route-authority'
import { assertExecutionOutcomeEvidence, type ExecutionOutcomeEvidence } from './calibration'
import { assertExactCostEvidence } from './exact-cost'
import { stableFingerprint } from './overrides'
import { assertExecutionPlanDecision, type BillableUsageP95, type ExactCostEvidence, type ExecutionPlanDecision, type ExecutionPlanExclusionCode, type ExecutionPlanTieBreakDecision } from './plans'
import { assertExecutionLineage, type ExecutionLineage, type ExecutionLineageTerminalState, type ExecutionObservedOutcome, type ExecutionReplanTrigger } from './replanning'
import { assertExecutionRoutingDecision, assertExecutionRoutingEvidence, type ExecutionRoutingDecision, type ExecutionRoutingEvidence, type ExecutionRoutingMetrics } from './routing'

const FINGERPRINT = /^[a-f0-9]{64}$/
const SAFE_ID = /^[a-z0-9][a-z0-9._:/-]{0,127}$/i
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const MAX_ADAPTIVE_FALLBACK_NODES = 64
const MAX_ADAPTIVE_EXCLUSIONS = 256
const MAX_ADAPTIVE_EVIDENCE_REFS = 256
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i
const EXPLANATION_FIELDS = [
  'schemaVersion',
  'id',
  'planDecisionId',
  'status',
  'requirementsId',
  'catalogueFingerprint',
  'policyFingerprint',
  'selected',
  'alternatives',
  'tieBreaks',
  'authority',
  'lineage',
  'outcomes',
  'evidenceRefs'
] as const

export type ExecutionExplanationStatus = ExecutionPlanDecision['status']

export interface ExecutionSelectedExplanation {
  proposalId: string
  candidateId: string
  expectedAggregateP95: ExactCostEvidence
  maximumPathP95: ExactCostEvidence
  reasonCode: 'sole-qualified-plan' | 'minimum-expected-cost'
}

export interface ExecutionAlternativeExplanation {
  proposalId: string
  status: 'qualified' | 'excluded'
  candidateIds: string[]
  nodeIds: string[]
  reasonCodes: Array<ExecutionPlanExclusionCode | `tie-break:${ExecutionPlanTieBreakDecision['rule']}`>
  expectedAggregateP95?: ExactCostEvidence
  maximumPathP95?: ExactCostEvidence
}

export interface ExecutionAuthorityExplanation {
  decisionId: string
  status: ExecutionBudgetDecision['status']
  mode: ExecutionBudgetDecision['mode']
  reasonCode: ExecutionBudgetDecision['reasonCode']
  dispatchAuthorized: boolean
  nonMonetaryApprovalRequired: boolean
  baselineP95: ExactCostEvidence
  expectedAggregateP95?: ExactCostEvidence
  maximumPathP95?: ExactCostEvidence
  expectedIncrement?: ExactCostEvidence
  pathIncrement?: ExactCostEvidence
  runId?: string
  lineageRevision?: number
  historyHead?: string
  spentP95?: ExactCostEvidence
  remainingAutomaticAuthorityP95?: ExactCostEvidence
  recoveryExpectedTotalP95?: ExactCostEvidence
  recoveryMaximumTotalP95?: ExactCostEvidence
}

export interface ExecutionLineageExplanation {
  lineageId: string
  runId: string
  revision: number
  historyHead: string
  terminalState: ExecutionLineageTerminalState
  attemptCount: number
  currentAttemptId: string
  lastTrigger: 'initial' | ExecutionReplanTrigger
  lastOutcome?: ExecutionObservedOutcome
  invalidatedPermitIds: string[]
}

export interface ExecutionOutcomeExplanation {
  outcomeId: string
  eventId: string
  runId: string
  attemptId: string
  nodeId: string
  candidateId: string
  occurredAt: string
  receivedAt: string
  outcome: ExecutionOutcomeEvidence['outcome']
  actualUsage: BillableUsageP95
  metering: ExecutionOutcomeEvidence['metering']
  latencyMs: number | null
  validation: ExecutionOutcomeEvidence['validation']
  retryOrdinal: number
  fallbackReason?: ExecutionOutcomeEvidence['fallbackReason']
  sourceKind: ExecutionOutcomeEvidence['sourceKind']
  evidenceRefs: string[]
}

export interface ExecutionDecisionExplanation {
  schemaVersion: 1
  id: string
  planDecisionId: string
  status: ExecutionExplanationStatus
  requirementsId: string
  catalogueFingerprint: string
  policyFingerprint: string
  selected?: ExecutionSelectedExplanation
  alternatives: ExecutionAlternativeExplanation[]
  tieBreaks: ExecutionPlanTieBreakDecision[]
  authority?: ExecutionAuthorityExplanation
  lineage?: ExecutionLineageExplanation
  outcomes: ExecutionOutcomeExplanation[]
  evidenceRefs: string[]
}

export interface ExecutionExplanationInput {
  budgetDecision?: ExecutionBudgetDecision | ExecutionRecoveryBudgetDecision
  lineage?: ExecutionLineage
  outcomes?: readonly ExecutionOutcomeEvidence[]
}

export class ExecutionExplanationContractError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid execution explanation contract: ${issues.join('; ')}`)
    this.name = 'ExecutionExplanationContractError'
    this.issues = [...issues]
  }
}

export interface AdaptiveExecutionRouteExplanation {
  schemaVersion: 1
  id: string
  routingDecisionId: string
  status: ExecutionRoutingDecision['status']
  policyId: string
  selected?: {
    planId: string
    candidateId: string
    reasonCode: NonNullable<ExecutionRoutingDecision['selectedReason']>
    metrics: ExecutionRoutingMetrics
    expectedAggregateP95: ExactCostEvidence
    maximumPathP95: ExactCostEvidence
    fallbackNodes: Array<{ nodeId: string; candidateId: string; role: 'fallback' | 'retry'; boundary: string }>
  }
  exclusions: ExecutionRoutingDecision['exclusions']
  authority?: {
    decisionId: string
    status: AdaptiveExecutionAuthorizationDecision['status']
    reasonCode: AdaptiveExecutionAuthorizationDecision['reasonCode']
    budgetStatus?: ExecutionBudgetDecision['status']
    cloudBoundaryRequired: boolean
    dispatchAuthorized: boolean
  }
  evidenceRefs: string[]
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) freeze(entry)
    Object.freeze(value)
  }
  return value
}

function withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const rest: Partial<T> = { ...value }
  delete rest.id
  return rest as Omit<T, 'id'>
}

function cloneCost(value: ExactCostEvidence): ExactCostEvidence {
  return { ...value }
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !SECRET_LIKE.test(value)
}

function authorityExplanation(value: ExecutionBudgetDecision | ExecutionRecoveryBudgetDecision, planDecisionId: string): ExecutionAuthorityExplanation {
  const fields = [
    'schemaVersion',
    'id',
    'status',
    'mode',
    'reasonCode',
    'evaluatedAt',
    'planDecisionId',
    'proposalFingerprint',
    'sessionEnvelopeId',
    'sessionId',
    'sessionCandidateId',
    'sessionEffort',
    'workloadFingerprint',
    'authorityRevision',
    'currency',
    'expectedAggregateP95',
    'maximumPathP95',
    'baselineP95',
    'dispatchAuthorized',
    'nonMonetaryApprovalRequired',
    'challenge',
    'approvalEventId',
    'runId',
    'lineageRevision',
    'historyHead',
    'spentP95',
    'remainingAutomaticAuthorityP95',
    'recoveryExpectedTotalP95',
    'recoveryMaximumTotalP95'
  ]
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    value.schemaVersion !== 1 ||
    !FINGERPRINT.test(value.id) ||
    stableFingerprint(withoutId(value)) !== value.id
  )
    throw new ExecutionExplanationContractError(['budget decision must be an immutable fingerprinted decision'])
  if (value.planDecisionId !== planDecisionId) throw new ExecutionExplanationContractError(['budget decision must reference the explained plan'])
  if (!['authorized', 'approval-required', 'rejected'].includes(value.status) || ![null, 'automatic', 'approved-increment'].includes(value.mode))
    throw new ExecutionExplanationContractError(['budget decision status or mode is unsupported'])
  if (!safeId(value.reasonCode) || typeof value.dispatchAuthorized !== 'boolean' || typeof value.nonMonetaryApprovalRequired !== 'boolean')
    throw new ExecutionExplanationContractError(['budget decision contains unsafe explanation facts'])
  try {
    assertExactCostEvidence(value.baselineP95, 'budget baseline')
    if (value.expectedAggregateP95) assertExactCostEvidence(value.expectedAggregateP95, 'budget expected cost')
    if (value.maximumPathP95) assertExactCostEvidence(value.maximumPathP95, 'budget maximum cost')
    if (value.challenge) {
      assertExactCostEvidence(value.challenge.expectedIncrement, 'budget expected increment')
      assertExactCostEvidence(value.challenge.pathIncrement, 'budget path increment')
    }
  } catch {
    throw new ExecutionExplanationContractError(['budget decision contains invalid exact cost evidence'])
  }
  const challenge = value.challenge
  const recovery = 'runId' in value ? value : undefined
  return {
    decisionId: value.id,
    status: value.status,
    mode: value.mode,
    reasonCode: value.reasonCode,
    dispatchAuthorized: value.dispatchAuthorized,
    nonMonetaryApprovalRequired: value.nonMonetaryApprovalRequired,
    baselineP95: cloneCost(value.baselineP95),
    ...(value.expectedAggregateP95 ? { expectedAggregateP95: cloneCost(value.expectedAggregateP95) } : {}),
    ...(value.maximumPathP95 ? { maximumPathP95: cloneCost(value.maximumPathP95) } : {}),
    ...(challenge ? { expectedIncrement: cloneCost(challenge.expectedIncrement), pathIncrement: cloneCost(challenge.pathIncrement) } : {}),
    ...(recovery
      ? {
          runId: recovery.runId,
          lineageRevision: recovery.lineageRevision,
          historyHead: recovery.historyHead,
          spentP95: cloneCost(recovery.spentP95),
          remainingAutomaticAuthorityP95: cloneCost(recovery.remainingAutomaticAuthorityP95),
          ...(recovery.recoveryExpectedTotalP95 ? { recoveryExpectedTotalP95: cloneCost(recovery.recoveryExpectedTotalP95) } : {}),
          ...(recovery.recoveryMaximumTotalP95 ? { recoveryMaximumTotalP95: cloneCost(recovery.recoveryMaximumTotalP95) } : {})
        }
      : {})
  }
}

function alternatives(plan: ExecutionPlanDecision): ExecutionAlternativeExplanation[] {
  const selectedId = plan.selected?.proposalId
  const entries = new Map<string, ExecutionAlternativeExplanation>()
  for (const qualified of plan.qualified) {
    if (qualified.proposalId === selectedId) continue
    const tieBreak = plan.tieBreakDecisions.find((entry) => entry.loserProposalId === qualified.proposalId)
    entries.set(qualified.proposalId, {
      proposalId: qualified.proposalId,
      status: 'qualified',
      candidateIds: [...new Set(qualified.nodeCosts.map((cost) => cost.candidateId))].sort(),
      nodeIds: qualified.nodeCosts.map((cost) => cost.nodeId).sort(),
      reasonCodes: tieBreak ? [`tie-break:${tieBreak.rule}`] : [],
      expectedAggregateP95: cloneCost(qualified.expectedAggregateP95),
      maximumPathP95: cloneCost(qualified.maximumPathP95)
    })
  }
  for (const exclusion of plan.exclusions) {
    const current = entries.get(exclusion.proposalId) ?? {
      proposalId: exclusion.proposalId,
      status: 'excluded' as const,
      candidateIds: [],
      nodeIds: [],
      reasonCodes: []
    }
    if (exclusion.candidateId) current.candidateIds.push(exclusion.candidateId)
    if (exclusion.nodeId) current.nodeIds.push(exclusion.nodeId)
    current.reasonCodes.push(exclusion.code)
    current.candidateIds = [...new Set(current.candidateIds)].sort()
    current.nodeIds = [...new Set(current.nodeIds)].sort()
    current.reasonCodes = [...new Set(current.reasonCodes)].sort()
    entries.set(exclusion.proposalId, current)
  }
  return [...entries.values()].sort((left, right) => left.proposalId.localeCompare(right.proposalId))
}

/** Projects immutable planner and authority records into one deterministic, safe explanation. */
export function explainExecutionDecision(planValue: unknown, input: ExecutionExplanationInput = {}): ExecutionDecisionExplanation {
  assertExecutionPlanDecision(planValue)
  const plan = planValue
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ExecutionExplanationContractError(['explanation input must be an object'])
  const unknown = Object.keys(input).filter((field) => !['budgetDecision', 'lineage', 'outcomes'].includes(field))
  if (unknown.length) throw new ExecutionExplanationContractError([`explanation input contains unsupported fields: ${unknown.sort().join(', ')}`])
  const lineage = input.lineage
  if (lineage) {
    assertExecutionLineage(lineage)
    if (lineage.currentPlanDecisionId !== plan.id) throw new ExecutionExplanationContractError(['lineage current plan must match the explained plan'])
  }
  const lastAttempt = lineage?.attempts[lineage.attempts.length - 1]
  const evidenceRefs = new Set(plan.selected?.evidenceRefs ?? [])
  for (const attempt of lineage?.attempts ?? []) for (const reference of attempt.evidenceRefs) evidenceRefs.add(reference)
  for (const reference of input.budgetDecision?.challenge?.justification.evidenceRefs ?? []) evidenceRefs.add(reference)
  const outcomes = [...(input.outcomes ?? [])]
    .map((outcome) => {
      assertExecutionOutcomeEvidence(outcome)
      if (outcome.binding.planDecisionId !== plan.id) throw new ExecutionExplanationContractError(['outcome evidence must reference the explained plan'])
      for (const reference of outcome.evidenceRefs) evidenceRefs.add(reference)
      return {
        outcomeId: outcome.id,
        eventId: outcome.eventId,
        runId: outcome.binding.runId,
        attemptId: outcome.binding.attemptId,
        nodeId: outcome.binding.nodeId,
        candidateId: outcome.binding.candidateId,
        occurredAt: outcome.occurredAt,
        receivedAt: outcome.receivedAt,
        outcome: outcome.outcome,
        actualUsage: { ...outcome.actualUsage },
        metering: outcome.metering,
        latencyMs: outcome.latencyMs,
        validation: { result: outcome.validation.result, checks: [...outcome.validation.checks].sort() },
        retryOrdinal: outcome.binding.retryOrdinal,
        ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
        sourceKind: outcome.sourceKind,
        evidenceRefs: [...outcome.evidenceRefs].sort()
      }
    })
    .sort((left, right) => `${left.receivedAt}/${left.outcomeId}`.localeCompare(`${right.receivedAt}/${right.outcomeId}`))
  const payload: Omit<ExecutionDecisionExplanation, 'id'> = {
    schemaVersion: 1,
    planDecisionId: plan.id,
    status: plan.status,
    requirementsId: plan.requirementsId,
    catalogueFingerprint: plan.catalogueFingerprint,
    policyFingerprint: plan.policyFingerprint,
    ...(plan.selected
      ? {
          selected: {
            proposalId: plan.selected.proposalId,
            candidateId: plan.selected.rootCandidateId,
            expectedAggregateP95: cloneCost(plan.selected.expectedAggregateP95),
            maximumPathP95: cloneCost(plan.selected.maximumPathP95),
            reasonCode: plan.qualified.length === 1 ? ('sole-qualified-plan' as const) : ('minimum-expected-cost' as const)
          }
        }
      : {}),
    alternatives: alternatives(plan),
    tieBreaks: plan.tieBreakDecisions
      .map((entry) => ({ ...entry }))
      .sort((left, right) => `${left.loserProposalId}/${left.winnerProposalId}/${left.rule}`.localeCompare(`${right.loserProposalId}/${right.winnerProposalId}/${right.rule}`)),
    ...(input.budgetDecision ? { authority: authorityExplanation(input.budgetDecision, plan.id) } : {}),
    ...(lineage && lastAttempt
      ? {
          lineage: {
            lineageId: lineage.id,
            runId: lineage.runId,
            revision: lineage.revision,
            historyHead: lineage.historyHead,
            terminalState: lineage.terminalState,
            attemptCount: lineage.attempts.length,
            currentAttemptId: lineage.currentAttemptId,
            lastTrigger: lastAttempt.trigger,
            ...(lastAttempt.outcomeCode ? { lastOutcome: lastAttempt.outcomeCode } : {}),
            invalidatedPermitIds: [...lastAttempt.invalidatedPermitIds].sort()
          }
        }
      : {}),
    outcomes,
    evidenceRefs: [...evidenceRefs].sort()
  }
  return freeze({ ...payload, id: stableFingerprint(payload) })
}

export function assertExecutionDecisionExplanation(value: unknown): asserts value is ExecutionDecisionExplanation {
  if (!object(value)) throw new ExecutionExplanationContractError(['explanation must be an object'])
  const unknown = Object.keys(value).filter((field) => !EXPLANATION_FIELDS.includes(field as (typeof EXPLANATION_FIELDS)[number]))
  const issues: string[] = []
  if (unknown.length) issues.push(`explanation contains unsupported fields: ${unknown.sort().join(', ')}`)
  if (value.schemaVersion !== 1) issues.push('explanation.schemaVersion must equal 1')
  if (typeof value.id !== 'string' || !FINGERPRINT.test(value.id)) issues.push('explanation.id must be a SHA-256 fingerprint')
  if (typeof value.planDecisionId !== 'string' || !FINGERPRINT.test(value.planDecisionId)) issues.push('explanation.planDecisionId must be a SHA-256 fingerprint')
  if (typeof value.id === 'string' && FINGERPRINT.test(value.id)) {
    if (stableFingerprint(withoutId(value as unknown as ExecutionDecisionExplanation)) !== value.id) issues.push('explanation.id does not match its canonical payload')
  }
  if (issues.length) throw new ExecutionExplanationContractError(issues)
}

/** Projects adaptive routing and authority without prompts, source text, outputs, local paths, or adapter metadata. */
export function explainAdaptiveExecutionRoute(routeValue: unknown, evidenceValues: readonly ExecutionRoutingEvidence[], authorityValue?: unknown): AdaptiveExecutionRouteExplanation {
  assertExecutionRoutingDecision(routeValue)
  const route = routeValue
  const evidence = evidenceValues.map((entry) => {
    assertExecutionRoutingEvidence(entry)
    return entry
  })
  let authority: AdaptiveExecutionAuthorizationDecision | undefined
  if (authorityValue !== undefined) {
    assertAdaptiveExecutionAuthorizationDecision(authorityValue)
    authority = authorityValue
    if (authority.routingDecisionId !== route.id) throw new ExecutionExplanationContractError(['adaptive authority must reference the explained route'])
  }
  const selectedEvidence = route.selectedEvidenceId ? evidence.find((entry) => entry.id === route.selectedEvidenceId) : undefined
  if (route.status === 'selected' && (!route.selectedPlan || !route.selectedPlanId || !route.selectedMetrics || !route.selectedReason || !selectedEvidence))
    throw new ExecutionExplanationContractError(['selected route requires matching public routing evidence'])
  const evidenceRefs = new Set<string>()
  for (const reference of selectedEvidence?.evidenceRefs ?? []) evidenceRefs.add(reference)
  for (const node of selectedEvidence?.nodes ?? []) for (const reference of node.evidenceRefs) evidenceRefs.add(reference)
  const payload: Omit<AdaptiveExecutionRouteExplanation, 'id'> = {
    schemaVersion: 1,
    routingDecisionId: route.id,
    status: route.status,
    policyId: route.policyId,
    ...(route.selectedPlan && route.selectedPlanId && route.selectedMetrics && route.selectedReason && selectedEvidence
      ? {
          selected: {
            planId: route.selectedPlanId,
            candidateId: route.selectedPlan.rootCandidateId,
            reasonCode: route.selectedReason,
            metrics: { ...route.selectedMetrics },
            expectedAggregateP95: cloneCost(route.selectedPlan.expectedAggregateP95),
            maximumPathP95: cloneCost(route.selectedPlan.maximumPathP95),
            fallbackNodes: selectedEvidence.nodes
              .filter((node): node is ExecutionRoutingEvidence['nodes'][number] & { role: 'fallback' | 'retry' } => node.role === 'fallback' || node.role === 'retry')
              .map((node) => ({ nodeId: node.nodeId, candidateId: node.candidateId, role: node.role, boundary: node.boundary }))
              .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
          }
        }
      : {}),
    exclusions: route.exclusions
      .map((entry) => ({ ...entry }))
      .sort((left, right) => `${left.planId}/${left.code}/${left.detailCode}/${left.evidenceId ?? ''}`.localeCompare(`${right.planId}/${right.code}/${right.detailCode}/${right.evidenceId ?? ''}`)),
    ...(authority
      ? {
          authority: {
            decisionId: authority.id,
            status: authority.status,
            reasonCode: authority.reasonCode,
            ...(authority.budgetDecision ? { budgetStatus: authority.budgetDecision.status } : {}),
            cloudBoundaryRequired: authority.cloudBoundaryRequired,
            dispatchAuthorized: authority.dispatchAuthorized
          }
        }
      : {}),
    evidenceRefs: [...evidenceRefs].sort()
  }
  return freeze({ ...payload, id: stableFingerprint(payload) })
}

export function assertAdaptiveExecutionRouteExplanation(value: unknown): asserts value is AdaptiveExecutionRouteExplanation {
  if (!object(value)) throw new ExecutionExplanationContractError(['adaptive route explanation must be an object'])
  const issues: string[] = []
  const exact = (entry: Record<string, unknown>, allowed: readonly string[], label: string) => {
    const unknown = Object.keys(entry).filter((field) => !allowed.includes(field))
    if (unknown.length) issues.push(`${label} contains unsupported fields: ${unknown.sort().join(', ')}`)
  }
  exact(value, ['schemaVersion', 'id', 'routingDecisionId', 'status', 'policyId', 'selected', 'exclusions', 'authority', 'evidenceRefs'], 'adaptive route explanation')
  if (value.schemaVersion !== 1 || typeof value.id !== 'string' || !FINGERPRINT.test(value.id)) issues.push('adaptive route explanation identity is invalid')
  if (typeof value.routingDecisionId !== 'string' || !FINGERPRINT.test(value.routingDecisionId) || typeof value.policyId !== 'string' || !FINGERPRINT.test(value.policyId))
    issues.push('adaptive route explanation route binding is invalid')
  if (!['selected', 'unroutable'].includes(String(value.status))) issues.push('adaptive route explanation status is invalid')

  if (value.selected !== undefined) {
    if (!object(value.selected)) issues.push('adaptive route explanation selected value is invalid')
    else {
      exact(value.selected, ['planId', 'candidateId', 'reasonCode', 'metrics', 'expectedAggregateP95', 'maximumPathP95', 'fallbackNodes'], 'adaptive route explanation selected')
      if (!safeId(value.selected.planId) || !safeId(value.selected.candidateId) || !safeId(value.selected.reasonCode)) issues.push('adaptive route explanation selected identifiers are invalid')
      if (!object(value.selected.metrics)) issues.push('adaptive route explanation metrics are invalid')
      else {
        exact(
          value.selected.metrics,
          ['observedAt', 'validUntil', 'energyMilliwattHours', 'devicePressureRatio', 'failureProbability', 'fallbackExposureProbability'],
          'adaptive route explanation metrics'
        )
        const metric = value.selected.metrics
        const decimalOrNull = (entry: unknown) => entry === null || (typeof entry === 'string' && DECIMAL.test(entry))
        if (
          typeof metric.observedAt !== 'string' ||
          !Number.isFinite(Date.parse(metric.observedAt)) ||
          typeof metric.validUntil !== 'string' ||
          !Number.isFinite(Date.parse(metric.validUntil)) ||
          metric.observedAt >= metric.validUntil ||
          !decimalOrNull(metric.energyMilliwattHours) ||
          !decimalOrNull(metric.devicePressureRatio) ||
          typeof metric.failureProbability !== 'string' ||
          !DECIMAL.test(metric.failureProbability) ||
          typeof metric.fallbackExposureProbability !== 'string' ||
          !DECIMAL.test(metric.fallbackExposureProbability)
        )
          issues.push('adaptive route explanation metrics contain invalid values')
      }
      try {
        assertExactCostEvidence(value.selected.expectedAggregateP95, 'adaptive route expected cost')
        assertExactCostEvidence(value.selected.maximumPathP95, 'adaptive route maximum cost')
      } catch {
        issues.push('adaptive route explanation costs are invalid')
      }
      if (!Array.isArray(value.selected.fallbackNodes) || value.selected.fallbackNodes.length > MAX_ADAPTIVE_FALLBACK_NODES) issues.push('adaptive route explanation fallback nodes are invalid')
      else {
        const nodeIds = new Set<string>()
        let previousNodeId = ''
        for (const node of value.selected.fallbackNodes) {
          if (!object(node)) {
            issues.push('adaptive route explanation fallback node is invalid')
            continue
          }
          exact(node, ['nodeId', 'candidateId', 'role', 'boundary'], 'adaptive route explanation fallback node')
          if (!safeId(node.nodeId) || !safeId(node.candidateId) || !['fallback', 'retry'].includes(String(node.role)) || !safeId(node.boundary))
            issues.push('adaptive route explanation fallback node contains invalid values')
          if (nodeIds.has(String(node.nodeId)) || String(node.nodeId).localeCompare(previousNodeId) < 0) issues.push('adaptive route explanation fallback nodes must be unique and canonical')
          nodeIds.add(String(node.nodeId))
          previousNodeId = String(node.nodeId)
        }
      }
    }
  }
  if (value.status === 'selected' && value.selected === undefined) issues.push('selected adaptive route explanation requires selected facts')
  if (value.status === 'unroutable' && value.selected !== undefined) issues.push('unroutable adaptive route explanation cannot contain selected facts')

  if (!Array.isArray(value.exclusions) || value.exclusions.length > MAX_ADAPTIVE_EXCLUSIONS) issues.push('adaptive route explanation exclusions are invalid')
  else {
    const exclusionKeys = new Set<string>()
    let previousExclusionKey = ''
    for (const exclusion of value.exclusions) {
      if (!object(exclusion)) {
        issues.push('adaptive route explanation exclusion is invalid')
        continue
      }
      exact(exclusion, ['planId', 'code', 'detailCode', 'evidenceId'], 'adaptive route explanation exclusion')
      if (!safeId(exclusion.planId) || !safeId(exclusion.code) || !safeId(exclusion.detailCode) || (exclusion.evidenceId !== undefined && !FINGERPRINT.test(String(exclusion.evidenceId))))
        issues.push('adaptive route explanation exclusion contains invalid values')
      const key = `${String(exclusion.planId)}/${String(exclusion.code)}/${String(exclusion.detailCode)}/${String(exclusion.evidenceId ?? '')}`
      if (exclusionKeys.has(key) || key.localeCompare(previousExclusionKey) < 0) issues.push('adaptive route explanation exclusions must be unique and canonical')
      exclusionKeys.add(key)
      previousExclusionKey = key
    }
  }

  if (value.authority !== undefined) {
    if (!object(value.authority)) issues.push('adaptive route explanation authority is invalid')
    else {
      exact(value.authority, ['decisionId', 'status', 'reasonCode', 'budgetStatus', 'cloudBoundaryRequired', 'dispatchAuthorized'], 'adaptive route explanation authority')
      if (
        typeof value.authority.decisionId !== 'string' ||
        !FINGERPRINT.test(value.authority.decisionId) ||
        !['authorized', 'approval-required', 'rejected'].includes(String(value.authority.status)) ||
        !safeId(value.authority.reasonCode) ||
        (value.authority.budgetStatus !== undefined && !['authorized', 'approval-required', 'rejected'].includes(String(value.authority.budgetStatus))) ||
        typeof value.authority.cloudBoundaryRequired !== 'boolean' ||
        typeof value.authority.dispatchAuthorized !== 'boolean'
      )
        issues.push('adaptive route explanation authority contains invalid values')
    }
  }
  const evidenceRefs = value.evidenceRefs
  if (
    !Array.isArray(evidenceRefs) ||
    evidenceRefs.length > MAX_ADAPTIVE_EVIDENCE_REFS ||
    evidenceRefs.some((reference) => !safeId(reference)) ||
    new Set(evidenceRefs).size !== evidenceRefs.length ||
    evidenceRefs.some((reference, index) => index > 0 && String(reference).localeCompare(String(evidenceRefs[index - 1])) < 0)
  )
    issues.push('adaptive route explanation evidence references are invalid')
  if (issues.length) throw new ExecutionExplanationContractError(issues)
  if (stableFingerprint(withoutId(value as unknown as AdaptiveExecutionRouteExplanation)) !== value.id)
    throw new ExecutionExplanationContractError(['adaptive route explanation id does not match its canonical payload'])
}
