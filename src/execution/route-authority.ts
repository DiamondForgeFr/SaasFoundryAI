import {
  type ExecutionBudgetApprovalChallenge,
  type ExecutionBudgetApprovalGrant,
  type ExecutionBudgetAuthorizationInput,
  type ExecutionBudgetDecision,
  type SessionWorkloadEvidence,
  validateExecutionPlanBudget
} from './budget'
import { stableFingerprint } from './overrides'
import { fingerprintExecutionCandidateCatalogue, selectMinimumCostExecutionPlan } from './planner'
import type { ExecutionPlanSelectionPolicy } from './plans'
import type { ExecutionRequirementSet } from './requirements'
import {
  assertExecutionRoutingDecision,
  selectExecutionRoute,
  type ExecutionRoutingDecision,
  type ExecutionRoutingEvidence,
  type ExecutionRoutingNodeEvidence,
  type ExecutionRoutingPolicy
} from './routing'
import type { ExecutionCandidateCatalogueSnapshot } from './types'

const SAFE_ID = /^[a-z0-9][a-z0-9._:/-]{0,127}$/i
const FINGERPRINT = /^[a-f0-9]{64}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SECRET_LIKE =
  /(?:\bBearer\s+|\b(?:sk|gh[pousr]|github_pat|xox[baprs])[_-]|\beyJ[a-zA-Z0-9_-]{8,}\.|(?:api[_-]?key|authorization|client[_-]?secret|cookie|credentials?|password|private[_-]?key|refresh[_-]?token|session[_-]?id|access[_-]?token|token)\s*[:=])/i
const CONTENT_SCOPES = ['prompt', 'source', 'generated-content', 'tool-input', 'tool-output'] as const

export type ExecutionCloudContentScope = (typeof CONTENT_SCOPES)[number]
export type AdaptiveExecutionAuthorizationStatus = 'authorized' | 'approval-required' | 'rejected'
export type AdaptiveExecutionAuthorizationReasonCode =
  | 'route-authorized'
  | 'route-not-selected'
  | 'budget-approval-required'
  | 'cloud-boundary-approval-required'
  | 'budget-and-cloud-boundary-approval-required'
  | 'independent-approval-required'
  | 'cloud-boundary-approval-mismatch'
  | 'routing-evidence-host-rejected'
  | 'dispatch-manifest-rejected'
  | 'route-evidence-stale'
  | 'approval-host-rejected'
  | 'budget-rejected'

export interface ExecutionCloudBoundaryContext {
  dispatchManifest: ExecutionCloudDispatchManifest
  triggerRefs: string[]
  rationaleRefs: string[]
}

export interface ExecutionCloudDispatchManifest {
  schemaVersion: 1
  id: string
  routingDecisionId: string
  proposalFingerprint: string
  cloudNodeIds: string[]
  generatedAt: string
  validUntil: string
  parts: Array<{ scope: ExecutionCloudContentScope; contentRef: string; byteLength: number; sha256: string }>
}

export type CreateExecutionCloudDispatchManifestInput = Omit<ExecutionCloudDispatchManifest, 'schemaVersion' | 'id'>

export interface ExecutionCloudBoundaryApprovalChallenge {
  schemaVersion: 1
  id: string
  routingDecisionId: string
  budgetPlanDecisionId: string
  proposalFingerprint: string
  requirementsId: string
  catalogueFingerprint: string
  planningPolicyFingerprint: string
  routingPolicyId: string
  routingEvidenceId: string
  dispatchManifestId: string
  contentScopes: ExecutionCloudContentScope[]
  triggerRefs: string[]
  rationaleRefs: string[]
  cloudNodes: Array<{
    nodeId: string
    candidateId: string
    role: ExecutionRoutingNodeEvidence['role']
    boundary: ExecutionRoutingNodeEvidence['boundary']
  }>
  quotedAt: string
  validUntil: string
}

export interface ExecutionCloudBoundaryApprovalGrant {
  schemaVersion: 1
  /** Unique host approval event or nonce. */
  id: string
  challengeId: string
  routingDecisionId: string
  budgetPlanDecisionId: string
  approvedAt: string
  validUntil: string
  approvedByRef: string
}

