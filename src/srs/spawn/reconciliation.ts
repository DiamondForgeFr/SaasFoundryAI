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

function isFrDeliveryTicket(ticket: ExistingSrsTicket): boolean {
  // Aggregate Epics commonly catalogue every canonical FR link in their body.
  // They are evidence containers, not alternative implementations of each FR.
  // Treating those links as canonical Story matches makes every correctly-linked
  // Epic ambiguous with its own native children.
  return ticket.issueType?.toLowerCase() !== 'sf-epic'
}

export function reconcileRequirements(requirements: ReconciliationRequirement[], plan: ReconciliationPlan, tickets: ExistingSrsTicket[], parentTicket: string): ReconciliationResult[] {
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
    const deliveryTickets = tickets.filter(isFrDeliveryTicket)
    const exact = deliveryTickets.filter((ticket) => matchesCanonicalPage(ticket, requirement))
    if (exact.length > 1) {
      throw new ReconciliationError(`${frId} is ambiguous: canonical SRS page matches tickets ${exact.map((ticket) => `#${ticket.number}`).join(', ')}`)
    }
    const ticket = exact[0]
    if (decision.classification === 'delivered' || decision.classification === 'superseded') {
      // No issue will be created or reused for skipped scope. Historical audit
      // tickets may mention the FR id without owning its canonical page; those
      // references are evidence, not a reparenting candidate.
      return { requirement, decision, action: 'skip', ticket }
    }
    const idOnly = deliveryTickets.filter((ticket) => ticket.frIds.map((id) => id.toUpperCase()).includes(frId) && !matchesCanonicalPage(ticket, requirement))
    if (exact.length === 0 && idOnly.length > 0) {
      throw new ReconciliationError(`${frId} is ambiguous: ticket ${idOnly.map((ticket) => `#${ticket.number}`).join(', ')} matches the id but not the canonical SRS page`)
    }
    if (ticket?.parentNumber && ticket.parentNumber !== parentTicket) {
      throw new ReconciliationError(`${frId} already belongs to parent #${ticket.parentNumber} through ticket #${ticket.number}; it will not be reparented implicitly`)
    }
    if (ticket) return { requirement, decision, action: 'reuse', ticket }
    return { requirement, decision, action: 'create' }
  })
}
