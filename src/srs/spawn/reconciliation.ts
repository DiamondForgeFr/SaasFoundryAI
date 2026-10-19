import { readFileSync } from 'node:fs'

export type ReconciliationClassification = 'delivered' | 'partial' | 'missing' | 'superseded'

export interface ReconciliationSourceEvidence {
  status: 'verified' | 'unavailable'
  evidence: string[]
}

export interface ReconciliationDecision {
  frId: string
  classification: ReconciliationClassification
  evidence: string[]
}

export interface ReconciliationPlan {
  version: 1
  sources: {
    board: ReconciliationSourceEvidence
    srs: ReconciliationSourceEvidence
    implementation: ReconciliationSourceEvidence
  }
  requirements: ReconciliationDecision[]
}

export interface ReconciliationRequirement {
  frId: string
  title: string
  frPageUrl: string
}

export interface ExistingSrsTicket {
  number: string
  title: string
  body?: string
  state: 'OPEN' | 'CLOSED'
  /**
   * Why GitHub closed it: `completed`, `not_planned`, or `reopened`. Absent from tickets
   * inspected by a CLI that predates the field, which then all count as they always did.
   */
  stateReason?: string | null
  boardStatus: string | null
  parentNumber: string | null
  issueType: string | null
  url: string
  srsLinks: string[]
  frIds: string[]
}

export type ReconciliationAction = 'create' | 'reuse' | 'skip'

export interface ReconciliationResult {
  requirement: ReconciliationRequirement
  decision: ReconciliationDecision
  action: ReconciliationAction
  ticket?: ExistingSrsTicket
  /** Tickets closed as not planned that carry this FR's page: seen, and left out of the match. */
  ignored: ExistingSrsTicket[]
}

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReconciliationError'
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReconciliationError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function readEvidence(value: unknown, label: string): ReconciliationSourceEvidence {
  const candidate = asObject(value, label)
  if (candidate.status !== 'verified' && candidate.status !== 'unavailable') {
    throw new ReconciliationError(`${label}.status must be "verified" or "unavailable"`)
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new ReconciliationError(`${label}.evidence must contain non-empty strings`)
  }
  return { status: candidate.status, evidence: candidate.evidence as string[] }
}

function readDecision(value: unknown, index: number): ReconciliationDecision {
  const candidate = asObject(value, `requirements[${index}]`)
  if (typeof candidate.frId !== 'string' || candidate.frId.trim() === '') {
    throw new ReconciliationError(`requirements[${index}].frId must be a non-empty string`)
  }
  const classifications: ReconciliationClassification[] = ['delivered', 'partial', 'missing', 'superseded']
  if (!classifications.includes(candidate.classification as ReconciliationClassification)) {
    throw new ReconciliationError(`requirements[${index}].classification is invalid`)
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0 || candidate.evidence.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new ReconciliationError(`requirements[${index}].evidence must contain at least one non-empty string`)
  }
  return {
    frId: candidate.frId.trim().toUpperCase(),
    classification: candidate.classification as ReconciliationClassification,
    evidence: candidate.evidence as string[]
  }
}

export function parseReconciliationPlan(value: unknown): ReconciliationPlan {
  const candidate = asObject(value, 'reconciliation plan')
  if (candidate.version !== 1) throw new ReconciliationError('reconciliation plan version must be 1')
  const sources = asObject(candidate.sources, 'sources')
  const planSources = {
    board: readEvidence(sources.board, 'sources.board'),
    srs: readEvidence(sources.srs, 'sources.srs'),
    implementation: readEvidence(sources.implementation, 'sources.implementation')
  }
  for (const [name, source] of Object.entries(planSources)) {
    if (source.status !== 'verified') {
      throw new ReconciliationError(`evidence source "${name}" is unavailable; spawning is blocked before mutation`)
    }
    if (source.evidence.length === 0) {
      throw new ReconciliationError(`evidence source "${name}" has no evidence`)
    }
  }
  if (!Array.isArray(candidate.requirements)) throw new ReconciliationError('requirements must be an array')
  const requirements = candidate.requirements.map(readDecision)
  const duplicates = requirements.filter((decision, index) => requirements.findIndex((other) => other.frId === decision.frId) !== index)
  if (duplicates.length > 0) {
    throw new ReconciliationError(`duplicate reconciliation decision for ${duplicates[0].frId}`)
  }
  return { version: 1, sources: planSources, requirements }
}

