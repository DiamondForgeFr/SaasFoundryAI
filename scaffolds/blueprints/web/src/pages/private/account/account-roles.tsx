/**
 * Resources
 */
import { createElement, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useAccountRoles } from '@/hooks/api/accounts/queries/useAccountRoles'
import { useSystemRoles } from '@/hooks/api/accounts/queries/useSystemRoles'
import { useDeleteCustomRole, useToggleRoleStatus } from '@/hooks/api/accounts/mutations/useCustomRole'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { CreateRoleDialog, type RoleEditorTarget } from '@/components/dialogs/create-role-dialog'
import { KpiFilterCard } from '@/components/ui/custom/kpi-filter-card'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { FileText, Globe, Lock, Pencil, Plus, Search, Settings2, Shield, ShieldCheck, Trash2, User as UserIcon } from 'lucide-react'
import { cn } from '@/utils/ui'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Input } from '@/components/ui/shadcn/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet'
import { Switch } from '@/components/ui/shadcn/switch'

import type { RoleScope } from '@/hooks/api/auth'

type ScopeFilterValue = RoleScope | 'ALL'
type SystemFilterValue = 'ALL' | 'SYSTEM' | 'CUSTOM'

const scopeBadgeStyles: Record<RoleScope, string> = {
  PLATFORM: 'bg-primary/15 text-primary border-primary/25',
  ACCOUNT: 'bg-primary/10 text-primary border-primary/20',
  ENTITY: 'bg-amber-500/15 text-amber-500 border-amber-500/25'
}

const scopeRingStyles: Record<RoleScope, string> = {
  PLATFORM: 'border-primary/30 bg-primary/10',
  ACCOUNT: 'border-primary/30 bg-primary/10',
  ENTITY: 'border-amber-500/25 bg-amber-500/10'
}

const scopeIconColor: Record<RoleScope, string> = {
  PLATFORM: 'text-primary',
  ACCOUNT: 'text-primary',
  ENTITY: 'text-amber-500'
}

const scopeIcon: Record<RoleScope, React.ComponentType<{ className?: string }>> = {
  PLATFORM: Globe,
  ACCOUNT: Shield,
  ENTITY: ShieldCheck
}

type RoleListItem = {
  id: number
  name: string
  description: string | null
  scope: RoleScope
  isSystem: boolean
  isActive: boolean
  isGlobal?: boolean
  modules: string[]
  subModules: string[]
  permissions: string[]
}

const KNOWN_SYSTEM_KEYS = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']

function displayNameOf(role: RoleListItem, t: (k: string) => string): string {
  const key = role.name.toLowerCase()
  if (role.isSystem && KNOWN_SYSTEM_KEYS.includes(key)) return t(`roles.builtin.tk_${key.replace('-', '_')}_`)
  return role.name
}

function displayDescriptionOf(role: RoleListItem, t: (k: string) => string): string {
  const key = role.name.toLowerCase()
  if (role.isSystem && KNOWN_SYSTEM_KEYS.includes(key)) return t(`roles.builtin.tk_${key.replace('-', '_')}-description_`)
  return role.description ?? ''
}

function pickRoleVisualIcon(role: RoleListItem) {
  const key = role.name.toLowerCase()
  if (key === 'guest') return UserIcon
  if (key.includes('admin')) return scopeIcon[role.scope]
  return UserIcon
}

/* ─────────────── KPI FILTER ROW ─────────────── */

/**
 * KPIs double as filter chips for the SYSTEM/CUSTOM origin axis. Clicking a card narrows
 * the grid below; the active card adopts the mustard accent affordance shared with the
 * other filter cards on the platform (Switch account, account-accounts KPIs, etc.).
 *
 * The orthogonal SCOPE filter (All / Account / Entity / Platform) stays as a SegmentedFilter
 * because it operates on a different dimension and combining the two into a single card row
 * would make the active state ambiguous (the user selects one card, but two axes are filtered).
 */