export interface AdaptiveExecutionAuthorizationInput {
  evaluatedAt: string
  budget?: Omit<ExecutionBudgetAuthorizationInput, 'evaluatedAt'>
  cloudBoundary?: ExecutionCloudBoundaryContext & { approval?: unknown }
}

export interface AdaptiveExecutionAuthorizationDecision {
  schemaVersion: 1
  id: string
  status: AdaptiveExecutionAuthorizationStatus
  reasonCode: AdaptiveExecutionAuthorizationReasonCode
  evaluatedAt: string
  routingDecisionId: string
  selectedPlanId?: string
  budgetDecision?: ExecutionBudgetDecision
  cloudBoundaryRequired: boolean
  cloudBoundaryChallenge?: ExecutionCloudBoundaryApprovalChallenge
  cloudBoundaryApprovalEventId?: string
  dispatchPermit?: AdaptiveExecutionDispatchPermit
  dispatchAuthorized: boolean
}

export interface AdaptiveExecutionDispatchPermit {
  schemaVersion: 1
  id: string
  routingDecisionId: string
  budgetPlanDecisionId: string
  proposalFingerprint: string
  dispatchManifestId?: string
  cloudNodeIds: string[]
  issuedAt: string
  validUntil: string
}

export interface AdaptiveExecutionHostAuthority {
  requirements: ExecutionRequirementSet
  proposals: readonly unknown[]
  routingEvidence: readonly ExecutionRoutingEvidence[]
  verifyRoutingEvidence(
    evidence: Readonly<ExecutionRoutingEvidence>,
    binding: Readonly<{ requirementsId: string; catalogueFingerprint: string; routingPolicyId: string; planningAt: string; evaluatedAt: string }>
  ): boolean
  verifyDispatchManifest(manifest: Readonly<ExecutionCloudDispatchManifest>, challenge: Readonly<ExecutionCloudBoundaryApprovalChallenge>): boolean
  verifySessionEvidence(evidence: Readonly<SessionWorkloadEvidence>): boolean
  verifyBudgetApprovalGrant(grant: Readonly<ExecutionBudgetApprovalGrant>, challenge: Readonly<ExecutionBudgetApprovalChallenge>): boolean
  verifyCloudBoundaryApprovalGrant(grant: Readonly<ExecutionCloudBoundaryApprovalGrant>, challenge: Readonly<ExecutionCloudBoundaryApprovalChallenge>): boolean
  /** Atomically consumes every approval event used by one final route. */
  consumeRouteAuthority(input: Readonly<{ permit: AdaptiveExecutionDispatchPermit; budgetApprovalEventId?: string; cloudBoundaryApprovalEventId?: string }>): boolean
}

export class AdaptiveExecutionAuthorizationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid adaptive execution authorization: ${issues.join('; ')}`)
    this.name = 'AdaptiveExecutionAuthorizationError'
    this.issues = [...issues]
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !SECRET_LIKE.test(value)
}

function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) freeze(entry)
    Object.freeze(value)
  }
  return value
}

function finalize<T extends object>(value: T): T & { id: string } {
  return freeze({ ...value, id: stableFingerprint(value) })
}

function canonicalSafeIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !safeId(entry)) || new Set(value).size !== value.length)
    throw new AdaptiveExecutionAuthorizationError([`${label} must contain unique safe references`])
  return [...value].sort()
}

export function createExecutionCloudDispatchManifest(input: CreateExecutionCloudDispatchManifestInput): ExecutionCloudDispatchManifest {
  const value = finalize({ schemaVersion: 1 as const, ...input })
  assertExecutionCloudDispatchManifest(value)
  return value
}

export function assertExecutionCloudDispatchManifest(value: unknown): asserts value is ExecutionCloudDispatchManifest {
  if (!object(value)) throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest must be an object'])
  const allowed = ['schemaVersion', 'id', 'routingDecisionId', 'proposalFingerprint', 'cloudNodeIds', 'generatedAt', 'validUntil', 'parts']
  if (Object.keys(value).some((field) => !allowed.includes(field))) throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest contains unsupported fields'])
  if (
    value.schemaVersion !== 1 ||
    !fingerprint(value.id) ||
    !fingerprint(value.routingDecisionId) ||
    !fingerprint(value.proposalFingerprint) ||
    !timestamp(value.generatedAt) ||
    !timestamp(value.validUntil) ||
    value.generatedAt >= value.validUntil
  )
    throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest identity or validity is invalid'])
  canonicalSafeIds(value.cloudNodeIds, 'cloud dispatch manifest cloudNodeIds')
  if (!Array.isArray(value.parts) || value.parts.length === 0 || value.parts.length > 64) throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest parts are invalid'])
  const partKeys = new Set<string>()
  for (const part of value.parts) {
    if (!object(part) || Object.keys(part).some((field) => !['scope', 'contentRef', 'byteLength', 'sha256'].includes(field)))
      throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest part contains unsupported fields'])
    if (
      !CONTENT_SCOPES.includes(part.scope as ExecutionCloudContentScope) ||
      !safeId(part.contentRef) ||
      !Number.isSafeInteger(part.byteLength) ||
      Number(part.byteLength) < 0 ||
      !fingerprint(part.sha256)
    )
      throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest part is invalid'])
    const key = `${part.scope}/${part.contentRef}`
    if (partKeys.has(key)) throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest parts must be unique'])
    partKeys.add(key)
  }
  const { id: manifestId, ...payload } = value
  if (stableFingerprint(payload) !== manifestId) throw new AdaptiveExecutionAuthorizationError(['cloud dispatch manifest id does not match canonical content'])
}

function canonicalBoundaryContext(value: unknown): ExecutionCloudBoundaryContext {
  if (!object(value)) throw new AdaptiveExecutionAuthorizationError(['cloud boundary context is required for a local-to-cloud route'])
  const allowed = ['dispatchManifest', 'triggerRefs', 'rationaleRefs', 'approval']
  if (Object.keys(value).some((field) => !allowed.includes(field))) throw new AdaptiveExecutionAuthorizationError(['cloud boundary context contains unsupported fields'])
  assertExecutionCloudDispatchManifest(value.dispatchManifest)
  return {
    dispatchManifest: value.dispatchManifest,
    triggerRefs: canonicalSafeIds(value.triggerRefs, 'cloud boundary triggerRefs'),
    rationaleRefs: canonicalSafeIds(value.rationaleRefs, 'cloud boundary rationaleRefs')
  }
}

function cloudFallbackNodes(route: ExecutionRoutingDecision, evidence: readonly ExecutionRoutingEvidence[]): { evidence: ExecutionRoutingEvidence; nodes: ExecutionRoutingNodeEvidence[] } | null {
  if (route.status !== 'selected' || !route.selectedPlanId || !route.selectedEvidenceId || route.selectedPlan?.rootRuntimeKind !== 'local') return null
  const selectedEvidence = evidence.find((entry) => entry.id === route.selectedEvidenceId && entry.planId === route.selectedPlanId)
  if (!selectedEvidence) throw new AdaptiveExecutionAuthorizationError(['selected routing evidence is unavailable'])
  const nodes = selectedEvidence.nodes.filter((node) => node.runtimeKind !== 'local')
  return nodes.length > 0 ? { evidence: selectedEvidence, nodes } : null
}

function boundaryChallenge(
  route: ExecutionRoutingDecision,
  budgetPlanDecisionId: string,
  requirements: ExecutionRequirementSet,
  catalogue: ExecutionCandidateCatalogueSnapshot,
  planningPolicy: ExecutionPlanSelectionPolicy,
  routingPolicy: ExecutionRoutingPolicy,
  fallback: { evidence: ExecutionRoutingEvidence; nodes: ExecutionRoutingNodeEvidence[] },
  context: ExecutionCloudBoundaryContext
): ExecutionCloudBoundaryApprovalChallenge {
  const selected = route.selectedPlan!
  return finalize({
    schemaVersion: 1 as const,
    routingDecisionId: route.id,
    budgetPlanDecisionId,
    proposalFingerprint: selected.proposalFingerprint,
    requirementsId: requirements.id,
    catalogueFingerprint: fingerprintExecutionCandidateCatalogue(catalogue),
    planningPolicyFingerprint: stableFingerprint(planningPolicy),
    routingPolicyId: routingPolicy.id,
    routingEvidenceId: fallback.evidence.id,
    dispatchManifestId: context.dispatchManifest.id,
    cloudNodes: fallback.nodes
      .map((node) => ({ nodeId: node.nodeId, candidateId: node.candidateId, role: node.role, boundary: node.boundary }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    contentScopes: [...new Set(context.dispatchManifest.parts.map((part) => part.scope))].sort(),
    triggerRefs: context.triggerRefs,
    rationaleRefs: context.rationaleRefs,
    quotedAt: route.evaluatedAt,
    validUntil: [selected.validUntil, fallback.evidence.validUntil, routingPolicy.validUntil, context.dispatchManifest.validUntil].sort()[0]
  })
}

function sameCanonicalValues(left: readonly string[], right: readonly string[]): boolean {
  const canonicalLeft = [...left].sort()
  const canonicalRight = [...right].sort()
  return canonicalLeft.length === canonicalRight.length && canonicalLeft.every((value, index) => value === canonicalRight[index])
}

function createDispatchPermit(
  route: ExecutionRoutingDecision & { selectedPlanId: string; selectedPlan: NonNullable<ExecutionRoutingDecision['selectedPlan']> },
  budgetPlanDecisionId: string,
  fallback: { evidence: ExecutionRoutingEvidence; nodes: ExecutionRoutingNodeEvidence[] } | null,
  manifest: ExecutionCloudDispatchManifest | undefined,
  routingPolicy: ExecutionRoutingPolicy,
  evaluatedAt: string,
  budgetGrant?: ExecutionBudgetApprovalGrant,
  boundaryGrant?: ExecutionCloudBoundaryApprovalGrant
): AdaptiveExecutionDispatchPermit {
  const validity = [route.selectedPlan.validUntil, routingPolicy.validUntil]
  if (fallback) validity.push(fallback.evidence.validUntil)
  if (manifest) validity.push(manifest.validUntil)
  if (budgetGrant) validity.push(budgetGrant.validUntil)
  if (boundaryGrant) validity.push(boundaryGrant.validUntil)
  return finalize({
    schemaVersion: 1 as const,
    routingDecisionId: route.id,
    budgetPlanDecisionId,
    proposalFingerprint: route.selectedPlan.proposalFingerprint,
    ...(manifest ? { dispatchManifestId: manifest.id } : {}),
    cloudNodeIds: fallback ? fallback.nodes.map((node) => node.nodeId).sort() : [],
    issuedAt: evaluatedAt,
    validUntil: validity.sort()[0]
  })
}

export function assertAdaptiveExecutionDispatchPermit(value: unknown): asserts value is AdaptiveExecutionDispatchPermit {
  if (!object(value)) throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit must be an object'])
  const allowed = ['schemaVersion', 'id', 'routingDecisionId', 'budgetPlanDecisionId', 'proposalFingerprint', 'dispatchManifestId', 'cloudNodeIds', 'issuedAt', 'validUntil']
  if (Object.keys(value).some((field) => !allowed.includes(field))) throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit contains unsupported fields'])
  if (
    value.schemaVersion !== 1 ||
    !fingerprint(value.id) ||
    !fingerprint(value.routingDecisionId) ||
    !fingerprint(value.budgetPlanDecisionId) ||
    !fingerprint(value.proposalFingerprint) ||
    (value.dispatchManifestId !== undefined && !fingerprint(value.dispatchManifestId)) ||
    !timestamp(value.issuedAt) ||
    !timestamp(value.validUntil) ||
    value.issuedAt >= value.validUntil
  )
    throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit identity or validity is invalid'])
  if (!Array.isArray(value.cloudNodeIds) || value.cloudNodeIds.some((entry) => !safeId(entry)) || new Set(value.cloudNodeIds).size !== value.cloudNodeIds.length)
    throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit cloudNodeIds must contain unique safe references'])
  const cloudNodeIds = [...(value.cloudNodeIds as string[])].sort()
  if (!sameCanonicalValues(value.cloudNodeIds as string[], cloudNodeIds) || value.cloudNodeIds.some((entry, index) => entry !== cloudNodeIds[index]))
    throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit cloudNodeIds must be canonical'])
  if (cloudNodeIds.length > 0 !== (value.dispatchManifestId !== undefined)) throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit cloud binding is invalid'])
  const { id, ...payload } = value
  if (stableFingerprint(payload) !== id) throw new AdaptiveExecutionAuthorizationError(['adaptive execution dispatch permit id does not match canonical content'])
}

function normalizeBoundaryGrant(value: unknown, challenge: ExecutionCloudBoundaryApprovalChallenge, evaluatedAt: string): ExecutionCloudBoundaryApprovalGrant | null {
  if (!object(value)) return null
  const allowed = ['schemaVersion', 'id', 'challengeId', 'routingDecisionId', 'budgetPlanDecisionId', 'approvedAt', 'validUntil', 'approvedByRef']
  if (Object.keys(value).some((field) => !allowed.includes(field))) return null
  if (
    value.schemaVersion !== 1 ||
    !safeId(value.id) ||
    value.challengeId !== challenge.id ||
    value.routingDecisionId !== challenge.routingDecisionId ||
    value.budgetPlanDecisionId !== challenge.budgetPlanDecisionId ||
    !timestamp(value.approvedAt) ||
    !timestamp(value.validUntil) ||
    value.approvedAt < challenge.quotedAt ||
    value.approvedAt > evaluatedAt ||
    evaluatedAt >= value.validUntil ||
    value.validUntil > challenge.validUntil ||
    !safeId(value.approvedByRef)
  )
    return null
  return freeze({
    schemaVersion: 1,
    id: value.id,
    challengeId: value.challengeId,
    routingDecisionId: value.routingDecisionId,
    budgetPlanDecisionId: value.budgetPlanDecisionId,
    approvedAt: value.approvedAt,
    validUntil: value.validUntil,
    approvedByRef: value.approvedByRef
  }) as ExecutionCloudBoundaryApprovalGrant
}

function result(value: Omit<AdaptiveExecutionAuthorizationDecision, 'id'>): AdaptiveExecutionAuthorizationDecision {
  return finalize(value)
}

/** Qualifies all proposals with the existing exact cost engine, then applies the adaptive policy. */
export function selectAdaptiveExecutionRoute(
  proposals: readonly unknown[],
  requirements: ExecutionRequirementSet,
  catalogue: ExecutionCandidateCatalogueSnapshot,
  planningPolicy: ExecutionPlanSelectionPolicy,
  routingEvidence: readonly ExecutionRoutingEvidence[],
  routingPolicy: ExecutionRoutingPolicy,
  evaluatedAt = planningPolicy.planningAt
): ExecutionRoutingDecision {
  if (planningPolicy.planningAt < routingPolicy.generatedAt || planningPolicy.planningAt >= routingPolicy.validUntil)
    throw new AdaptiveExecutionAuthorizationError(['routing policy must be current at planning time'])
  if (planningPolicy.settlementCurrency !== routingPolicy.settlementCurrency) throw new AdaptiveExecutionAuthorizationError(['planning and routing policies must use the same settlement currency'])
  const qualified = selectMinimumCostExecutionPlan(proposals, requirements, catalogue, planningPolicy).qualified
  return selectExecutionRoute(qualified, catalogue, requirements, routingEvidence, routingPolicy, evaluatedAt)
}

/** Recomputes adaptive selection and applies budget plus cloud-boundary authority before dispatch. */
export function authorizeAdaptiveExecutionRoute(
  routeValue: unknown,
  sessionValue: unknown,
  catalogue: ExecutionCandidateCatalogueSnapshot,
  planningPolicy: ExecutionPlanSelectionPolicy,
  routingPolicy: ExecutionRoutingPolicy,
  input: AdaptiveExecutionAuthorizationInput,
  host: AdaptiveExecutionHostAuthority
): AdaptiveExecutionAuthorizationDecision {
  assertExecutionRoutingDecision(routeValue)
  const route = routeValue
  if (!object(input) || !timestamp(input.evaluatedAt)) throw new AdaptiveExecutionAuthorizationError(['evaluatedAt must be a canonical UTC timestamp'])
  if (
    !object(host) ||
    !object(host.requirements) ||
    !Array.isArray(host.proposals) ||
    !Array.isArray(host.routingEvidence) ||
    typeof host.verifyRoutingEvidence !== 'function' ||
    typeof host.verifyDispatchManifest !== 'function' ||
    typeof host.verifySessionEvidence !== 'function' ||
    typeof host.verifyBudgetApprovalGrant !== 'function' ||
    typeof host.verifyCloudBoundaryApprovalGrant !== 'function' ||
    typeof host.consumeRouteAuthority !== 'function'
  )
    throw new AdaptiveExecutionAuthorizationError(['host authority callbacks and authoritative routing inputs are required'])
  if (input.evaluatedAt < planningPolicy.planningAt || input.evaluatedAt >= routingPolicy.validUntil)
    throw new AdaptiveExecutionAuthorizationError(['routing policy must be current at authorization time'])
  const catalogueFingerprint = fingerprintExecutionCandidateCatalogue(catalogue)
  const evidenceIds = new Set<string>()
  const evidencePlanIds = new Set<string>()
  for (const evidence of host.routingEvidence) {
    if (evidenceIds.has(evidence.id) || evidencePlanIds.has(evidence.planId)) throw new AdaptiveExecutionAuthorizationError(['routing evidence must be unique by ID and plan'])
    evidenceIds.add(evidence.id)
    evidencePlanIds.add(evidence.planId)
    let verified = false
    try {
      verified =
        host.verifyRoutingEvidence(evidence, {
          requirementsId: host.requirements.id,
          catalogueFingerprint,
          routingPolicyId: routingPolicy.id,
          planningAt: planningPolicy.planningAt,
          evaluatedAt: input.evaluatedAt
        }) === true
    } catch {
      verified = false
    }
    if (!verified)
      return result({
        schemaVersion: 1,
        status: 'rejected',
        reasonCode: 'routing-evidence-host-rejected',
        evaluatedAt: input.evaluatedAt,
        routingDecisionId: route.id,
        cloudBoundaryRequired: false,
        dispatchAuthorized: false
      })
  }
  const recomputed = selectAdaptiveExecutionRoute(host.proposals, host.requirements, catalogue, planningPolicy, host.routingEvidence, routingPolicy)
  if (recomputed.id !== route.id) throw new AdaptiveExecutionAuthorizationError(['route must match recomputed authoritative evidence'])
  if (route.status !== 'selected' || !route.selectedPlanId || !route.selectedPlan)
    return result({
      schemaVersion: 1,
      status: 'rejected',
      reasonCode: 'route-not-selected',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      cloudBoundaryRequired: false,
      dispatchAuthorized: false
    })
  const currentRoute = selectAdaptiveExecutionRoute(host.proposals, host.requirements, catalogue, planningPolicy, host.routingEvidence, routingPolicy, input.evaluatedAt)
  if (currentRoute.status !== 'selected' || currentRoute.selectedPlanId !== route.selectedPlanId || currentRoute.selectedPlan?.proposalFingerprint !== route.selectedPlan.proposalFingerprint)
    return result({
      schemaVersion: 1,
      status: 'rejected',
      reasonCode: 'route-evidence-stale',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      selectedPlanId: route.selectedPlanId,
      cloudBoundaryRequired: false,
      dispatchAuthorized: false
    })

  const matchingProposals = host.proposals.filter((proposal) => object(proposal) && proposal.id === route.selectedPlanId)
  if (matchingProposals.length !== 1) throw new AdaptiveExecutionAuthorizationError(['selected route must map to one authoritative proposal'])
  const budgetPlan = selectMinimumCostExecutionPlan(matchingProposals, host.requirements, catalogue, planningPolicy)
  if (budgetPlan.status !== 'selected' || budgetPlan.selected?.proposalFingerprint !== route.selectedPlan.proposalFingerprint)
    throw new AdaptiveExecutionAuthorizationError(['selected route and authoritative budget proposal do not match'])

  let verifiedBudgetGrant: ExecutionBudgetApprovalGrant | undefined
  const budgetDecision = validateExecutionPlanBudget(
    budgetPlan,
    sessionValue,
    catalogue,
    planningPolicy,
    { evaluatedAt: input.evaluatedAt, ...(input.budget ?? {}) },
    {
      requirements: host.requirements,
      proposals: matchingProposals,
      verifySessionEvidence: host.verifySessionEvidence,
      verifyApprovalGrant: (grant, challenge) => {
        let verified = false
        try {
          verified = host.verifyBudgetApprovalGrant(grant, challenge) === true
        } catch {
          verified = false
        }
        if (verified) verifiedBudgetGrant = grant
        return verified
      }
    }
  )

  const fallback = cloudFallbackNodes(route, host.routingEvidence)
  let challenge: ExecutionCloudBoundaryApprovalChallenge | undefined
  let verifiedBoundaryGrant: ExecutionCloudBoundaryApprovalGrant | undefined
  let dispatchManifest: ExecutionCloudDispatchManifest | undefined
  if (fallback) {
    const context = canonicalBoundaryContext(input.cloudBoundary)
    dispatchManifest = context.dispatchManifest
    const expectedCloudNodeIds = fallback.nodes.map((node) => node.nodeId)
    if (
      dispatchManifest.routingDecisionId !== route.id ||
      dispatchManifest.proposalFingerprint !== route.selectedPlan.proposalFingerprint ||
      !sameCanonicalValues(dispatchManifest.cloudNodeIds, expectedCloudNodeIds) ||
      dispatchManifest.generatedAt > input.evaluatedAt ||
      input.evaluatedAt >= dispatchManifest.validUntil
    )
      return result({
        schemaVersion: 1,
        status: 'rejected',
        reasonCode: 'dispatch-manifest-rejected',
        evaluatedAt: input.evaluatedAt,
        routingDecisionId: route.id,
        selectedPlanId: route.selectedPlanId,
        budgetDecision,
        cloudBoundaryRequired: true,
        dispatchAuthorized: false
      })
    challenge = boundaryChallenge(route, budgetPlan.id, host.requirements, catalogue, planningPolicy, routingPolicy, fallback, context)
    let manifestVerified = false
    try {
      manifestVerified = host.verifyDispatchManifest(dispatchManifest, challenge) === true
    } catch {
      manifestVerified = false
    }
    if (!manifestVerified)
      return result({
        schemaVersion: 1,
        status: 'rejected',
        reasonCode: 'dispatch-manifest-rejected',
        evaluatedAt: input.evaluatedAt,
        routingDecisionId: route.id,
        selectedPlanId: route.selectedPlanId,
        budgetDecision,
        cloudBoundaryRequired: true,
        cloudBoundaryChallenge: challenge,
        dispatchAuthorized: false
      })
    const grant = normalizeBoundaryGrant(input.cloudBoundary?.approval, challenge, input.evaluatedAt)
    if (grant) {
      let verified = false
      try {
        verified = host.verifyCloudBoundaryApprovalGrant(grant, challenge) === true
      } catch {
        verified = false
      }
      if (verified) verifiedBoundaryGrant = grant
    }
    if (input.cloudBoundary?.approval !== undefined && !verifiedBoundaryGrant)
      return result({
        schemaVersion: 1,
        status: 'rejected',
        reasonCode: 'cloud-boundary-approval-mismatch',
        evaluatedAt: input.evaluatedAt,
        routingDecisionId: route.id,
        selectedPlanId: route.selectedPlanId,
        budgetDecision,
        cloudBoundaryRequired: true,
        cloudBoundaryChallenge: challenge,
        dispatchAuthorized: false
      })
  }

  const budgetNeedsApproval = budgetDecision.status === 'approval-required'
  const boundaryNeedsApproval = Boolean(fallback && !verifiedBoundaryGrant)
  if (budgetNeedsApproval || boundaryNeedsApproval)
    return result({
      schemaVersion: 1,
      status: 'approval-required',
      reasonCode: budgetNeedsApproval && boundaryNeedsApproval ? 'budget-and-cloud-boundary-approval-required' : budgetNeedsApproval ? 'budget-approval-required' : 'cloud-boundary-approval-required',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      selectedPlanId: route.selectedPlanId,
      budgetDecision,
      cloudBoundaryRequired: Boolean(fallback),
      ...(challenge ? { cloudBoundaryChallenge: challenge } : {}),
      dispatchAuthorized: false
    })
  if (budgetDecision.status !== 'authorized')
    return result({
      schemaVersion: 1,
      status: 'rejected',
      reasonCode: 'budget-rejected',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      selectedPlanId: route.selectedPlanId,
      budgetDecision,
      cloudBoundaryRequired: Boolean(fallback),
      ...(challenge ? { cloudBoundaryChallenge: challenge } : {}),
      dispatchAuthorized: false
    })
  if (budgetDecision.nonMonetaryApprovalRequired)
    return result({
      schemaVersion: 1,
      status: 'approval-required',
      reasonCode: 'independent-approval-required',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      selectedPlanId: route.selectedPlanId,
      budgetDecision,
      cloudBoundaryRequired: Boolean(fallback),
      ...(challenge ? { cloudBoundaryChallenge: challenge } : {}),
      dispatchAuthorized: false
    })

  const budgetApprovalEventId = verifiedBudgetGrant?.id
  const cloudBoundaryApprovalEventId = verifiedBoundaryGrant?.id
  const dispatchPermit = createDispatchPermit(
    route as ExecutionRoutingDecision & { selectedPlanId: string; selectedPlan: NonNullable<ExecutionRoutingDecision['selectedPlan']> },
    budgetPlan.id,
    fallback,
    dispatchManifest,
    routingPolicy,
    input.evaluatedAt,
    verifiedBudgetGrant,
    verifiedBoundaryGrant
  )
  let consumed = false
  try {
    consumed =
      host.consumeRouteAuthority({
        permit: dispatchPermit,
        ...(budgetApprovalEventId ? { budgetApprovalEventId } : {}),
        ...(cloudBoundaryApprovalEventId ? { cloudBoundaryApprovalEventId } : {})
      }) === true
  } catch {
    consumed = false
  }
  if (!consumed)
    return result({
      schemaVersion: 1,
      status: 'rejected',
      reasonCode: 'approval-host-rejected',
      evaluatedAt: input.evaluatedAt,
      routingDecisionId: route.id,
      selectedPlanId: route.selectedPlanId,
      budgetDecision,
      cloudBoundaryRequired: Boolean(fallback),
      ...(challenge ? { cloudBoundaryChallenge: challenge } : {}),
      dispatchAuthorized: false
    })

  return result({
    schemaVersion: 1,
    status: 'authorized',
    reasonCode: 'route-authorized',
    evaluatedAt: input.evaluatedAt,
    routingDecisionId: route.id,
    selectedPlanId: route.selectedPlanId,
    budgetDecision,
    cloudBoundaryRequired: Boolean(fallback),
    ...(challenge ? { cloudBoundaryChallenge: challenge } : {}),
    ...(cloudBoundaryApprovalEventId ? { cloudBoundaryApprovalEventId } : {}),
    dispatchPermit,
    dispatchAuthorized: true
  })
}

export function assertAdaptiveExecutionAuthorizationDecision(value: unknown): asserts value is AdaptiveExecutionAuthorizationDecision {
  if (!object(value) || value.schemaVersion !== 1 || !fingerprint(value.id) || !fingerprint(value.routingDecisionId) || !timestamp(value.evaluatedAt))
    throw new AdaptiveExecutionAuthorizationError(['authorization decision contract is invalid'])
  if (!['authorized', 'approval-required', 'rejected'].includes(String(value.status)) || typeof value.dispatchAuthorized !== 'boolean' || typeof value.cloudBoundaryRequired !== 'boolean')
    throw new AdaptiveExecutionAuthorizationError(['authorization decision state is invalid'])
  const { id, ...payload } = value
  if (stableFingerprint(payload) !== id) throw new AdaptiveExecutionAuthorizationError(['authorization decision id does not match canonical content'])
}
