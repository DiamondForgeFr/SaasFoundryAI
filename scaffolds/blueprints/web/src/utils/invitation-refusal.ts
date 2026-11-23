/**
 * Declaration
 */
const USER_ALREADY_ACTIVE_PREFIX = 'USER_ALREADY_ACTIVE:'

/** Why the API refused an invitation: the address already belongs to an active user (#988), or any other failure. */
export type InvitationRefusal = { kind: 'already-active'; detail: string } | { kind: 'failed'; detail: string }

/**
 * Read a failed `POST /invitations`. Both API clients throw an `Error` carrying the HTTP `status` and the response
 * `body`. An address that already belongs to an active user answers 409 with a message prefixed
 * `USER_ALREADY_ACTIVE:`: nothing was sent, and the invite dialogs show it on the email field.
 */
export function invitationRefusalOf(error: unknown): InvitationRefusal {
  const { status, body, message } = (error ?? {}) as { status?: number; body?: { message?: unknown }; message?: unknown }
  const apiMessage = typeof body?.message === 'string' ? body.message : typeof message === 'string' ? message : ''
  if (status === 409 || apiMessage.startsWith(USER_ALREADY_ACTIVE_PREFIX)) {
    return { kind: 'already-active', detail: apiMessage.startsWith(USER_ALREADY_ACTIVE_PREFIX) ? apiMessage.slice(USER_ALREADY_ACTIVE_PREFIX.length).trim() : apiMessage }
  }
  return { kind: 'failed', detail: apiMessage }
}
