/**
 * Resources
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Eye, Globe, Lock, Shield, ShieldCheck } from 'lucide-react'

/**
 * Dependencies
 */
import { useCreateCustomRole, useUpdateCustomRole } from '@/hooks/api/accounts/mutations/useCustomRole'
import { usePermissionsCatalog } from '@/hooks/api/accounts/queries/usePermissionsCatalog'

/**
 * Components
 */
import { cn } from '@/utils/ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Input } from '@/components/ui/shadcn/input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Skeleton } from '@/components/ui/shadcn/skeleton'

import type { RoleScope } from '@/hooks/api/auth'

export type RoleEditorTarget =
  | { mode: 'create'; accountId: string | null; allowPlatformScope?: boolean; lockToEntityScope?: boolean }
  | {
      mode: 'edit'
      accountId: string | null
      role: {
        id: number
        name: string
        description: string | null
        scope: RoleScope
        isSystem: boolean
        subModules: string[]
        permissions: string[]
      }
    }

type CreateRoleDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Backwards-compat — used when only `accountId` is provided (create-mode shortcut). */
  accountId?: string
  target?: RoleEditorTarget
}

/**
 * Role editor — handles both create and edit modes.
 *
 * - Create: name + description + scope + permissions filtered by `applicableScopes`
 * - Edit (custom role)  : same fields all editable
 * - Edit (system role)  : name/scope locked; only permissions can be changed
 */