function KpiFilterRow({ items, value, onChange }: { items: RoleListItem[]; value: SystemFilterValue; onChange: (next: SystemFilterValue) => void }) {
  const { t: tAccount } = useTranslation('account')
  const total = items.length
  const systemCount = items.filter((r) => r.isSystem).length
  const customCount = total - systemCount
  const totalPermissions = items.reduce((acc, r) => acc + r.permissions.length, 0)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      <KpiFilterCard
        active={value === 'ALL'}
        onClick={() => onChange('ALL')}
        icon={Settings2}
        label={tAccount('roles.kpi.tk_total_')}
        value={total}
        sub={tAccount('roles.kpi.tk_total-sub_', { permissions: totalPermissions })}
      />
      <KpiFilterCard
        active={value === 'SYSTEM'}
        onClick={() => onChange('SYSTEM')}
        icon={Lock}
        label={tAccount('roles.kpi.tk_system_')}
        value={systemCount}
        sub={tAccount('roles.kpi.tk_system-sub_')}
        tone="muted"
      />
      <KpiFilterCard
        active={value === 'CUSTOM'}
        onClick={() => onChange('CUSTOM')}
        icon={Settings2}
        label={tAccount('roles.kpi.tk_custom_')}
        value={customCount}
        sub={customCount === 0 ? tAccount('roles.kpi.tk_custom-sub-empty_') : tAccount('roles.kpi.tk_custom-sub_')}
        tone="emerald"
      />
    </div>
  )
}

/* ─────────────── ROLE CARD ─────────────── */

function RoleCard({ role, onOpen, canToggle, isToggling, onToggle }: { role: RoleListItem; onOpen: () => void; canToggle: boolean; isToggling: boolean; onToggle: (next: boolean) => void }) {
  const { t: tAccount } = useTranslation('account')
  const displayName = displayNameOf(role, tAccount)
  const displayDescription = displayDescriptionOf(role, tAccount)
  // Whole card is dimmed when the role is currently disabled — visual cue that it won't be
  // assignable until reactivated. The Switch on the right makes the toggle obvious.
  const dimmed = !role.isActive

  return (
    <div
      role="button"
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-sm border bg-card p-4 transition-all',
        'hover:border-primary/40 hover:shadow-[0_0_0_1px_var(--primary)/15]',
        dimmed ? 'border-border/60 bg-muted/30' : 'border-border'
      )}
    >
      {/* Top row: icon + name + scope badge + system tag + status switch */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border', scopeRingStyles[role.scope], dimmed && 'opacity-60')}>
          {createElement(pickRoleVisualIcon(role), { className: cn('h-4 w-4', scopeIconColor[role.scope]) })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className={cn('font-bold text-sm capitalize truncate flex-1 min-w-0', dimmed ? 'text-muted-foreground' : 'text-foreground')}>{displayName}</span>
            <span className={cn('flex-shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', scopeBadgeStyles[role.scope], dimmed && 'opacity-70')}>
              {role.scope}
            </span>
            {role.isSystem && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Lock className="h-2.5 w-2.5" />
                {tAccount('roles.tk_system_')}
              </span>
            )}
            {/* Status pill — Switch + label, same affordance as account-card.
                When the actor cannot toggle this role, falls back to a display-only badge. */}
            {canToggle ? (
              <label
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none transition-colors',
                  role.isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                  isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                )}
                title={tAccount(role.isActive ? 'roles.tk_status-deactivate-tooltip_' : 'roles.tk_status-reactivate-tooltip_')}
              >
                <Switch
                  checked={role.isActive}
                  disabled={isToggling}
                  onCheckedChange={onToggle}
                  className={cn(
                    '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                    role.isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                  )}
                />
                <span>{tAccount(role.isActive ? 'roles.tk_status-active_' : 'roles.tk_status-inactive_')}</span>
              </label>
            ) : (
              <span
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                  role.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', role.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                {tAccount(role.isActive ? 'roles.tk_status-active_' : 'roles.tk_status-inactive_')}
              </span>
            )}
          </div>
          {displayDescription && <div className={cn('text-xs mt-1 line-clamp-2 leading-snug', dimmed ? 'text-muted-foreground/70' : 'text-foreground/80')}>{displayDescription}</div>}
        </div>
      </div>

      {/* Footer: counts + view CTA */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border/60">
        <div className="inline-flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <Settings2 className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{role.modules.length}</span>
            <span className="text-muted-foreground">{tAccount('roles.tk_modules-short_')}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{role.permissions.length}</span>
            <span className="text-muted-foreground">{tAccount('roles.tk_permissions-short_')}</span>
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-primary transition-colors">{tAccount('roles.tk_view_')} →</span>
      </div>
    </div>
  )
}

