/**
 * Resources
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

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

/** The refusal shown in the role detail sheet, above its actions. */
export function RoleDeleteRefusalNotice({ refusal }: { refusal: RoleDeleteRefusal }) {
  const { t: tAccount } = useTranslation('account')
  return (
    <div role="alert" data-testid="role-delete-refusal" className="border-destructive/40 bg-destructive/10 text-destructive mx-6 mb-3 flex gap-2 rounded-[2px] border px-3 py-2 text-[11px] leading-snug">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-bold">{tAccount(refusal.kind === 'in-use' ? 'roles.tk_delete-in-use_' : 'roles.tk_delete-failed_')}</p>
        {refusal.detail && <p className="text-foreground/80 break-words">{refusal.detail}</p>}
      </div>
    </div>
  )
}
