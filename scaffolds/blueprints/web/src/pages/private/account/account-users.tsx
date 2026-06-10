/**
 * Resources
 */
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, Clock, Link as LinkIcon, Mail, Search, ShieldCheck, UserPlus, Users as UsersIcon, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useAccount } from '@/hooks/api/accounts'
import { useInviteUser } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import { useAccountEntities } from '@/hooks/api/accounts/queries/useAccountEntities'
import { useAccountRoles } from '@/hooks/api/accounts/queries/useAccountRoles'
import { UserOrderBy, useAccountUsers } from '@/hooks/api/accounts/queries/useAccountUsers'
import { useCancelInvitation } from '@/hooks/api/invitations/mutations/useCancelInvitation'
import { useInvitedUsers } from '@/hooks/api/invitations/queries/useInvitedUsers'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useDebounce } from '@/hooks/ui/useDebounce'
import { formatDateShort, getInitials } from '@/utils/format'

/**
 * Components
 */
import { EditUserDialog, type EditUserTarget } from '@/components/dialogs/edit-user-dialog'
import { InviteUserDialog } from '@/components/dialogs/invite-user-dialog'
import { KpiFilterCard } from '@/components/ui/custom/kpi-filter-card'
import { MultiSelectFilter, MultiSelectFilterItem } from '@/components/ui/custom/multiselect-filter'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Input } from '@/components/ui/shadcn/input'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Switch } from '@/components/ui/shadcn/switch'

import { useUpdateAccountUser } from '@/hooks/api/accounts/mutations/useUpdateAccountUser'

/**
 * Types
 */
import type { AccountUsersResponseDto } from '@/hooks/api/accounts/queries/useAccountUsers'
import type { MeResponseDto } from '@/hooks/api/auth'

type UserRow = AccountUsersResponseDto['items'][number]
type StatusFilter = 'all' | 'active' | 'inactive'

/**
 * Top-level view selector. Each value is wired to a KPI card the user can click — the active
 * card adopts the mustard accent affordance shared with every other clickable filter card on
 * the platform.
 *
 *   - `all`            : every user the account can see (direct + entity-linked)
 *   - `account-linked` : narrow to users with a direct UserAccountLink
 *   - `pending`        : hide the regular table and surface the pending invitations instead
 */
type UsersView = 'all' | 'account-linked' | 'pending'

function getFullName(user: UserRow, fallback: string): string {
  if (user.people) {
    const firstname = user.people.firstname ?? ''
    const lastname = user.people.lastname ?? ''
    const fullName = `${firstname} ${lastname}`.trim()
    return fullName || fallback
  }
  return fallback
}

/* ─────────────── KPI FILTER ROW ─────────────── */

function KpiFilterRow({ total, accountLinked, pending, view, onChange }: { total: number; accountLinked: number; pending: number; view: UsersView; onChange: (next: UsersView) => void }) {
  const { t: tAccount } = useTranslation('account')
  const entityLinked = total - accountLinked
  const accountLinkedSub = total === 0 ? tAccount('users.kpi.tk_account-linked-sub-empty_') : tAccount('users.kpi.tk_account-linked-sub_', { percent: Math.round((accountLinked / total) * 100) })
  const pendingSub = pending === 0 ? tAccount('users.kpi.tk_pending-none_') : pending === 1 ? tAccount('users.kpi.tk_pending-one_') : tAccount('users.kpi.tk_pending-many_')
  return (
    <div className="mb-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
      <KpiFilterCard
        active={view === 'all'}
        onClick={() => onChange('all')}
        icon={UsersIcon}
        label={tAccount('users.kpi.tk_total_')}
        value={total}
        sub={tAccount('users.kpi.tk_total-sub_', { accountLinked, entityLinked })}
      />
      <KpiFilterCard
        active={view === 'account-linked'}
        onClick={() => onChange('account-linked')}
        icon={LinkIcon}
        label={tAccount('users.kpi.tk_account-linked_')}
        value={accountLinked}
        sub={accountLinkedSub}
      />
      <KpiFilterCard
        active={view === 'pending'}
        onClick={() => onChange('pending')}
        icon={Clock}
        label={tAccount('users.kpi.tk_pending_')}
        value={pending}
        sub={pendingSub}
        tone="amber"
        alert={pending > 0}
      />
    </div>
  )
}

