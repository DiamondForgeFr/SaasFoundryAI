/**
 * Resources
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, PowerOff, Shield, ShieldCheck } from 'lucide-react'

/**
 * Dependencies
 */
import { useAccountRoles } from '@/hooks/api/accounts/queries/useAccountRoles'
import { useUpdateAccountUser } from '@/hooks/api/accounts/mutations/useUpdateAccountUser'

/**
 * Components
 */
import { cn } from '@/utils/ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { WaveButton } from '@/components/ui/custom/wave-button'

export type EditUserTarget = {
  userId: string
  email: string
  fullName: string
  isActive: boolean
  isDirectlyLinked: boolean
  accountId: string
  /** Roles currently assigned at the ACCOUNT scope (on this account) — names only. */
  currentAccountRoleNames: string[]
  /** Per-entity ENTITY-scoped roles currently held — names per entityId. */
  currentEntityRoleNamesByEntityId: Record<string, string[]>
  /** Entities the user is linked to (within this account). */
  linkedEntities: { id: string; name: string }[]
}

type EditUserDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  target: EditUserTarget | null
}

/**
 * Edit a user inside the current account context:
 *  - flip their isActive status
 *  - replace their ACCOUNT-scoped role set on this account
 *  - replace their ENTITY-scoped role set per linked entity
 *
 * The role catalog is fetched scoped to this account (system templates + custom roles owned by it).
 * Roles are pre-selected from the user's current assignments — toggling builds a desired-state list
 * that the backend reconciles.
 */