export function CreateRoleDialog({ isOpen, onOpenChange, accountId, target }: CreateRoleDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')

  // Resolve the target — prop `target` wins over the legacy `accountId` shortcut.
  const resolvedTarget: RoleEditorTarget | null = target ?? (accountId ? { mode: 'create', accountId } : null)
  const isEdit = resolvedTarget?.mode === 'edit'
  const editing = resolvedTarget?.mode === 'edit' ? resolvedTarget.role : null
  const isSystemEdit = editing?.isSystem === true

  const allowPlatformScope = resolvedTarget?.mode === 'create' && resolvedTarget.allowPlatformScope === true
  const lockToEntityScope = resolvedTarget?.mode === 'create' && resolvedTarget.lockToEntityScope === true

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // Default to PLATFORM in PLATFORM_ALL create mode (the only sensible scope when no account
  // is in the picture); ENTITY when the caller (entity-admin context) locked the scope; otherwise
  // ACCOUNT for the regular per-account create flow.
  const [scope, setScope] = useState<RoleScope>(allowPlatformScope ? 'PLATFORM' : lockToEntityScope ? 'ENTITY' : 'ACCOUNT')
  const [selectedPermissionNames, setSelectedPermissionNames] = useState<Set<string>>(new Set())
  // Sections (sub-modules) explicitly toggled VISIBLE. A section granting no action = read-only.
  const [selectedSubModuleNames, setSelectedSubModuleNames] = useState<Set<string>>(new Set())
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set())

  const { data: catalog, isLoading: isLoadingCatalog } = usePermissionsCatalog(isOpen)
  const createMutation = useCreateCustomRole()
  const updateMutation = useUpdateCustomRole()

  // (Re)initialize state every time the dialog opens, based on the current target.
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setDescription('')
      setScope(allowPlatformScope ? 'PLATFORM' : lockToEntityScope ? 'ENTITY' : 'ACCOUNT')
      setSelectedPermissionNames(new Set())
      setSelectedSubModuleNames(new Set())
      setExpandedModules(new Set())
      return
    }
    if (editing) {
      setName(editing.name)
      setDescription(editing.description ?? '')
      setScope(editing.scope)
      setSelectedPermissionNames(new Set(editing.permissions))
      setSelectedSubModuleNames(new Set(editing.subModules))
    }
  }, [isOpen, editing, allowPlatformScope, lockToEntityScope])

  // Drop selected permissions that don't apply to the current scope (only relevant in create mode).
  useEffect(() => {
    if (!catalog || isEdit) return
    const validNames = new Set<string>()
    for (const mod of catalog) {
      for (const p of mod.permissions) {
        if (p.applicableScopes.includes(scope)) validNames.add(p.name)
      }
    }
    setSelectedPermissionNames((prev) => new Set([...prev].filter((n) => validNames.has(n))))
  }, [scope, catalog, isEdit])

  // Catalog filtered by the role's scope (in edit mode the role's scope is the source of truth).
  // Each module carries its scope-applicable standalone permissions plus its sections (sub-modules),
  // each section carrying its own scope-applicable actions. A section with no permissions at all is a
  // pure read-only section (e.g. OVERVIEW) and stays visible so it can be toggled on its own.
  const effectiveScope: RoleScope = editing ? editing.scope : scope
  const filteredCatalog = useMemo(() => {
    if (!catalog) return []
    return catalog
      .map((mod) => {
        const standalonePermissions = mod.standalonePermissions.filter((p) => p.applicableScopes.includes(effectiveScope))
        const subModules = mod.subModules
          // Keep a section if it offers a scope-applicable action, or if it has no actions at all (pure read-only).
          .filter((sm) => sm.permissions.length === 0 || sm.permissions.some((p) => p.applicableScopes.includes(effectiveScope)))
          .map((sm) => ({ ...sm, permissions: sm.permissions.filter((p) => p.applicableScopes.includes(effectiveScope)) }))
        return { ...mod, standalonePermissions, subModules }
      })
      .filter((mod) => mod.standalonePermissions.length > 0 || mod.subModules.length > 0)
  }, [catalog, effectiveScope])

  const togglePermission = (permName: string, subModuleName: string | null) => {
    setSelectedPermissionNames((prev) => {
      const next = new Set(prev)
      const willSelect = !next.has(permName)
      if (willSelect) next.add(permName)
      else next.delete(permName)
      // Granting an action auto-includes (and locks on) its section.
      if (willSelect && subModuleName) {
        setSelectedSubModuleNames((prevSm) => {
          if (prevSm.has(subModuleName)) return prevSm
          const nextSm = new Set(prevSm)
          nextSm.add(subModuleName)
          return nextSm
        })
      }
      return next
    })
  }

  // A section toggle controls read-visibility. Turning a section OFF also clears the actions under it
  // (a permission can't be held without its section per the integrity trigger). Turning it ON alone =
  // read-only section.
  const toggleSubModule = (subModuleName: string, sectionPermissionNames: string[]) => {
    setSelectedSubModuleNames((prev) => {
      const next = new Set(prev)
      const willSelect = !next.has(subModuleName)
      if (willSelect) next.add(subModuleName)
      else {
        next.delete(subModuleName)
        setSelectedPermissionNames((prevPerm) => {
          const nextPerm = new Set(prevPerm)
          for (const pn of sectionPermissionNames) nextPerm.delete(pn)
          return nextPerm
        })
      }
      return next
    })
  }

  const toggleModule = (moduleId: number) => {
    setExpandedModules((prev) => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  // Map names → ids for the API call
  const selectedPermissionIds = useMemo(() => {
    if (!catalog) return [] as number[]
    const out: number[] = []
    for (const mod of catalog) {
      for (const p of mod.permissions) {
        if (selectedPermissionNames.has(p.name)) out.push(p.id)
      }
    }
    return out
  }, [catalog, selectedPermissionNames])

  const selectedSubModuleIds = useMemo(() => {
    if (!catalog) return [] as number[]
    const out: number[] = []
    for (const mod of catalog) {
      for (const sm of mod.subModules) {
        if (selectedSubModuleNames.has(sm.name)) out.push(sm.id)
      }
    }
    return out
  }, [catalog, selectedSubModuleNames])

  const isLoading = createMutation.isLoading || updateMutation.isLoading

  // Validation pattern matches the other dialogs in the app: the submit button stays enabled,
  // clicking with invalid input populates `errors` which renders inline below each affected
  // field. Reset errors when fields are edited so the user gets immediate feedback.
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({})

  useEffect(() => {
    setErrors({})
  }, [isOpen])

  const handleSubmit = async () => {
    if (!resolvedTarget) return
    const nextErrors: { name?: string; permissions?: string } = {}
    if (!isEdit) {
      const trimmed = name.trim()
      if (trimmed.length < 2) nextErrors.name = tAccount('roles.create.tk_error-name-min_')
      else if (trimmed.length > 30) nextErrors.name = tAccount('roles.create.tk_error-name-max_')
    }
    // A role must grant at least one section (read-only) OR one action.
    if (selectedPermissionIds.length === 0 && selectedSubModuleIds.length === 0) nextErrors.permissions = tAccount('roles.create.tk_error-permissions-empty_')
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    try {
      if (resolvedTarget.mode === 'create') {
        await createMutation.mutateAsync({
          accountId: resolvedTarget.accountId,
          name: name.trim(),
          description: description.trim() || null,
          scope,
          subModuleIds: selectedSubModuleIds,
          permissionIds: selectedPermissionIds
        })
      } else {
        const payload: { roleId: number; accountId: string | null; name?: string; description?: string | null; subModuleIds?: number[]; permissionIds?: number[] } = {
          roleId: resolvedTarget.role.id,
          accountId: resolvedTarget.accountId,
          subModuleIds: selectedSubModuleIds,
          permissionIds: selectedPermissionIds
        }
        // System roles: backend rejects name/description changes — do not send them.
        if (!resolvedTarget.role.isSystem) {
          payload.name = name.trim()
          payload.description = description.trim() || null
        }
        await updateMutation.mutateAsync(payload)
      }
      onOpenChange(false)
    } catch (e) {
      console.error('Failed to save role', e)
    }
  }

  const dialogTitle = isEdit ? (isSystemEdit ? tAccount('roles.edit.tk_title-system_') : tAccount('roles.edit.tk_title-custom_')) : tAccount('roles.tk_create_')
  const dialogDescription = isEdit ? (isSystemEdit ? tAccount('roles.edit.tk_description-system_') : tAccount('roles.edit.tk_description-custom_')) : tAccount('roles.tk_create-description_')

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* A — Identity */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('roles.create.tk_section-identity_')}</p>
            <div>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={tAccount('roles.create.tk_name-placeholder_')}
                className={cn('h-9 text-sm disabled:opacity-60 disabled:cursor-not-allowed', errors.name && 'border-destructive focus:border-destructive')}
                maxLength={30}
                disabled={isSystemEdit}
              />
              {errors.name && <p className="mt-1 text-[11px] text-destructive">{errors.name}</p>}
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tAccount('roles.create.tk_description-placeholder_')}
              className="h-9 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              maxLength={255}
              disabled={isSystemEdit}
            />
            {isSystemEdit && (
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3" />
                {tAccount('roles.edit.tk_system-locked-hint_')}
              </p>
            )}
          </div>

          {/* B — Scope.
              Tile-as-radio. Edit mode locks the scope; create mode lets the user pick.
              The PLATFORM tile is only offered when the dialog is opened from the platform-wide
              view (`allowPlatformScope`). Disabled tiles get a clear opacity cue.

              Why all 3 are clickable in PLATFORM_ALL: from the platform view a platform-admin
              creates GLOBAL TEMPLATES — a role with `accountId IS NULL`, visible from every
              account. The role's `scope` axis (PLATFORM / ACCOUNT / ENTITY) tells the runtime
              at which layer the assignment will materialise when it's later attached to a user. */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('roles.create.tk_section-scope_')}</p>
            <div className={cn('grid gap-2', allowPlatformScope ? 'grid-cols-3' : 'grid-cols-2')}>
              {allowPlatformScope && (
                <ScopeTile
                  selected={effectiveScope === 'PLATFORM'}
                  disabled={isEdit && editing?.scope !== 'PLATFORM'}
                  onClick={() => !isEdit && setScope('PLATFORM')}
                  icon={<Globe className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />}
                  label={tAccount('roles.create.tk_scope-platform_')}
                  sub={tAccount('roles.create.tk_scope-platform-sub_')}
                />
              )}
              <ScopeTile
                selected={effectiveScope === 'ACCOUNT'}
                disabled={(isEdit && editing?.scope !== 'ACCOUNT') || lockToEntityScope}
                onClick={() => !isEdit && !lockToEntityScope && setScope('ACCOUNT')}
                icon={<Shield className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />}
                label={tAccount('roles.create.tk_scope-account_')}
                sub={tAccount('roles.create.tk_scope-account-sub_')}
              />
              <ScopeTile
                selected={effectiveScope === 'ENTITY'}
                disabled={isEdit && editing?.scope !== 'ENTITY'}
                onClick={() => !isEdit && setScope('ENTITY')}
                icon={<ShieldCheck className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                label={tAccount('roles.create.tk_scope-entity_')}
                sub={tAccount('roles.create.tk_scope-entity-sub_')}
              />
            </div>
            {/* Heads-up note in edit mode (scope is locked once a role exists). */}
            {isEdit && <p className="text-[11px] text-muted-foreground">{tAccount('roles.edit.tk_scope-locked-note_')}</p>}
          </div>

          {/* C — Access (sections + actions).
              Sections (sub-modules) are read-visibility toggles; a section ON with no action under it
              is a read-only section. Granting an action auto-selects (and locks on) its section. Simple
              modules expose their permissions directly. */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {tAccount('roles.create.tk_section-permissions_')}{' '}
              <span className="text-muted-foreground/70 normal-case font-normal">
                · {selectedSubModuleNames.size + selectedPermissionNames.size} {tAccount('roles.create.tk_selected_')}
              </span>
            </p>
            <div className={cn('max-h-[260px] overflow-y-auto rounded-sm border p-1.5 space-y-1', errors.permissions ? 'border-destructive' : 'border-border')}>
              {isLoadingCatalog ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-sm" />)
              ) : filteredCatalog.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">{tAccount('roles.create.tk_no-permissions-for-scope_')}</div>
              ) : (
                filteredCatalog.map((mod) => {
                  const isExpanded = expandedModules.has(mod.moduleId)
                  const selectedInModule =
                    mod.standalonePermissions.filter((p) => selectedPermissionNames.has(p.name)).length +
                    mod.subModules.reduce((acc, sm) => acc + (selectedSubModuleNames.has(sm.name) ? 1 : 0) + sm.permissions.filter((p) => selectedPermissionNames.has(p.name)).length, 0)
                  const totalInModule = mod.standalonePermissions.length + mod.subModules.reduce((acc, sm) => acc + 1 + sm.permissions.length, 0)
                  return (
                    <div key={mod.moduleId} className="rounded-sm border border-border bg-secondary">
                      <button type="button" onClick={() => toggleModule(mod.moduleId)} className="cursor-pointer w-full flex items-center justify-between px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="text-[12px] font-bold text-foreground">{mod.moduleName}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {selectedInModule}/{totalInModule}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-border px-2.5 py-2 space-y-2">
                          {/* Sections (sub-modules) */}
                          {mod.subModules.map((sm) => {
                            const sectionChecked = selectedSubModuleNames.has(sm.name)
                            const sectionPermNames = sm.permissions.map((p) => p.name)
                            return (
                              <div key={sm.id} className="rounded-[2px] border border-border/60 bg-background/30">
                                <button
                                  type="button"
                                  onClick={() => toggleSubModule(sm.name, sectionPermNames)}
                                  className={cn(
                                    'cursor-pointer w-full flex items-start gap-2 rounded-[2px] px-2 py-1.5 text-left transition-colors',
                                    sectionChecked ? 'bg-primary/10' : 'hover:bg-background/50'
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[2px] border',
                                      sectionChecked ? 'border-primary bg-primary' : 'border-border'
                                    )}
                                  >
                                    {sectionChecked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-bold text-foreground inline-flex items-center gap-1.5">
                                      <Eye className="h-3 w-3 text-muted-foreground" />
                                      {sm.name}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground line-clamp-2">{sm.description}</div>
                                  </div>
                                </button>
                                {sm.permissions.length > 0 && (
                                  <div className="border-t border-border/60 pl-5 pr-2 py-1.5 space-y-1">
                                    {sm.permissions.map((p) => (
                                      <PermissionRow
                                        key={p.id}
                                        name={p.name}
                                        description={p.description}
                                        checked={selectedPermissionNames.has(p.name)}
                                        onClick={() => togglePermission(p.name, sm.name)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {/* Standalone permissions (simple modules — no section) */}
                          {mod.standalonePermissions.map((p) => (
                            <PermissionRow key={p.id} name={p.name} description={p.description} checked={selectedPermissionNames.has(p.name)} onClick={() => togglePermission(p.name, null)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            {errors.permissions && <p className="text-[11px] text-destructive">{errors.permissions}</p>}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-[2px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {tCommon('actions.tk_cancel_')}
          </button>
          <WaveButton type="button" disabled={isLoading} onClick={handleSubmit}>
            {isLoading ? tCommon('actions.tk_loading_') : isEdit ? tAccount('roles.edit.tk_submit_') : tAccount('roles.create.tk_submit_')}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────── SCOPE TILE ─────────────── */

/**
 * Tile-as-radio used by the scope picker. `disabled` switches the tile to a clearly muted
 * appearance (not just `cursor-not-allowed`) so the user immediately spots which options
 * aren't reachable in the current edit context.
 */
function ScopeTile({ selected, disabled, onClick, icon, label, sub }: { selected: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors',
        selected ? 'border-primary bg-primary/8' : 'border-border bg-secondary',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:border-primary/40'
      )}
    >
      {icon}
      <div className="min-w-0">
        <div className="text-[12px] font-bold text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  )
}

/* ─────────────── PERMISSION ROW ─────────────── */

/** A single action (permission) checkbox row. Shared by section-scoped and standalone permissions. */
function PermissionRow({ name, description, checked, onClick }: { name: string; description: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('cursor-pointer w-full flex items-start gap-2 rounded-[2px] px-2 py-1.5 text-left transition-colors', checked ? 'bg-primary/10' : 'hover:bg-background/50')}
    >
      <span className={cn('mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[2px] border', checked ? 'border-primary bg-primary' : 'border-border')}>
        {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-mono font-bold text-foreground">{name}</div>
        <div className="text-[10px] text-muted-foreground line-clamp-2">{description}</div>
      </div>
    </button>
  )
}