/* ─────────────── FILTER BAR ─────────────── */

function FilterBar({
  search,
  onSearch,
  status,
  onStatus,
  selectedEntities,
  onEntitiesChange,
  selectedRoles,
  onRolesChange,
  accountId,
  onInvite,
  canInvite
}: {
  search: string
  onSearch: (v: string) => void
  status: StatusFilter
  onStatus: (v: StatusFilter) => void
  selectedEntities: string[]
  onEntitiesChange: (v: string[]) => void
  selectedRoles: number[]
  onRolesChange: (v: number[]) => void
  accountId: string
  onInvite: () => void
  canInvite: boolean
}) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const statusOptions: readonly SegmentedOption<StatusFilter>[] = [
    { value: 'all', label: tAccount('users.filters.tk_status-all_') },
    { value: 'active', label: tAccount('users.filters.tk_status-active_') },
    { value: 'inactive', label: tAccount('users.filters.tk_status-inactive_') }
  ]

  const [entitySearch, setEntitySearch] = useState('')
  const debouncedEntitySearch = useDebounce(entitySearch, 300)
  const { data: entitiesData, isLoading: entitiesLoading } = useAccountEntities(accountId, { search: debouncedEntitySearch, limit: 10 })
  const entityItems: MultiSelectFilterItem[] = entitiesData?.items.map((e) => ({ id: e.id, label: e.name })) ?? []

  const [roleSearch, setRoleSearch] = useState('')
  const debouncedRoleSearch = useDebounce(roleSearch, 300)
  const { data: rolesData, isLoading: rolesLoading } = useAccountRoles(accountId, { search: debouncedRoleSearch, limit: 10 })
  const roleItems: MultiSelectFilterItem[] = rolesData?.items.filter((r) => r.name?.toLowerCase() !== 'guest').map((r) => ({ id: r.id, label: r.name })) ?? []

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input type="text" data-testid="search-filter" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={tAccount('users.filters.tk_search-placeholder_')} className="pl-9" />
        </div>
        <SegmentedFilter value={status} onChange={onStatus} options={statusOptions} />
        {canInvite && (
          <WaveButton type="button" onClick={onInvite} className="!h-9 !w-auto !text-[11px] px-3.5">
            <UserPlus className="h-3.5 w-3.5" />
            {tAccount('users.tk_invite-user-cta_')}
          </WaveButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MultiSelectFilter
          dataTestid="roles-filter"
          selected={selectedRoles}
          onChange={(s) => onRolesChange(s.map(Number))}
          items={roleItems}
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          placeholder={tCommon('filters.tk_select-roles_')}
          selectedLabel={tCommon('filters.tk_selected-roles_')}
          loading={rolesLoading}
          emptyText={tAccount('roles.tk_table-no-roles_')}
          search={roleSearch}
          onSearchChange={setRoleSearch}
        />
        <MultiSelectFilter
          dataTestid="entities-filter"
          selected={selectedEntities}
          onChange={(s) => onEntitiesChange(s.map(String))}
          items={entityItems}
          icon={<Building2 className="h-3.5 w-3.5" />}
          placeholder={tCommon('filters.tk_select-entities_')}
          selectedLabel={tCommon('filters.tk_select-entities_')}
          loading={entitiesLoading}
          emptyText={tAccount('entities.tk_table-no-entities_')}
          search={entitySearch}
          onSearchChange={setEntitySearch}
        />
      </div>
    </div>
  )
}

/* ─────────────── PENDING INVITATIONS PANEL ─────────────── */

/**
 * Pending invitations panel.
 *
 * `forceOpen` lets the parent take it out of its collapsible behaviour and use it as the
 * primary content of the page (when the user clicked the "Pending" KPI filter card).
 * When `forceOpen=false` (default), it stays a self-contained collapsible block visible above
 * the regular users table.
 */