export function EditUserDialog({ isOpen, onOpenChange, target }: EditUserDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const updateMutation = useUpdateAccountUser()

  const [isActive, setIsActive] = useState(true)
  const [accountRoleIds, setAccountRoleIds] = useState<Set<number>>(new Set())
  const [entityRoleIdsByEntityId, setEntityRoleIdsByEntityId] = useState<Record<string, Set<number>>>({})

  const { data: rolesData } = useAccountRoles(target?.accountId ?? '', { limit: 100 })
  // IMPORTANT: derive the array via useMemo so the fallback `[]` doesn't allocate a fresh
  // reference on every render. Without this, the downstream `accountScopeRoles` /
  // `entityScopeRoles` useMemos see a new dependency each render → recompute → the
  // initialization useEffect re-fires → setState → re-render → infinite loop. Triggered
  // whenever `useAccountRoles` is in a loading/refetching state (e.g. after the role-status
  // mutation invalidates the cache).
  const allRoles = useMemo(() => rolesData?.items ?? [], [rolesData])
  const accountScopeRoles = useMemo(() => allRoles.filter((r) => r.scope === 'ACCOUNT' && r.name.toLowerCase() !== 'guest'), [allRoles])
  const entityScopeRoles = useMemo(() => allRoles.filter((r) => r.scope === 'ENTITY'), [allRoles])

  // Initialize selections every time the dialog opens with a fresh target.
  useEffect(() => {
    if (!isOpen || !target) return
    setIsActive(target.isActive)

    const accountIds = new Set<number>()
    for (const r of accountScopeRoles) {
      if (target.currentAccountRoleNames.includes(r.name)) accountIds.add(r.id)
    }
    setAccountRoleIds(accountIds)

    const next: Record<string, Set<number>> = {}
    for (const entity of target.linkedEntities) {
      const ids = new Set<number>()
      const heldNames = target.currentEntityRoleNamesByEntityId[entity.id] ?? []
      for (const r of entityScopeRoles) {
        if (heldNames.includes(r.name)) ids.add(r.id)
      }
      next[entity.id] = ids
    }
    setEntityRoleIdsByEntityId(next)
  }, [isOpen, target, accountScopeRoles, entityScopeRoles])

  const toggleAccountRole = (id: number) =>
    setAccountRoleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleEntityRole = (entityId: string, roleId: number) =>
    setEntityRoleIdsByEntityId((prev) => {
      const current = new Set(prev[entityId] ?? [])
      if (current.has(roleId)) current.delete(roleId)
      else current.add(roleId)
      return { ...prev, [entityId]: current }
    })

  const handleSubmit = async () => {
    if (!target) return
    try {
      await updateMutation.mutateAsync({
        accountId: target.accountId,
        targetUserId: target.userId,
        isActive,
        // Only send the account-roles slice if the user is directly linked to the account.
        accountRoleIds: target.isDirectlyLinked ? Array.from(accountRoleIds) : undefined,
        entityRoleIds: target.linkedEntities.map((e) => ({ entityId: e.id, roleIds: Array.from(entityRoleIdsByEntityId[e.id] ?? []) }))
      })
      onOpenChange(false)
    } catch (e) {
      console.error('Failed to update user', e)
    }
  }

  if (!target) return null

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{tAccount('users.edit.tk_title_', { name: target.fullName || target.email })}</DialogTitle>
          <DialogDescription>{tAccount('users.edit.tk_description_')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Identity (read-only summary) */}
          <div className="rounded-sm border border-border bg-secondary px-3 py-2">
            <div className="text-[12px] font-bold text-foreground">{target.fullName || target.email}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{target.email}</div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.edit.tk_section-status_')}</p>
            <div className="flex items-center justify-between rounded-sm border border-border bg-secondary px-3 py-2">
              <div className="flex items-center gap-2">
                {isActive ? <Power className="h-3.5 w-3.5 text-emerald-500" /> : <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-[12px] font-bold text-foreground">{tAccount(isActive ? 'users.edit.tk_active-on_' : 'users.edit.tk_active-off_')}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  'cursor-pointer rounded-[2px] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
                  isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                )}
              >
                {tAccount(isActive ? 'users.edit.tk_toggle-on_' : 'users.edit.tk_toggle-off_')}
              </button>
            </div>
          </div>

          {/* Account-scoped roles — only when the user is directly linked to the account */}
          {target.isDirectlyLinked && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {tAccount('users.edit.tk_section-account-roles_')}
                <span className="ml-1 text-muted-foreground/70 normal-case font-normal">
                  · {accountRoleIds.size} {tAccount('users.edit.tk_selected_')}
                </span>
              </p>
              <div className="space-y-1">
                {accountScopeRoles.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">{tAccount('users.edit.tk_no-roles-available_')}</p>
                ) : (
                  accountScopeRoles.map((role) => {
                    const checked = accountRoleIds.has(role.id)
                    const knownKeys = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
                    const key = role.name.toLowerCase()
                    const displayName = role.isSystem && knownKeys.includes(key) ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : role.name
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleAccountRole(role.id)}
                        className={cn(
                          'cursor-pointer w-full flex items-center justify-between rounded-[2px] border px-2.5 py-2 text-left transition-colors',
                          checked ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Shield className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          <span className="text-[12px] font-bold text-foreground capitalize truncate">{displayName}</span>
                          {role.isSystem && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">system</span>}
                        </div>
                        <span className={cn('text-[10px] font-bold uppercase tracking-wider', checked ? 'text-primary' : 'text-muted-foreground')}>
                          {tAccount(checked ? 'users.edit.tk_assigned_' : 'users.edit.tk_assign_')}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Entity-scoped roles, grouped per linked entity */}
          {target.linkedEntities.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.edit.tk_section-entity-roles_')}</p>
              {target.linkedEntities.map((entity) => {
                const selected = entityRoleIdsByEntityId[entity.id] ?? new Set<number>()
                return (
                  <div key={entity.id} className="rounded-sm border border-border bg-secondary px-3 py-2.5">
                    <div className="text-[12px] font-bold text-foreground mb-2">{entity.name}</div>
                    {entityScopeRoles.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">{tAccount('users.edit.tk_no-roles-available_')}</p>
                    ) : (
                      <div className="space-y-1">
                        {entityScopeRoles.map((role) => {
                          const checked = selected.has(role.id)
                          const knownKeys = ['entity-admin']
                          const key = role.name.toLowerCase()
                          const displayName = role.isSystem && knownKeys.includes(key) ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : role.name
                          return (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => toggleEntityRole(entity.id, role.id)}
                              className={cn(
                                'cursor-pointer w-full flex items-center justify-between rounded-[2px] border px-2.5 py-2 text-left transition-colors',
                                checked ? 'border-amber-500 bg-amber-500/10' : 'border-border bg-card hover:border-amber-500/40'
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <ShieldCheck className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                <span className="text-[12px] font-bold text-foreground capitalize truncate">{displayName}</span>
                              </div>
                              <span className={cn('text-[10px] font-bold uppercase tracking-wider', checked ? 'text-amber-500' : 'text-muted-foreground')}>
                                {tAccount(checked ? 'users.edit.tk_assigned_' : 'users.edit.tk_assign_')}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-[2px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {tCommon('actions.tk_cancel_')}
          </button>
          <WaveButton type="button" disabled={updateMutation.isLoading} onClick={handleSubmit}>
            {updateMutation.isLoading ? tCommon('actions.tk_loading_') : tAccount('users.edit.tk_submit_')}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
