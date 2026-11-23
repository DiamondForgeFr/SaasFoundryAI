/**
 * Resources
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

/**
 * Types
 */
import type { RoleDeleteRefusal } from '@/pages/private/account/role-delete-refusal'

/**
 * Declaration
 */

/** The refusal of a role delete (`roleDeleteRefusalOf`), shown in the role detail sheet above its actions. */
export function RoleDeleteRefusalNotice({ refusal }: { refusal: RoleDeleteRefusal }) {
  const { t: tAccount } = useTranslation('account')
  return (
    <div
      role="alert"
      data-testid="role-delete-refusal"
      className="border-destructive/40 bg-destructive/10 text-destructive mx-6 mb-3 flex gap-2 rounded-[2px] border px-3 py-2 text-[11px] leading-snug"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-bold">{tAccount(refusal.kind === 'in-use' ? 'roles.tk_delete-in-use_' : 'roles.tk_delete-failed_')}</p>
        {refusal.detail && <p className="text-foreground/80 break-words">{refusal.detail}</p>}
      </div>
    </div>
  )
}
