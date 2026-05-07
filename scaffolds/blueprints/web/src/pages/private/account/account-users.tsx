/**
 * Resources
 */
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, Clock, Link as LinkIcon, Mail, Search, ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react'
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
import { useInvitedUsers } from '@/hooks/api/invitations/queries/useInvitedUsers'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useDebounce } from '@/hooks/ui/useDebounce'
import { formatDateShort, getInitials } from '@/utils/format'

/**
 * Components
 */
import { InviteUserDialog } from '@/components/dialogs/invite-user-dialog'
import { KpiCard } from '@/components/ui/custom/kpi-card'
import { MultiSelectFilter, MultiSelectFilterItem } from '@/components/ui/custom/multiselect-filter'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Input } from '@/components/ui/shadcn/input'
import { Skeleton } from '@/components/ui/shadcn/skeleton'

/**
 * Types
 */
import type { AccountUsersResponseDto } from '@/hooks/api/accounts/queries/useAccountUsers'
import type { MeResponseDto } from '@/hooks/api/auth'

type UserRow = AccountUsersResponseDto['items'][number]
type StatusFilter = 'all' | 'active' | 'inactive'

function getFullName(user: UserRow) {
  if (user.people) {
    const firstname = user.people.firstname ?? ''
    const lastname = user.people.lastname ?? ''
    const fullName = `${firstname} ${lastname}`.trim()
    return fullName || user.email
  }
  return user.email
}

/* ─────────────── KPI ROW ─────────────── */

