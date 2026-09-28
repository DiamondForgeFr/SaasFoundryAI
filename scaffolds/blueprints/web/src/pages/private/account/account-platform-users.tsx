/**
 * Resources
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useAllAccounts } from '@/hooks/api/accounts/queries/useAllAccounts'
import { usePlatformUsers, type PlatformUserItem, type PlatformUsersAccountScope } from '@/hooks/api/accounts/queries/usePlatformUsers'
import { useSystemRoles } from '@/hooks/api/accounts/queries/useSystemRoles'
import { useDebounce } from '@/hooks/ui/useDebounce'
import { Building2, ChevronLeft, ChevronRight, Clock, Globe, Layers, Mail, Search, Shield, ShieldCheck, User as UserIcon, UserPlus, Users as UsersIcon } from 'lucide-react'

/**
 * Components
 */
import { InviteUserDialog } from '@/components/dialogs/invite-user-dialog'
import { KpiFilterCard } from '@/components/ui/custom/kpi-filter-card'
import { MultiSelectFilter, type MultiSelectFilterItem } from '@/components/ui/custom/multiselect-filter'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Input } from '@/components/ui/shadcn/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Switch } from '@/components/ui/shadcn/switch'

import { useUpdateAccountUser } from '@/hooks/api/accounts/mutations/useUpdateAccountUser'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'

import { formatDateLong, formatDateShort, getInitials } from '@/utils/format'

type StatusFilter = 'all' | 'active' | 'inactive'

/**
 * Platform-admin Users tab — cross-account dedup view.
 *
 * The 4 KPI cards double as filters:
 *   - TOTAL    : every non-platform user (excludes platform admins)
 *   - MULTI    : non-platform users sitting on more than one account
 *   - MONO     : non-platform users sitting on a single account
 *   - PLATFORM : users carrying at least one PLATFORM-scoped role assignment
 *
 * Status (All/Active/Inactive) stays as an orthogonal segmented filter.
 */