export function loadReconciliationPlan(path: string): ReconciliationPlan {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ReconciliationError(`could not read reconciliation plan ${path} — ${message}`)
  }
  try {
    return parseReconciliationPlan(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error instanceof ReconciliationError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ReconciliationError(`could not parse reconciliation plan ${path} — ${message}`)
  }
}

export function canonicalSrsIdentity(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    const isNotionHost = ['notion.so', 'notion.com', 'notion.site'].some((domain) => host === domain || host.endsWith(`.${domain}`))
    if (isNotionHost) {
      const compactId = parsed.pathname.match(/([0-9a-f]{32})$/i)?.[1]
      if (compactId) return compactId.toLowerCase()
      const uuid = parsed.pathname.match(/([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i)
      if (uuid) return uuid.slice(1).join('').toLowerCase()
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    // Non-URL provider identities still compare exactly after harmless casing
    // and trailing-slash normalization; they never collapse to a Notion id.
  }
  return trimmed.toLowerCase()
}

function matchesCanonicalPage(ticket: ExistingSrsTicket, requirement: ReconciliationRequirement): boolean {
  const expected = canonicalSrsIdentity(requirement.frPageUrl)
  return ticket.srsLinks.some((link) => canonicalSrsIdentity(link) === expected)
}

/**
 * Closed as not planned is how a duplicate is closed. Its body keeps the FR page link it was
 * spawned with, so left in the match it makes the FR ambiguous with the ticket that replaced it
 * (FR-AEX-007 matched #929 and #1028). A ticket closed as completed still counts: that FR was
 * delivered.
 */
export function isClosedAsNotPlanned(ticket: ExistingSrsTicket): boolean {
  return ticket.state === 'CLOSED' && ticket.stateReason?.toLowerCase() === 'not_planned'
}

function isAggregateEpic(ticket: ExistingSrsTicket): boolean {
  // Aggregate Epics commonly catalogue every canonical FR link in their body.
  // They are evidence containers, not alternative implementations of each FR.
  // Treating those links as canonical Story matches makes every correctly-linked
  // Epic ambiguous with its own native children.
  return ticket.issueType?.toLowerCase() === 'sf-epic'
}

function isFrDeliveryTicket(ticket: ExistingSrsTicket): boolean {
  return !isAggregateEpic(ticket) && !isClosedAsNotPlanned(ticket)
}

function canonicalMatches(requirement: ReconciliationRequirement, tickets: ExistingSrsTicket[]): ExistingSrsTicket[] {
  return tickets.filter(isFrDeliveryTicket).filter((ticket) => matchesCanonicalPage(ticket, requirement))
}

/** The tickets closed as not planned that carry this FR's page, so a preview can say it left them out. */
function ignoredMatches(requirement: ReconciliationRequirement, tickets: ExistingSrsTicket[]): ExistingSrsTicket[] {
  return tickets.filter((ticket) => !isAggregateEpic(ticket) && isClosedAsNotPlanned(ticket) && matchesCanonicalPage(ticket, requirement))
}

function ambiguousPageReason(frId: string, exact: ExistingSrsTicket[]): string | undefined {
  if (exact.length > 1) return `${frId} is ambiguous: canonical SRS page matches tickets ${exact.map((ticket) => `#${ticket.number}`).join(', ')}`
  return undefined
}

/**
 * Why an FR that is going to be created or reused cannot be, safely: a ticket names its id
 * without owning its page, or the ticket that owns the page belongs to another delivery tree.
 */
function unsafeReuseReason(requirement: ReconciliationRequirement, frId: string, tickets: ExistingSrsTicket[], exact: ExistingSrsTicket[], parentTicket: string | null): string | undefined {
  const idOnly = tickets.filter(isFrDeliveryTicket).filter((ticket) => ticket.frIds.map((id) => id.toUpperCase()).includes(frId) && !matchesCanonicalPage(ticket, requirement))
  if (exact.length === 0 && idOnly.length > 0) {
    return `${frId} is ambiguous: ticket ${idOnly.map((ticket) => `#${ticket.number}`).join(', ')} matches the id but not the canonical SRS page`
  }
  const ticket = exact[0]
  if (ticket?.parentNumber && ticket.parentNumber !== parentTicket) {
    return `${frId} already belongs to parent #${ticket.parentNumber} through ticket #${ticket.number}; it will not be reparented implicitly`
  }
  return undefined
}

/** What the board already holds for one FR, found from its canonical page alone. */
export interface ExistingTicketMatch {
  requirement: ReconciliationRequirement
  /** The one ticket, open or closed, that carries this FR's canonical page. */
  ticket?: ExistingSrsTicket
  /** Why spawn must stop instead of choosing: several candidates, or a ticket owned elsewhere. */
  blocked?: string
  /** Tickets closed as not planned that carry this FR's page: seen, and left out of the match. */
  ignored: ExistingSrsTicket[]
}

/**
 * The reuse rules of `reconcileRequirements` with no evidence plan: an FR whose canonical
 * ticket exists is reused, never created again, and any doubt blocks instead of guessing.
 * Nothing is classified delivered or superseded here: that takes evidence this path does not
 * have, so an FR with no ticket is simply missing.
 *
 * It reports every FR rather than throwing at the first, so a preview can show them all.
 */
export function matchExistingTickets(requirements: ReconciliationRequirement[], tickets: ExistingSrsTicket[], parentTicket: string | null): ExistingTicketMatch[] {
  return requirements.map((requirement) => {
    const frId = requirement.frId.toUpperCase()
    const exact = canonicalMatches(requirement, tickets)
    const ignored = ignoredMatches(requirement, tickets)
    const blocked = ambiguousPageReason(frId, exact) ?? unsafeReuseReason(requirement, frId, tickets, exact, parentTicket)
    if (blocked) return { requirement, blocked, ignored }
    return { requirement, ticket: exact[0], ignored }
  })
}

/**
 * `parentTicket` is the delivery parent the Stories will hang under, or null while spawn has
 * yet to create the version Epic: then any ticket that already has a parent blocks, since
 * nothing could legitimately own it.
 */
export function reconcileRequirements(requirements: ReconciliationRequirement[], plan: ReconciliationPlan, tickets: ExistingSrsTicket[], parentTicket: string | null): ReconciliationResult[] {
  const expectedIds = new Set(requirements.map((requirement) => requirement.frId.toUpperCase()))
  const decisionIds = new Set(plan.requirements.map((decision) => decision.frId))
  const missingDecisions = [...expectedIds].filter((frId) => !decisionIds.has(frId))
  const extraDecisions = [...decisionIds].filter((frId) => !expectedIds.has(frId))
  if (missingDecisions.length > 0 || extraDecisions.length > 0) {
    const details = [missingDecisions.length > 0 ? `missing decisions: ${missingDecisions.join(', ')}` : '', extraDecisions.length > 0 ? `unknown decisions: ${extraDecisions.join(', ')}` : '']
      .filter(Boolean)
      .join('; ')
    throw new ReconciliationError(`reconciliation plan does not exactly cover the selected SRS version (${details})`)
  }

  return requirements.map((requirement) => {
    const frId = requirement.frId.toUpperCase()
    const decision = plan.requirements.find((item) => item.frId === frId)!
    const exact = canonicalMatches(requirement, tickets)
    const ambiguous = ambiguousPageReason(frId, exact)
    if (ambiguous) throw new ReconciliationError(ambiguous)
    const ticket = exact[0]
    const ignored = ignoredMatches(requirement, tickets)
    if (decision.classification === 'delivered' || decision.classification === 'superseded') {
      // No issue will be created or reused for skipped scope. Historical audit
      // tickets may mention the FR id without owning its canonical page; those
      // references are evidence, not a reparenting candidate.
      return { requirement, decision, action: 'skip', ticket, ignored }
    }
    const unsafe = unsafeReuseReason(requirement, frId, tickets, exact, parentTicket)
    if (unsafe) throw new ReconciliationError(unsafe)
    if (ticket) return { requirement, decision, action: 'reuse', ticket, ignored }
    return { requirement, decision, action: 'create', ignored }
  })
}