function KpiRow({ total, accountLinked, pending }: { total: number; accountLinked: number; pending: number }) {
  const { t: tAccount } = useTranslation('account')
  const entityLinked = total - accountLinked
  const accountLinkedSub = total === 0 ? tAccount('users.kpi.tk_account-linked-sub-empty_') : tAccount('users.kpi.tk_account-linked-sub_', { percent: Math.round((accountLinked / total) * 100) })
  const pendingSub = pending === 0 ? tAccount('users.kpi.tk_pending-none_') : pending === 1 ? tAccount('users.kpi.tk_pending-one_') : tAccount('users.kpi.tk_pending-many_')
  return (
    <div className="mb-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
      <KpiCard icon={<UsersIcon className="text-primary h-3 w-3" />} label={tAccount('users.kpi.tk_total_')} value={total} sub={tAccount('users.kpi.tk_total-sub_', { accountLinked, entityLinked })} />
      <KpiCard icon={<LinkIcon className="text-primary h-3 w-3" />} label={tAccount('users.kpi.tk_account-linked_')} value={accountLinked} sub={accountLinkedSub} />
      <KpiCard icon={<Clock className="text-primary h-3 w-3" />} label={tAccount('users.kpi.tk_pending_')} value={pending} sub={pendingSub} alert={pending > 0} />
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
  includeDirect,
  setIncludeDirect,
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
  includeDirect: boolean
  setIncludeDirect: (v: boolean) => void
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
        <button
          type="button"
          data-testid="direct-users-switch-filter"
          onClick={() => setIncludeDirect(!includeDirect)}
          className={`cursor-pointer inline-flex items-center gap-2 px-3 h-9 rounded-sm border text-[11px] font-bold uppercase tracking-wider transition-colors ${
            includeDirect ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${includeDirect ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
          {tAccount('users.filters.tk_show-account-users_')}
        </button>
      </div>
    </div>
  )
}

/* ─────────────── PENDING INVITATIONS PANEL ─────────────── */

function PendingInvitations() {
  const { t: tAccount } = useTranslation('account')
  const { data: invitedUsersData } = useInvitedUsers()
  const { submitAsync: resendInvitation } = useInviteUser()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const pending = useMemo(() => invitedUsersData?.invitations.filter((i) => i.status === 'SENT' || i.status === 'EXPIRED') ?? [], [invitedUsersData])

  if (pending.length === 0) return null

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

  return (
    <div className="rounded-sm border border-border bg-card overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer w-full flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-primary" />
          <span className="font-display text-[13px] font-bold text-foreground">{tAccount('users.pending.tk_title_')}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            {pending.length}
          </span>
        </div>
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col">
          {pending.map((inv) => {
            const isExpired = inv.status === 'EXPIRED'
            return (
              <div key={inv.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────── USER ROW ─────────────── */

function UserRowItem({ user }: { user: UserRow }) {
  const { t: tAccount } = useTranslation('account')
  const fullName = getFullName(user)
  const initials = getInitials(user.people?.firstname ?? user.email[0], user.people?.lastname ?? '')
  const accessClass = user.isDirectlyLinked ? 'bg-primary/22 text-primary' : 'bg-muted text-muted-foreground'

  return (
    <div data-testid="user-row" className="grid grid-cols-[auto_1fr_220px_180px_120px_100px] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${accessClass}`}>{initials}</div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground leading-tight truncate">{fullName}</div>
        <div className="text-[11px] text-muted-foreground leading-tight truncate">{user.email}</div>
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        {user.isDirectlyLinked && (
          <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-primary/22 bg-primary/12 text-primary whitespace-nowrap">
            {tAccount('users.table.tk_access-account_')}
          </span>
        )}
        {user.entities && user.entities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {user.entities.slice(0, 3).map((e) => (
              <span
                key={e.id}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground whitespace-nowrap max-w-[160px] truncate"
              >
                {e.name}
              </span>
            ))}
            {user.entities.length > 3 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground">
                +{user.entities.length - 3}
              </span>
            )}
          </div>
        )}
        {!user.isDirectlyLinked && (!user.entities || user.entities.length === 0) && <span className="text-[11px] text-muted-foreground">—</span>}
      </div>
      <div className="flex flex-wrap gap-1 min-w-0">
        {user.roles.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          <>
            {user.roles.slice(0, 2).map((r) => {
              const key = r.name?.toLowerCase()
              const isBuiltIn = key === 'guest' || key === 'user' || key === 'admin'
              const label = isBuiltIn ? tAccount(`roles.builtin.tk_${key}_`) : r.name
              return (
                <span
                  key={r.id}
                  className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80 whitespace-nowrap max-w-[120px] truncate"
                >
                  {label}
                </span>
              )
            })}
            {user.roles.length > 2 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80">
                +{user.roles.length - 2}
              </span>
            )}
          </>
        )}
      </div>
      <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap">
        <span className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`} />
        <span className={user.isActive ? 'text-foreground' : 'text-muted-foreground'}>{user.isActive ? tAccount('users.table.tk_status-active_') : tAccount('users.table.tk_status-inactive_')}</span>
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap text-right">{formatDateShort(user.createdAt)}</span>
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
  const { t: tAccount } = useTranslation('account')

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [selectedEntities, setSelectedEntities] = useState<string[]>([])
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false)
  const [includeDirectUsers, setIncludeDirectUsers] = useState(true)

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const accountId = activeAccount?.id

  const isActive = status === 'all' ? undefined : status === 'active'

  const { data: account } = useAccount(accountId as string)
  const { data: usersData, isLoading } = useAccountUsers(accountId as string, {
    search: debouncedSearch,
    isActive,
    roleIds: selectedRoles.length > 0 ? selectedRoles : undefined,
    entityIds: selectedEntities.length > 0 ? selectedEntities : undefined,
    orderBy: UserOrderBy.CREATED_AT,
    page: currentPage,
    limit: pageSize,
    includeDirectUsers
  })
  const { data: invitationsData } = useInvitedUsers()

  const items = usersData?.items ?? []
  const totalItems = usersData?.meta.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const accountLinkedAll = useMemo(() => (account?.users.values ?? []).filter((u) => u.isDirectlyLinked).length, [account])
  const totalAll = account?.users.count ?? 0
  const pendingCount = useMemo(() => invitationsData?.invitations.filter((i) => i.status === 'SENT').length ?? 0, [invitationsData])

  const canInvite = hasPermission('USER_ACCOUNTS_INVITATION') || hasPermission('USER_ENTITIES_INVITATION')
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

  return (
    <div>
      <KpiRow total={totalAll} accountLinked={accountLinkedAll} pending={pendingCount} />

      <FilterBar
        search={searchInput}
        onSearch={handleSearch}
        status={status}
        onStatus={handleStatus}
        selectedEntities={selectedEntities}
        onEntitiesChange={handleEntities}
        selectedRoles={selectedRoles}
        onRolesChange={handleRoles}
        includeDirect={includeDirectUsers}
        setIncludeDirect={setIncludeDirectUsers}
        accountId={accountId as string}
        onInvite={() => setIsInviteDialogOpen(true)}
        canInvite={canInvite}
      />

      <PendingInvitations />

      <div data-testid="users-table" className="rounded-sm border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_220px_180px_120px_100px] gap-3.5 px-4 py-2.5 border-b border-border bg-muted/40">
          <span className="w-8" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.table.tk_user_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.table.tk_access-scope_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.table.tk_roles_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('users.table.tk_status_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-right">{tAccount('users.table.tk_created_')}</span>
        </div>
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_220px_180px_120px_100px] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0">
                <Skeleton className="skeleton-shimmer-orange h-8 w-8 rounded-full" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-3/4" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-32" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-24" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-16" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-muted-foreground">
            <UsersIcon className="h-4 w-4 opacity-40" />
            {isFiltered ? tAccount('users.tk_no-results-filtered_') : tAccount('users.tk_no-users-yet_')}
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((u) => (
              <UserRowItem key={u.id} user={u} />
            ))}
          </div>
        )}
        <MiniPagination page={currentPage} totalPages={totalPages} onPage={setCurrentPage} />
      </div>

      {canInvite && isInviteDialogOpen && <InviteUserDialog isOpen={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen} />}
    </div>
  )
}
