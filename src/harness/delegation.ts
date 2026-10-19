/**
 * Consent to delegate ticket delivery to background agents, each in its own worktree (#1026).
 *
 * Asked once per project and shared through the manifest (`modules.harness.delegation`), so a
 * later session does not ask again. Only `sf agents delegation` writes it: the coding agent never
 * hand-edits the manifest. A missing block means the developer was not asked yet.
 */
export const TICKET_DELIVERY_DECISIONS = ['allowed', 'declined'] as const
export type TicketDeliveryDecision = (typeof TICKET_DELIVERY_DECISIONS)[number]

/** `modules.harness.delegation` as recorded in `.saasfoundry.json`. */
export interface HarnessDelegation {
  ticketDelivery: TicketDeliveryDecision
  /** ISO-8601 time of the developer's answer. */
  decidedAt: string
}

/** What a reader gets: the recorded decision, or `not-asked` while the block is missing. */
export interface DelegationState {
  ticketDelivery: TicketDeliveryDecision | 'not-asked'
  decidedAt?: string
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const isTicketDeliveryDecision = (value: unknown): value is TicketDeliveryDecision => (TICKET_DELIVERY_DECISIONS as readonly unknown[]).includes(value)

/** Validate a recorded block; the message names the manifest field so a hand edit is easy to find. */
export function validateDelegation(value: unknown): asserts value is HarnessDelegation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid manifest harness delegation: expected an object.')
  const record = value as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => key !== 'ticketDelivery' && key !== 'decidedAt')
  if (extra.length) throw new Error(`Invalid manifest harness delegation: unknown key ${extra.join(', ')}.`)
  if (!isTicketDeliveryDecision(record.ticketDelivery)) throw new Error(`Invalid manifest harness delegation: ticketDelivery must be ${TICKET_DELIVERY_DECISIONS.join(' or ')}.`)
  if (typeof record.decidedAt !== 'string' || !ISO_DATE_TIME.test(record.decidedAt) || Number.isNaN(Date.parse(record.decidedAt)))
    throw new Error('Invalid manifest harness delegation: decidedAt must be an ISO-8601 date-time.')
}

export function resolveDelegation(delegation: HarnessDelegation | undefined): DelegationState {
  return delegation ? { ticketDelivery: delegation.ticketDelivery, decidedAt: delegation.decidedAt } : { ticketDelivery: 'not-asked' }
}