/* ─────────────── DETAIL SHEET ─────────────── */

function RoleDetailSheet({
  role,
  onOpenChange,
  onEdit,
  onDelete,
  canManage
}: {
  role: RoleListItem | null
  onOpenChange: (open: boolean) => void
  onEdit: (role: RoleListItem) => void
  onDelete: (role: RoleListItem) => void
  canManage: boolean
}) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  if (!role) return null
  const displayName = displayNameOf(role, tAccount)
  const displayDescription = displayDescriptionOf(role, tAccount)

  return (
    <Sheet open={role !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-[480px] flex flex-col p-0 overflow-hidden">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border', scopeRingStyles[role.scope])}>
              {createElement(pickRoleVisualIcon(role), { className: cn('h-4 w-4', scopeIconColor[role.scope]) })}
            </div>
            <div className="min-w-0">
              <SheetTitle className="capitalize text-sm">{displayName}</SheetTitle>
              {displayDescription && <SheetDescription className="text-xs text-foreground/80 mt-1 leading-snug">{displayDescription}</SheetDescription>}
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className={cn('rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', scopeBadgeStyles[role.scope])}>{role.scope}</span>
                {role.isSystem ? (
                  <span className="inline-flex items-center gap-1 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    {tAccount('roles.tk_system_')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                    {tAccount('roles.tk_custom_')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Modules */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('roles.tk_modules_')}</span>
              <span className="text-[10px] text-muted-foreground">{role.modules.length}</span>
            </div>
            {role.modules.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">{tAccount('roles.tk_modules-empty_')}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {role.modules.map((m) => (
                  <span key={m} className="inline-flex items-center rounded-[2px] border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono font-bold text-foreground break-all leading-snug">
                    {m}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Permissions */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('roles.tk_permissions_')}</span>
              <span className="text-[10px] text-muted-foreground">{role.permissions.length}</span>
            </div>
            {role.permissions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">{tAccount('roles.tk_permissions-empty_')}</p>
            ) : (
              <div className="space-y-1.5">
                {role.permissions.map((p) => (
                  <div key={p} className="rounded-[2px] border border-primary/20 bg-primary/8 px-2 py-1 font-mono text-[10.5px] text-primary break-all leading-snug">
                    {p}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer actions */}
        {canManage && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3 bg-card/50">
            {!role.isSystem && (
              <button
                type="button"
                onClick={() => onDelete(role)}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-[2px] border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tCommon('actions.tk_delete_')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit(role)}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-[2px] border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary hover:bg-primary/25 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              {tAccount(role.isSystem ? 'roles.edit.tk_action-system_' : 'roles.edit.tk_action-custom_')}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ─────────────── MAIN ─────────────── */

/**
 * Account Management — ROLES tab.
 *
 * Card-grid layout, identical interaction model as the Platform → Modules page:
 *   - Click a card → opens a right-side detail Sheet
 *   - Edit / Delete actions live inside the Sheet (delete only for non-system roles)
 *
 * Two read paths:
 *   - PLATFORM_ALL (no account scoped) → fetches the platform-wide system roles only.
 *   - With an account selected → fetches that account's roles (system templates + customs).
 */
export function AccountRoles() {
  const { t: tAccount } = useTranslation('account')
  const { activeAccount, currentScope, isPlatformAdmin, isAccountAdmin, isEntityAdmin, managedEntities, authMe } = useAdminScope()
  const { hasPermission } = useModuleAccess()

  const isPlatformAll = currentScope.kind === 'PLATFORM' && !currentScope.id
  // Entity-admins reach the account through their entity link — they have no UserAccountLink, so
  // `activeAccount` is null. Fall back to the account behind their first managed/linked entity so
  // the roles query actually runs.
  const entityAccountId = managedEntities[0]?.accountId ?? authMe?.entities.find((e) => e.isActive)?.accountId ?? null
  const accountId = currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : (activeAccount?.id ?? entityAccountId ?? null)
  // Entity-admins (without account-admin / platform-admin upgrade) operate at ENTITY scope —
  // ACCOUNT/PLATFORM-scoped roles aren't theirs to manage or even browse.
  const isEntityScopedView = isEntityAdmin && !isAccountAdmin && !isPlatformAdmin

  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>('ALL')
  const [systemFilter, setSystemFilter] = useState<SystemFilterValue>('ALL')
  const [search, setSearch] = useState('')
  const [editorTarget, setEditorTarget] = useState<RoleEditorTarget | null>(null)
  // Store the open role's id, NOT the full object — refetches return new object refs
  // and would otherwise trigger a setState/useEffect infinite loop.
  const [openRoleId, setOpenRoleId] = useState<number | null>(null)

  const canManageCustomRoles = hasPermission('ROLE_CUSTOM_MANAGEMENT')
  const deleteRoleMutation = useDeleteCustomRole()
  const toggleRoleMutation = useToggleRoleStatus()
  // Tracks WHICH role is currently being toggled so only its switch shows the wait state.
  const [togglingRoleId, setTogglingRoleId] = useState<number | null>(null)

  /**
   * Mirrors the backend matrix in account.service.ts:toggleRoleStatus — UI gates the affordance
   * before the user even clicks, so they never see a switch that would server-side reject.
   *
   *   - `platform-admin` system role : never (self-lockout)
   *   - PLATFORM_ADMIN actor         : every other role
   *   - account-admin (with ROLE_CUSTOM_MANAGEMENT) : only their account's own custom roles
   */
  const canToggleRole = (role: RoleListItem): boolean => {
    if (role.name === 'platform-admin') return false
    if (isPlatformAdmin) return true
    if (!canManageCustomRoles) return false
    return !role.isSystem && !role.isGlobal && Boolean(accountId) && role.scope !== 'PLATFORM'
  }

  const handleToggle = async (role: RoleListItem, next: boolean) => {
    setTogglingRoleId(role.id)
    try {
      // accountId for cache invalidation: own custom role uses the active account; for global
      // templates / system roles toggled by a platform-admin we pass null and the hook
      // invalidates every account-scoped roles cache.
      await toggleRoleMutation.mutateAsync({ roleId: role.id, isActive: next, accountId: role.isSystem || role.isGlobal ? null : (accountId ?? null) })
    } catch (e) {
      console.error('Failed to toggle role status', e)
    } finally {
      setTogglingRoleId(null)
    }
  }

  const accountQuery = useAccountRoles(accountId ?? '', { search: search || undefined, limit: 50 })
  const systemQuery = useSystemRoles({ search: search || undefined, limit: 50, enabled: isPlatformAll })

  const isLoading = isPlatformAll ? systemQuery.isLoading : accountQuery.isLoading
  const items: RoleListItem[] = useMemo(() => {
    const data = isPlatformAll ? systemQuery.data : accountQuery.data
    const raw = (data?.items ?? []) as RoleListItem[]
    // Entity-admin: ENTITY-scoped roles only — ACCOUNT/PLATFORM are out of their reach.
    if (isEntityScopedView) return raw.filter((r) => r.scope === 'ENTITY')
    // PLATFORM-scoped roles are reserved for platform-admins — hide them from everyone else.
    return isPlatformAdmin ? raw : raw.filter((r) => r.scope !== 'PLATFORM')
  }, [isPlatformAll, systemQuery.data, accountQuery.data, isPlatformAdmin, isEntityScopedView])

  // Order: ALL → PLATFORM → ACCOUNT → ENTITY (broadest scope to narrowest).
  // PLATFORM chip is dropped entirely for non-platform-admins since they can't act on platform roles.
  // Entity-admins see only the ENTITY scope (ALL == ENTITY for them) — drop the scope filter
  // entirely since the toggle wouldn't change anything.
  const scopeFilterOptions: readonly SegmentedOption<ScopeFilterValue>[] = useMemo(() => {
    if (isEntityScopedView) return []
    const opts: SegmentedOption<ScopeFilterValue>[] = [{ value: 'ALL', label: tAccount('roles.filters.tk_all_') }]
    if (isPlatformAdmin) opts.push({ value: 'PLATFORM', label: tAccount('roles.filters.tk_platform_') })
    opts.push({ value: 'ACCOUNT', label: tAccount('roles.filters.tk_account_') })
    opts.push({ value: 'ENTITY', label: tAccount('roles.filters.tk_entity_') })
    return opts
  }, [tAccount, isPlatformAdmin, isEntityScopedView])

  const filtered = useMemo(() => {
    return items.filter((role) => {
      if (scopeFilter !== 'ALL' && role.scope !== scopeFilter) return false
      if (systemFilter === 'SYSTEM' && !role.isSystem) return false
      if (systemFilter === 'CUSTOM' && role.isSystem) return false
      return true
    })
  }, [items, scopeFilter, systemFilter])

  // Derive the open role from the live list — auto-syncs after edit/delete and closes the Sheet
  // gracefully when the role disappears, with no manual setState dance.
  const openRole = useMemo(() => items.find((r) => r.id === openRoleId) ?? null, [items, openRoleId])

  const handleEdit = (role: RoleListItem) => {
    setEditorTarget({
      mode: 'edit',
      accountId: role.isSystem ? null : (accountId ?? null),
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: role.isSystem,
        subModules: role.subModules,
        permissions: role.permissions
      }
    })
    setOpenRoleId(null)
  }

  const handleDelete = (role: RoleListItem) => {
    if (!accountId || role.isSystem) return
    if (!confirm(tAccount('roles.tk_delete-confirm_'))) return
    deleteRoleMutation.mutate({ roleId: role.id, accountId })
    setOpenRoleId(null)
  }

  return (
    <div className="space-y-4">
      {/* KPI cards double as the SYSTEM/CUSTOM origin filter (hidden during initial load to avoid 0/0/0 flash) */}
      {!isLoading && items.length > 0 && <KpiFilterRow items={items} value={systemFilter} onChange={setSystemFilter} />}

      {/* Filters bar — same shape as the Accounts tab: search → scope segmented → CTA WaveButton.
          The PLATFORM_ALL view enables creating PLATFORM-scoped roles; per-account view creates
          ACCOUNT/ENTITY-scoped roles. Both gated by ROLE_CUSTOM_MANAGEMENT. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAccount('roles.tk_search-placeholder_')} className="pl-9" />
        </div>
        {scopeFilterOptions.length > 0 && <SegmentedFilter dataTestid="roles-scope-filter" value={scopeFilter} onChange={setScopeFilter} options={scopeFilterOptions} />}
        {canManageCustomRoles && (accountId || isPlatformAll) && (
          <WaveButton
            type="button"
            onClick={() => setEditorTarget({ mode: 'create', accountId: accountId ?? null, allowPlatformScope: isPlatformAll, lockToEntityScope: isEntityScopedView })}
            className="!h-9 !w-auto !text-[11px] px-3.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {tAccount('roles.tk_create_')}
          </WaveButton>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-sm" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-card p-10 flex flex-col items-center justify-center gap-2 text-center">
          <Settings2 className="h-5 w-5 text-muted-foreground/60" />
          <span className="text-sm text-muted-foreground">{tAccount('roles.tk_empty_')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onOpen={() => setOpenRoleId(role.id)}
              canToggle={canToggleRole(role)}
              isToggling={togglingRoleId === role.id}
              onToggle={(next) => handleToggle(role, next)}
            />
          ))}
        </div>
      )}

      <RoleDetailSheet role={openRole} onOpenChange={(open) => !open && setOpenRoleId(null)} onEdit={handleEdit} onDelete={handleDelete} canManage={canManageCustomRoles} />

      {editorTarget && <CreateRoleDialog isOpen={editorTarget !== null} onOpenChange={(open) => !open && setEditorTarget(null)} target={editorTarget} />}
    </div>
  )
}