function PendingInvitations({ forceOpen = false }: { forceOpen?: boolean }) {
  const { t: tAccount } = useTranslation('account')
  const { data: invitedUsersData } = useInvitedUsers()
  const { submitAsync: resendInvitation } = useInviteUser()
  const cancelInvitation = useCancelInvitation()
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(false)
  const open = forceOpen || !collapsed

  const pending = useMemo(() => invitedUsersData?.invitations.filter((i) => i.status === 'SENT' || i.status === 'EXPIRED') ?? [], [invitedUsersData])

  if (pending.length === 0) {
    if (!forceOpen) return null
    // Pending-as-main-view but no items: show an empty-state instead of nothing.
    return (
      <div className="rounded-sm border border-border bg-card flex items-center justify-center gap-2 px-4 py-12 text-xs text-muted-foreground">
        <Mail className="h-4 w-4 opacity-40" />
        {tAccount('users.pending.tk_no-invitations_')}
      </div>
    )
  }

  const handleResend = async (invitation: (typeof pending)[number]) => {
    try {
      await resendInvitation({
        email: invitation.inviteeUserEmail,
        roleIds: invitation.roles.map((r) => r.id),
        accountIds: invitation.accounts.map((a) => a.id),
        entityIds: invitation.entities.map((e) => e.id)
      })
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
    } catch (error) {
      console.error('Failed to resend invitation:', error)
    }
  }

  const handleCancel = async (invitation: (typeof pending)[number]) => {
    if (!confirm(tAccount('users.pending.tk_cancel-confirm_'))) return
    try {
      await cancelInvitation.mutateAsync(invitation.id)
    } catch (error) {
      console.error('Failed to cancel invitation:', error)
    }
  }

  return (
    <div className="rounded-sm border border-border bg-card overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => !forceOpen && setCollapsed((v) => !v)}
        disabled={forceOpen}
        className={cn('w-full flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border transition-colors', forceOpen ? 'cursor-default' : 'cursor-pointer hover:bg-muted/40')}
      >
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-primary" />
          <span className="font-display text-[13px] font-bold text-foreground">{tAccount('users.pending.tk_title_')}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            {pending.length}
          </span>
        </div>
        {!forceOpen && <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && (
        <div className="flex flex-col">
          {pending.map((inv) => {
            const isExpired = inv.status === 'EXPIRED'
            return (
              <div key={inv.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground leading-tight truncate">{inv.inviteeUserEmail}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    {tAccount('users.pending.tk_sent-prefix_')} {formatDateShort(inv.invitedAt)}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${
                    isExpired ? 'border-red-500/40 bg-red-500/10 text-red-500 dark:text-red-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {isExpired ? tAccount('users.pending.tk_status-expired_') : tAccount('users.pending.tk_status-pending_')}
                </span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{inv.roles[0]?.name ?? '—'}</span>
                <button
                  type="button"
                  onClick={() => handleResend(inv)}
                  className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-foreground transition-colors"
                >
                  {tAccount('users.pending.tk_resend_')} <ChevronRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel(inv)}
                  disabled={cancelInvitation.isLoading}
                  className="cursor-pointer inline-flex items-center justify-center rounded-[2px] border border-border bg-card p-1 text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
                  title={tAccount('users.pending.tk_cancel_')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────── USER CARD ─────────────── */

const BUILTIN_ROLE_KEYS = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']

function UserCard({
  user,
  onEdit,
  canEdit,
  canToggle,
  isToggling,
  onToggle
}: {
  user: UserRow
  onEdit: (u: UserRow) => void
  canEdit: boolean
  canToggle: boolean
  isToggling: boolean
  onToggle: (next: boolean) => void
}) {
  const { t: tAccount } = useTranslation('account')
  const fullName = getFullName(user, tAccount('users.table.tk_name-fallback_'))
  const initials = getInitials(user.people?.firstname ?? user.email[0], user.people?.lastname ?? '')
  const accessClass = user.isDirectlyLinked ? 'bg-primary/22 text-primary' : 'bg-muted text-muted-foreground'
  const handleClick = () => canEdit && onEdit(user)

  // Role chips — primary roles to display next to the status switch.
  // `user.roles` carries one entry per UserRoleAssignment, so a user that holds the same role
  // (e.g. entity-admin) on several entities yields duplicates. Dedupe by role id before slicing
  // so React keys stay unique and the user doesn't see the same chip twice.
  const distinctRoles = useMemo(() => {
    const seen = new Set<number>()
    return user.roles.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [user.roles])
  const roleLabels = distinctRoles.slice(0, 2).map((r) => {
    const key = r.name?.toLowerCase()
    const isBuiltIn = BUILTIN_ROLE_KEYS.includes(key)
    return { id: r.id, label: isBuiltIn ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : r.name }
  })
  const extraRoles = distinctRoles.length - roleLabels.length

  // Scope label: directly account-linked vs. reachable through one or more entities.
  const scopeKind: 'ACCOUNT' | 'ENTITY' = user.isDirectlyLinked ? 'ACCOUNT' : 'ENTITY'
  const entityNames = (user.entities ?? []).slice(0, 3)
  const extraEntities = (user.entities?.length ?? 0) - entityNames.length

  return (
    <div
      data-testid="user-row"
      role={canEdit ? 'button' : undefined}
      onClick={handleClick}
      className={cn('group rounded-sm border bg-card p-4 transition-all border-border', canEdit && 'cursor-pointer hover:border-primary/40')}
      title={canEdit ? tAccount('users.edit.tk_action_') : undefined}
    >
      {/* Header — avatar + name (+email below) | role chips → status switch on the right. */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[12px] font-bold', accessClass)}>{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-foreground truncate flex-1 min-w-0">{fullName}</span>
            {roleLabels.map((r) => (
              <span
                key={r.id}
                className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80 whitespace-nowrap max-w-[120px] truncate"
                title={r.label}
              >
                {r.label}
              </span>
            ))}
            {extraRoles > 0 && (
              <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80">
                +{extraRoles}
              </span>
            )}
            {canToggle ? (
              <label
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none transition-colors',
                  user.isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                  isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                )}
              >
                <Switch
                  checked={user.isActive}
                  disabled={isToggling}
                  onCheckedChange={onToggle}
                  className={cn(
                    '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                    user.isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                  )}
                />
                <span>{tAccount(user.isActive ? 'users.table.tk_status-active_' : 'users.table.tk_status-inactive_')}</span>
              </label>
            ) : (
              <span
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                  user.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', user.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                {tAccount(user.isActive ? 'users.table.tk_status-active_' : 'users.table.tk_status-inactive_')}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight truncate mt-0.5">{user.email}</div>
        </div>
      </div>

      {/* Body — a data-derived pending badge first (when the user hasn't fully onboarded), then the
          scope chip + entity names for context. pendingKind: 'invited' = awaiting signup, we sent an
          invitation; 'awaiting-confirmation' = self-signup awaiting email confirmation. */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {user.pendingKind && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-500 whitespace-nowrap"
            title={tAccount(user.pendingKind === 'invited' ? 'users.table.tk_awaiting-signup-tooltip_' : 'users.table.tk_awaiting-confirmation-tooltip_')}
          >
            <Mail className="h-2.5 w-2.5" />
            {tAccount(user.pendingKind === 'invited' ? 'users.table.tk_awaiting-signup_' : 'users.table.tk_awaiting-confirmation_')}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap',
            scopeKind === 'ACCOUNT' ? 'border-primary/22 bg-primary/12 text-primary' : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
          )}
        >
          {tAccount(scopeKind === 'ACCOUNT' ? 'users.table.tk_scope-account_' : 'users.table.tk_scope-entity_')}
        </span>
        {entityNames.map((e) => (
          <span
            key={e.id}
            className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80 whitespace-nowrap max-w-[160px] truncate"
            title={e.name}
          >
            {e.name}
          </span>
        ))}
        {extraEntities > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80">
            +{extraEntities}
          </span>
        )}
      </div>

      {/* Footer — created date + last login on the left, EDIT cta on the right. */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border/60 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <UserPlus className="h-3 w-3" />
            <span className="tabular-nums">{formatDateShort(user.createdAt, { withYear: false })}</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">{user.lastLoginAt ? formatDateShort(user.lastLoginAt, { withYear: false }) : tAccount('users.table.tk_never-logged-in_')}</span>
          </span>
        </div>
        {canEdit && <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-primary transition-colors">{tAccount('users.tk_edit-cta_')} →</span>}
      </div>
    </div>
  )
}

/* ─────────────── PAGINATION ─────────────── */

function MiniPagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-end gap-1.5 px-4 py-2.5 border-t border-border">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
        className="cursor-pointer inline-flex items-center justify-center h-7 w-7 rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-[11px] text-muted-foreground tabular-nums px-2">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onPage(page + 1)}
        className="cursor-pointer inline-flex items-center justify-center h-7 w-7 rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ─────────────── MAIN ─────────────── */

export function AccountUsers() {
  const queryClient = useQueryClient()
  const { hasPermission } = useModuleAccess()
  const { currentScope, isPlatformAdmin, isAccountAdmin, isEntityAdmin, managedEntities, activeEntity } = useAdminScope()
  const { t: tAccount } = useTranslation('account')
  // Entity-admins see only users linked to the entity currently selected in the scope switcher
  // (falls back to all managed entities while activeEntity is still resolving). The API natively
  // supports the narrowing via `entityIds` + `includeDirectUsers=false`.
  const isEntityScopedView = isEntityAdmin && !isAccountAdmin && !isPlatformAdmin
  const managedEntityIds = useMemo(() => (activeEntity ? [activeEntity.id] : managedEntities.map((e) => e.id)), [activeEntity, managedEntities])

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [selectedEntities, setSelectedEntities] = useState<string[]>([])
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false)
  const [editUserTarget, setEditUserTarget] = useState<EditUserTarget | null>(null)
  const [view, setView] = useState<UsersView>('all')

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])
  // Platform-admins scope into accounts they have no direct UserAccountLink for, so we
  // prefer the explicit currentScope.id over the user's own account list.
  const accountIdFromScope = currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : null
  const activeAccount = authMe?.accounts.find((acc) => acc.isActive)
  const accountId = accountIdFromScope ?? activeAccount?.id ?? authMe?.entities.find((e) => e.isActive)?.accountId

  const isActive = status === 'all' ? undefined : status === 'active'
  // The "Account-linked" KPI filter narrows the API to direct users only by flipping
  // `includeDirectUsers=false` would return entity-only — which is the opposite of what we
  // want. The API doesn't have a "direct-only" mode, so we always include direct users and
  // apply a client-side filter below to keep direct rows only.
  // Entity-admin: exclude direct (account-linked) users entirely — they aren't part of the
  // entity-admin's reach.
  const includeDirectUsers = !isEntityScopedView
  const isPendingView = view === 'pending'

  // Always constrain the API call by the entity-admin's managed entities — even when the user
  // picks an entity filter in the UI, we intersect with what they're allowed to see.
  const effectiveEntityIds = isEntityScopedView
    ? selectedEntities.length > 0
      ? selectedEntities.filter((id) => managedEntityIds.includes(id))
      : managedEntityIds
    : selectedEntities.length > 0
      ? selectedEntities
      : undefined

  const { data: account } = useAccount(accountId as string)
  const { data: usersData, isLoading } = useAccountUsers(accountId as string, {
    search: debouncedSearch,
    isActive,
    roleIds: selectedRoles.length > 0 ? selectedRoles : undefined,
    entityIds: effectiveEntityIds,
    orderBy: UserOrderBy.CREATED_AT,
    page: currentPage,
    limit: pageSize,
    includeDirectUsers
  })
  const { data: invitationsData } = useInvitedUsers()

  const rawItems = usersData?.items ?? []
  // "Account-linked" KPI filter — client-side because the API only supports include-direct
  // toggle (binary), not direct-only narrowing. Pagination total is server-provided so it
  // overstates this view; acceptable trade-off — corrected once the backend grows a flag.
  const items = view === 'account-linked' ? rawItems.filter((u) => u.isDirectlyLinked) : rawItems
  const totalItems = usersData?.meta.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const accountLinkedAll = useMemo(() => (account?.users.values ?? []).filter((u) => u.isDirectlyLinked).length, [account])
  const totalAll = account?.users.count ?? 0
  const pendingCount = useMemo(() => invitationsData?.invitations.filter((i) => i.status === 'SENT').length ?? 0, [invitationsData])

  const canInvite = hasPermission('USER_ACCOUNTS_INVITATION') || hasPermission('USER_ENTITIES_INVITATION')
  const canManageUsers = hasPermission('ACCOUNT_USER_MANAGEMENT') || hasPermission('USER_ROLE_ALLOCATION')
  const canToggleUser = hasPermission('ACCOUNT_USER_MANAGEMENT')

  const updateUserMutation = useUpdateAccountUser()
  // Track which user is currently being toggled so only that row shows the wait state.
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null)
  const handleToggleUser = async (u: UserRow, next: boolean) => {
    if (!accountId) return
    setTogglingUserId(u.id)
    try {
      await updateUserMutation.mutateAsync({ accountId, targetUserId: u.id, isActive: next })
    } catch (e: unknown) {
      // Backend refuses deactivation when it would strand an account / the platform with no admin.
      // The DTO carries a code prefix so the UI can route the user to the right recovery action.
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? ''
      if (msg.startsWith('LAST_PLATFORM_ADMIN')) {
        alert(tAccount('users.tk_last-platform-admin_'))
      } else if (msg.startsWith('LAST_ACCOUNT_ADMIN')) {
        alert(tAccount('users.tk_last-account-admin_'))
      } else {
        console.error('Failed to toggle user status', e)
      }
    } finally {
      setTogglingUserId(null)
    }
  }

  const handleEditUser = (u: UserRow) => {
    if (!accountId) return
    // The list payload only carries role *names* (no scope per assignment), so for the edit dialog we
    // pass them as the user's currently assigned ACCOUNT-scoped role names; ENTITY-scoped roles per
    // entity are unknown from this response shape — start blank and let the user re-pick. The dialog
    // explicitly supports an empty current state.
    const linkedEntities = (u.entities ?? []).map((e) => ({ id: e.id, name: e.name }))
    setEditUserTarget({
      userId: u.id,
      email: u.email,
      fullName: getFullName(u, tAccount('users.table.tk_name-fallback_')),
      isActive: u.isActive,
      isDirectlyLinked: u.isDirectlyLinked,
      accountId,
      currentAccountRoleNames: u.isDirectlyLinked ? u.roles.map((r) => r.name) : [],
      currentEntityRoleNamesByEntityId: {},
      linkedEntities
    })
  }
  const isFiltered = debouncedSearch.length > 0 || status !== 'all' || selectedEntities.length > 0 || selectedRoles.length > 0

  const handleSearch = (v: string) => {
    setSearchInput(v)
    setCurrentPage(1)
  }
  const handleStatus = (v: StatusFilter) => {
    setStatus(v)
    setCurrentPage(1)
  }
  const handleEntities = (v: string[]) => {
    setSelectedEntities(v)
    setCurrentPage(1)
  }
  const handleRoles = (v: number[]) => {
    setSelectedRoles(v)
    setCurrentPage(1)
  }

  const handleView = (next: UsersView) => {
    setView(next)
    setCurrentPage(1)
  }

  return (
    <div>
      <KpiFilterRow total={totalAll} accountLinked={accountLinkedAll} pending={pendingCount} view={view} onChange={handleView} />

      {/* Pending view: only the invitations panel as the main content. The regular users table,
          search bar and orthogonal filters don't apply here. */}
      {isPendingView ? (
        <PendingInvitations forceOpen />
      ) : (
        <>
          <FilterBar
            search={searchInput}
            onSearch={handleSearch}
            status={status}
            onStatus={handleStatus}
            selectedEntities={selectedEntities}
            onEntitiesChange={handleEntities}
            selectedRoles={selectedRoles}
            onRolesChange={handleRoles}
            accountId={accountId as string}
            onInvite={() => setIsInviteDialogOpen(true)}
            canInvite={canInvite}
          />

          {/* In the regular views the pending panel stays as a collapsible block above the
              users table — visible when there is at least one pending invitation. */}
          <PendingInvitations />

          <div data-testid="users-table">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="skeleton-shimmer-orange h-36 w-full rounded-sm" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border bg-card p-10 flex flex-col items-center justify-center gap-2 text-center">
                <UsersIcon className="h-5 w-5 text-muted-foreground/60" />
                <span className="text-sm text-muted-foreground">{isFiltered ? tAccount('users.tk_no-results-filtered_') : tAccount('users.tk_no-users-yet_')}</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    onEdit={handleEditUser}
                    canEdit={canManageUsers}
                    canToggle={canToggleUser}
                    isToggling={togglingUserId === u.id}
                    onToggle={(next) => handleToggleUser(u, next)}
                  />
                ))}
              </div>
            )}
            <div className="mt-3">
              <MiniPagination page={currentPage} totalPages={totalPages} onPage={setCurrentPage} />
            </div>
          </div>
        </>
      )}

      {canInvite && isInviteDialogOpen && <InviteUserDialog isOpen={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen} />}
      <EditUserDialog isOpen={editUserTarget !== null} onOpenChange={(open) => !open && setEditUserTarget(null)} target={editUserTarget} />
    </div>
  )
}