export function AccountPlatformUsers() {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const { hasPermission } = useModuleAccess()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [accountScope, setAccountScope] = useState<PlatformUsersAccountScope>('all')
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  // Open user — store id only, derive object from list (refetches keep ref-stability of object).
  const [openUserId, setOpenUserId] = useState<string | null>(null)

  const canToggleUser = hasPermission('ACCOUNT_USER_MANAGEMENT')
  const canInvite = hasPermission('USER_ACCOUNTS_INVITATION') || hasPermission('USER_ENTITIES_INVITATION')
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false)
  const updateUserMutation = useUpdateAccountUser()
  // Track which user is being toggled so only that card shows the wait state.
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null)
  const handleToggleUser = async (user: PlatformUserItem, next: boolean) => {
    // The PATCH endpoint is per-account; we route the call through any account the user is on.
    // The backend's last-admin guard handles the global checks (last platform admin / last
    // account admin) regardless of which account is used as the entry point.
    const accountId = user.accounts.find((a) => a.isDirect)?.id ?? user.accounts[0]?.id
    if (!accountId) return
    setTogglingUserId(user.id)
    try {
      await updateUserMutation.mutateAsync({ accountId, targetUserId: user.id, isActive: next })
    } catch (e: unknown) {
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

  const isActive = status === 'all' ? undefined : status === 'active'

  const { data, isLoading } = usePlatformUsers({
    search: debouncedSearch || undefined,
    isActive,
    accountScope,
    roleIds: selectedRoles.length > 0 ? selectedRoles : undefined,
    accountIds: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
    page: currentPage,
    limit: pageSize
  })

  // Role + account multi-select datasources — driven by their own debounced search inputs so we
  // never thrash the catalog endpoints while the user is typing.
  const [roleSearch, setRoleSearch] = useState('')
  const debouncedRoleSearch = useDebounce(roleSearch, 300)
  const { data: rolesData, isLoading: rolesLoading } = useSystemRoles({ search: debouncedRoleSearch || undefined, limit: 20 })
  const roleItems: MultiSelectFilterItem[] = (rolesData?.items ?? [])
    .filter((r) => r.name?.toLowerCase() !== 'guest')
    .map((r) => {
      const key = r.name?.toLowerCase()
      const isBuiltIn = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user'].includes(key)
      return { id: r.id, label: isBuiltIn ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : r.name }
    })

  const [accountSearch, setAccountSearch] = useState('')
  const debouncedAccountSearch = useDebounce(accountSearch, 300)
  const { data: accountsData, isLoading: accountsLoading } = useAllAccounts({ search: debouncedAccountSearch || undefined, limit: 20 })
  const accountItems: MultiSelectFilterItem[] = (accountsData?.items ?? []).map((a) => ({ id: a.id, label: a.name }))

  const items = data?.items ?? []
  const totalItems = data?.meta.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const aggregates = data?.aggregates ?? { total: 0, multi: 0, mono: 0, platform: 0 }
  const openUser = useMemo(() => items.find((u) => u.id === openUserId) ?? null, [items, openUserId])

  const statusOptions: readonly SegmentedOption<StatusFilter>[] = [
    { value: 'all', label: tAccount('users.filters.tk_status-all_') },
    { value: 'active', label: tAccount('users.filters.tk_status-active_') },
    { value: 'inactive', label: tAccount('users.filters.tk_status-inactive_') }
  ]

  const isFiltered = debouncedSearch.length > 0 || status !== 'all' || accountScope !== 'all' || selectedRoles.length > 0 || selectedAccountIds.length > 0

  const setScope = (next: PlatformUsersAccountScope) => {
    setAccountScope(next)
    setCurrentPage(1)
  }

  return (
    <div>
      {/* KPI cards = filters */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-4 items-stretch gap-3">
        <KpiFilterCard
          active={accountScope === 'all'}
          onClick={() => setScope('all')}
          icon={UsersIcon}
          label={tAccount('platformUsers.kpi.tk_total_')}
          value={aggregates.total}
          sub={tAccount('platformUsers.kpi.tk_total-sub_')}
        />
        <KpiFilterCard
          active={accountScope === 'multi'}
          onClick={() => setScope('multi')}
          icon={Layers}
          label={tAccount('platformUsers.kpi.tk_multi_')}
          value={aggregates.multi}
          sub={aggregates.multi === 0 ? tAccount('platformUsers.kpi.tk_multi-none_') : tAccount('platformUsers.kpi.tk_multi-some_')}
          tone="amber"
          alert={aggregates.multi > 0}
        />
        <KpiFilterCard
          active={accountScope === 'mono'}
          onClick={() => setScope('mono')}
          icon={UserIcon}
          label={tAccount('platformUsers.kpi.tk_mono_')}
          value={aggregates.mono}
          sub={tAccount('platformUsers.kpi.tk_mono-sub_')}
          tone="muted"
        />
        <KpiFilterCard
          active={accountScope === 'platform'}
          onClick={() => setScope('platform')}
          icon={Globe}
          label={tAccount('platformUsers.kpi.tk_platform_')}
          value={aggregates.platform}
          sub={tAccount('platformUsers.kpi.tk_platform-sub_')}
        />
      </div>

      {/* Filters bar — search + orthogonal status segmented, then role + account multiselects below.
          Same shape as the per-account Users tab so the filter affordance stays consistent. */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setCurrentPage(1)
              }}
              placeholder={tAccount('platformUsers.filters.tk_search-placeholder_')}
              className="pl-9"
            />
          </div>
          <SegmentedFilter
            value={status}
            onChange={(v) => {
              setStatus(v)
              setCurrentPage(1)
            }}
            options={statusOptions}
          />
          {canInvite && (
            <WaveButton type="button" onClick={() => setIsInviteDialogOpen(true)} className="!h-9 !w-auto !text-[11px] px-3.5">
              <UserPlus className="h-3.5 w-3.5" />
              {tAccount('users.tk_invite-user-cta_')}
            </WaveButton>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <MultiSelectFilter
            dataTestid="platform-users-roles-filter"
            selected={selectedRoles}
            onChange={(s) => {
              setSelectedRoles(s.map(Number))
              setCurrentPage(1)
            }}
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
            dataTestid="platform-users-accounts-filter"
            selected={selectedAccountIds}
            onChange={(s) => {
              setSelectedAccountIds(s.map(String))
              setCurrentPage(1)
            }}
            items={accountItems}
            icon={<Building2 className="h-3.5 w-3.5" />}
            placeholder={tAccount('platformUsers.filters.tk_select-accounts_')}
            selectedLabel={tAccount('platformUsers.filters.tk_selected-accounts_')}
            loading={accountsLoading}
            emptyText={tAccount('platformUsers.tk_no-users_')}
            search={accountSearch}
            onSearchChange={setAccountSearch}
          />
        </div>
      </div>

      {/* Tile grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-sm" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-card p-10 flex flex-col items-center justify-center gap-2 text-center">
          <UsersIcon className="h-5 w-5 text-muted-foreground/60" />
          <span className="text-sm text-muted-foreground">{isFiltered ? tAccount('platformUsers.tk_no-results-filtered_') : tAccount('platformUsers.tk_no-users_')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((u) => (
            <PlatformUserCard
              key={u.id}
              user={u}
              onOpen={() => setOpenUserId(u.id)}
              canToggle={canToggleUser && u.accounts.length > 0}
              isToggling={togglingUserId === u.id}
              onToggle={(next) => handleToggleUser(u, next)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="cursor-pointer inline-flex items-center justify-center h-7 w-7 rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[11px] text-muted-foreground tabular-nums px-2">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="cursor-pointer inline-flex items-center justify-center h-7 w-7 rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <PlatformUserDetailSheet user={openUser} onOpenChange={(open) => !open && setOpenUserId(null)} />

      {canInvite && isInviteDialogOpen && <InviteUserDialog isOpen={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen} />}
    </div>
  )
}

/* ─────────────── CARD ─────────────── */

/**
 * PlatformUserCard — same skeleton as RoleCard / AccountCard:
 *   - Header     : avatar + name + status badge top-right (pill convention shared with the
 *                  rest of the app: framed border, emerald when active, muted when inactive)
 *   - Body       : account chips using the SAME orange theme as the overview "Recent Users"
 *                  account badge (border-primary/22 bg-primary/12 text-primary uppercase)
 *   - Footer     : count meta on the left + "VIEW →" CTA hint on the right
 *
 * The platform badge moves into the header alongside the status pill so the top row carries
 * all the at-a-glance metadata in one place.
 */
const PLATFORM_BUILTIN_ROLE_KEYS = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']

function PlatformUserCard({
  user,
  onOpen,
  canToggle,
  isToggling,
  onToggle
}: {
  user: PlatformUserItem
  onOpen: () => void
  canToggle: boolean
  isToggling: boolean
  onToggle: (next: boolean) => void
}) {
  const { t: tAccount } = useTranslation('account')
  const fullName = `${user.people?.firstname ?? ''} ${user.people?.lastname ?? ''}`.trim() || tAccount('users.table.tk_name-fallback_')
  const initials = getInitials(user.people?.firstname ?? user.email[0], user.people?.lastname ?? '')
  const isMulti = user.accountCount > 1
  const isPlatformUser = user.isPlatformUser
  // Avatar tinting hint: platform > multi-account > regular.
  const avatarClass = isPlatformUser ? 'bg-primary/22 text-primary' : isMulti ? 'bg-amber-500/22 text-amber-500' : 'bg-muted text-muted-foreground'

  // Role chips — dedupe by name so a user with the same role on two accounts only shows once.
  const seenRoleNames = new Set<string>()
  const roleLabels: { id: number; label: string }[] = []
  for (const r of user.roles) {
    if (seenRoleNames.has(r.name)) continue
    seenRoleNames.add(r.name)
    const key = r.name?.toLowerCase()
    const isBuiltIn = PLATFORM_BUILTIN_ROLE_KEYS.includes(key)
    roleLabels.push({ id: r.id, label: isBuiltIn ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : r.name })
    if (roleLabels.length >= 2) break
  }
  const extraRoles = seenRoleNames.size > roleLabels.length ? seenRoleNames.size - roleLabels.length : 0

  return (
    <div role="button" onClick={onOpen} className="group cursor-pointer rounded-sm border border-border bg-card p-4 transition-colors hover:border-primary/40">
      {/* Header — avatar + name (+email below) | platform badge + role chips + status switch */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[12px] font-bold', avatarClass)}>{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="font-bold text-sm text-foreground truncate flex-1 min-w-0">{fullName}</span>
            {isPlatformUser && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary whitespace-nowrap">
                <Globe className="h-2.5 w-2.5" />
                {tAccount('platformUsers.row.tk_platform-badge_')}
              </span>
            )}
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

      {/* Body — a pending badge (data-derived from `pendingKind`) for users who haven't fully
          onboarded yet: "invited" = awaiting signup (we sent them an invitation), "awaiting-confirmation"
          = self-signup awaiting email confirmation. Otherwise the account chips (reuse the overview
          recent-users badge theme: primary-tinted frame so the same affordance says "attached to these
          accounts" everywhere). */}
      {user.pendingKind ? (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-500 whitespace-nowrap"
            title={tAccount(user.pendingKind === 'invited' ? 'platformUsers.row.tk_awaiting-signup-tooltip_' : 'platformUsers.row.tk_awaiting-confirmation-tooltip_')}
          >
            <Mail className="h-2.5 w-2.5" />
            {tAccount(user.pendingKind === 'invited' ? 'platformUsers.row.tk_awaiting-signup_' : 'platformUsers.row.tk_awaiting-confirmation_')}
          </span>
        </div>
      ) : user.accounts.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap',
              isMulti ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-border bg-muted text-muted-foreground'
            )}
            title={isMulti ? tAccount('platformUsers.row.tk_multi-account-tooltip_', { count: user.accountCount }) : undefined}
          >
            {user.accountCount}
          </span>
          {user.accounts.slice(0, 3).map((a) => (
            <span key={a.id} className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-primary/22 bg-primary/12 text-primary">
              {a.name}
            </span>
          ))}
          {user.accounts.length > 3 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-primary/22 bg-primary/12 text-primary">
              +{user.accounts.length - 3}
            </span>
          )}
        </div>
      ) : null}

      {/* Footer — created + last login (left), VIEW → CTA hint on the right. */}
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
        <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-primary transition-colors">{tAccount('platformUsers.row.tk_view_')} →</span>
      </div>
    </div>
  )
}

/* ─────────────── DETAIL SHEET ─────────────── */

function PlatformUserDetailSheet({ user, onOpenChange }: { user: PlatformUserItem | null; onOpenChange: (open: boolean) => void }) {
  const { t: tAccount } = useTranslation('account')
  if (!user) return null

  const fullName = `${user.people?.firstname ?? ''} ${user.people?.lastname ?? ''}`.trim() || tAccount('users.table.tk_name-fallback_')
  const initials = getInitials(user.people?.firstname ?? user.email[0], user.people?.lastname ?? '')
  const isMulti = user.accountCount > 1
  const avatarClass = user.isPlatformUser ? 'bg-primary/22 text-primary' : isMulti ? 'bg-amber-500/22 text-amber-500' : 'bg-muted text-muted-foreground'

  // Group entities by parent account so the user can see "X accounts → Y entities each"
  const entitiesByAccount = new Map<string, { id: string; name: string }[]>()
  for (const e of user.entities) {
    const list = entitiesByAccount.get(e.accountId) ?? []
    list.push({ id: e.id, name: e.name })
    entitiesByAccount.set(e.accountId, list)
  }

  return (
    <Sheet open={user !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-[480px] flex flex-col p-0 overflow-hidden">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[12px] font-bold', avatarClass)}>{initials}</div>
            <div className="min-w-0">
              <SheetTitle className="text-sm">{fullName}</SheetTitle>
              <SheetDescription className="text-xs text-foreground/80 mt-0.5 leading-snug">{user.email}</SheetDescription>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {user.isPlatformUser && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary">
                    <Globe className="h-2.5 w-2.5" />
                    {tAccount('platformUsers.row.tk_platform-badge_')}
                  </span>
                )}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    user.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', user.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                  {tAccount(user.isActive ? 'users.table.tk_status-active_' : 'users.table.tk_status-inactive_')}
                </span>
                {isMulti && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-500">
                    <Layers className="h-2.5 w-2.5" />
                    {tAccount('platformUsers.row.tk_multi-account-tooltip_', { count: user.accountCount })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Accounts */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('platformUsers.sheet.tk_accounts_')}</span>
              <span className="text-[10px] text-muted-foreground">{user.accounts.length}</span>
            </div>
            {user.accounts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">{tAccount('platformUsers.sheet.tk_no-accounts_')}</p>
            ) : (
              <div className="space-y-1.5">
                {user.accounts.map((a) => {
                  const accountEntities = entitiesByAccount.get(a.id) ?? []
                  return (
                    <div key={a.id} className="rounded-sm border border-border bg-card p-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <span className="text-[12px] font-semibold text-foreground break-words">{a.name}</span>
                        {a.isDirect && (
                          <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-primary/22 bg-primary/12 text-primary whitespace-nowrap">
                            {tAccount('users.table.tk_access-account_')}
                          </span>
                        )}
                      </div>
                      {accountEntities.length > 0 && (
                        <div className="mt-1.5 ml-5 flex flex-wrap gap-1">
                          {accountEntities.map((e) => (
                            <span
                              key={e.id}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground"
                            >
                              <ShieldCheck className="h-2.5 w-2.5" />
                              {e.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Roles */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('platformUsers.sheet.tk_roles_')}</span>
              <span className="text-[10px] text-muted-foreground">{user.roles.length}</span>
            </div>
            {user.roles.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">{tAccount('platformUsers.sheet.tk_no-roles_')}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {user.roles.map((r) => {
                  const knownRoles = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
                  const isBuiltIn = knownRoles.includes(r.name.toLowerCase())
                  const label = isBuiltIn ? tAccount(`roles.builtin.tk_${r.name.toLowerCase().replace('-', '_')}_`) : r.name
                  const Icon = r.scope === 'PLATFORM' ? Globe : r.scope === 'ENTITY' ? ShieldCheck : Shield
                  const tone = r.scope === 'ENTITY' ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-primary/22 bg-primary/12 text-primary'
                  return (
                    <span key={r.id} className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap', tone)}>
                      <Icon className="h-2.5 w-2.5" />
                      {label}
                      <span className="opacity-60 text-[9px] ml-0.5">{r.scope}</span>
                    </span>
                  )
                })}
              </div>
            )}
          </section>

          {/* Meta */}
          <section className="pt-3 border-t border-border/60 text-[11px] text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span>{tAccount('platformUsers.sheet.tk_created_')}</span>
              <span className="tabular-nums text-foreground">{formatDateLong(user.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{tAccount('platformUsers.sheet.tk_updated_')}</span>
              <span className="tabular-nums text-foreground">{formatDateLong(user.updatedAt)}</span>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
