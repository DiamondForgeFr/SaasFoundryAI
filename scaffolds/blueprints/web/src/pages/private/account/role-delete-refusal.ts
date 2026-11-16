/**
 * Declaration
 */
const ROLE_IN_USE_PREFIX = 'ROLE_IN_USE:'

/** Why the API refused to delete a role: a role still in use (#1221), or any other failure. */
export type RoleDeleteRefusal = { kind: 'in-use'; detail: string } | { kind: 'failed'; detail: string }

/**
 * Read a failed role delete. Both API clients throw an `Error` carrying the HTTP `status` and the response
 * `body`. A role still assigned, or carried by a pending invitation, answers 409 with a message prefixed
 * `ROLE_IN_USE:` that names its holders: the panel shows that list as the API wrote it.
 */
export function roleDeleteRefusalOf(error: unknown): RoleDeleteRefusal {
  const { status, body, message } = (error ?? {}) as { status?: number; body?: { message?: unknown }; message?: unknown }
  const apiMessage = typeof body?.message === 'string' ? body.message : typeof message === 'string' ? message : ''
  if (status === 409 || apiMessage.startsWith(ROLE_IN_USE_PREFIX)) {
    return { kind: 'in-use', detail: apiMessage.startsWith(ROLE_IN_USE_PREFIX) ? apiMessage.slice(ROLE_IN_USE_PREFIX.length).trim() : apiMessage }
  }
  return { kind: 'failed', detail: apiMessage }
}
