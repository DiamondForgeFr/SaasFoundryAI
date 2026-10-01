/**
 * Resources
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useApproveReactivationRequest, useRejectReactivationRequest } from '@/hooks/api/accounts/mutations/useReviewReactivationRequest'
import { useInviteUser } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import { useUpdateAccountStatus } from '@/hooks/api/accounts/mutations/useUpdateAccountStatus'
import { useAllAccounts, type AccountListItem } from '@/hooks/api/accounts/queries/useAllAccounts'
import { useCancelInvitation } from '@/hooks/api/invitations/mutations/useCancelInvitation'
import { usePlatformAccountOwnerInvitations } from '@/hooks/api/invitations/queries/useInvitedUsers'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useDebounce } from '@/hooks/ui/useDebounce'
import { Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Mail, MessageSquareWarning, Search, Shield, Users as UsersIcon, X } from 'lucide-react'

/**
 * Components
 */
import { ConfirmDialog } from '@/components/ui/custom/confirm-dialog'
import { InviteAccountOwnerDialog } from '@/components/dialogs/invite-account-owner-dialog'
import { KpiFilterCard } from '@/components/ui/custom/kpi-filter-card'
import { RejectReactivationDialog } from '@/components/dialogs/reject-reactivation-dialog'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Input } from '@/components/ui/shadcn/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Switch } from '@/components/ui/shadcn/switch'

import { formatDateLong, formatDateShort } from '@/utils/format'

/**
 * Filter modes — also drive which KPI card is highlighted as the active selection.
 *
 *   - all      : every account, no narrowing
 *   - active   : isActive === true
 *   - disabled : isActive === false
 *   - pending  : has at least one PENDING reactivation request awaiting review
 */
type AccountsFilter = 'all' | 'active' | 'disabled' | 'pending'

function shortenId(id: string) {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

/**
 * Platform-admin tab — full list of every account on the platform with management actions.
 *
 * UX layout:
 *   1. Four clickable KPI cards: TOTAL / ACTIVE / DISABLED / PENDING. Each card sets the
 *      filter; the active card is highlighted. Counts are GLOBAL (independent of filter)
 *      so the cards stay stable as the user navigates.
 *   2. Search input + invite-owner CTA on the row below.
 *   3. Table: rows with a pending reactivation request are clickable — click opens a Sheet
 *      drawer showing the message, requester info, and Approve / Reject actions. The status
 *      toggle and copy-id buttons inside the row stop event propagation so clicking them
 *      doesn't open the drawer.
 */
export function AccountAccounts() {
  const { t: tAccount } = useTranslation('account')
  const { hasPermission } = useModuleAccess()
  const { setCurrentScope } = useAdminScope()

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [filter, setFilter] = useState<AccountsFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [isInviteOwnerOpen, setIsInviteOwnerOpen] = useState(false)
  const [pendingStatusToggle, setPendingStatusToggle] = useState<AccountListItem | null>(null)
  const [openPendingAccount, setOpenPendingAccount] = useState<AccountListItem | null>(null)
  const [pendingReject, setPendingReject] = useState<AccountListItem | null>(null)

  const { data, isLoading } = useAllAccounts({
    search: debouncedSearch || undefined,
    isActive: filter === 'active' ? true : filter === 'disabled' ? false : undefined,
    withPendingReactivation: filter === 'pending' ? true : undefined,
    page: currentPage,
    limit: pageSize
  })

  const items = data?.items ?? []
  const totalItems = data?.meta.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const aggregates = data?.aggregates ?? { total: 0, active: 0, disabled: 0, pending: 0 }

  const updateStatus = useUpdateAccountStatus()
  const approveRequest = useApproveReactivationRequest()
  const rejectRequest = useRejectReactivationRequest()

  const canInviteOwner = hasPermission('ACCOUNT_INVITE_OWNER')
  const canToggleStatus = hasPermission('ACCOUNT_UPDATE')
  const canReviewReactivations = hasPermission('ACCOUNT_REACTIVATION_REVIEW')
  const isFiltered = debouncedSearch.length > 0 || filter !== 'all'

  const setFilterAndReset = (next: AccountsFilter) => {
    setFilter(next)
    setCurrentPage(1)
  }

  const handleSearch = (v: string) => {
    setSearchInput(v)
    setCurrentPage(1)
  }

  const confirmToggle = async () => {
    if (!pendingStatusToggle) return
    try {
      await updateStatus.mutateAsync({ accountId: pendingStatusToggle.id, isActive: !pendingStatusToggle.isActive })
      setPendingStatusToggle(null)
    } catch (e) {
      console.error('Failed to toggle account status', e)
    }
  }

  const handleApprove = async () => {
    if (!openPendingAccount?.pendingReactivation) return
    try {
      await approveRequest.mutateAsync({ requestId: openPendingAccount.pendingReactivation.id })
      setOpenPendingAccount(null)
    } catch (e) {
      console.error('Failed to approve request', e)
    }
  }

  const handleReject = async (note: string) => {
    if (!pendingReject?.pendingReactivation) return
    try {
      await rejectRequest.mutateAsync({ requestId: pendingReject.pendingReactivation.id, note })
      setPendingReject(null)
      setOpenPendingAccount(null)
    } catch (e) {
      console.error('Failed to reject request', e)
    }
  }

  return (
    <>
      <div>
        {/* KPIs — clickable filters */}
        <div className={cn('mb-6 grid grid-cols-1 items-stretch gap-3', canReviewReactivations ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
          <KpiFilterCard
            active={filter === 'all'}
            onClick={() => setFilterAndReset('all')}
            icon={Building2}
            label={tAccount('accounts.kpi.tk_total_')}
            value={aggregates.total}
            sub={tAccount('accounts.kpi.tk_total-sub_')}
          />
          <KpiFilterCard
            active={filter === 'active'}
            onClick={() => setFilterAndReset('active')}
            icon={Building2}
            label={tAccount('accounts.kpi.tk_active_')}
            value={aggregates.active}
            sub={tAccount('accounts.kpi.tk_active-sub_')}
            tone="emerald"
          />
          <KpiFilterCard
            active={filter === 'disabled'}
            onClick={() => setFilterAndReset('disabled')}
            icon={Building2}
            label={tAccount('accounts.kpi.tk_disabled_')}
            value={aggregates.disabled}
            sub={aggregates.disabled === 0 ? tAccount('accounts.kpi.tk_disabled-none_') : tAccount('accounts.kpi.tk_disabled-some_')}
            tone="muted"
          />
          {canReviewReactivations && (
            <KpiFilterCard
              active={filter === 'pending'}
              onClick={() => setFilterAndReset('pending')}
              icon={MessageSquareWarning}
              label={tAccount('accounts.kpi.tk_pending_')}
              value={aggregates.pending}
              sub={aggregates.pending === 0 ? tAccount('accounts.kpi.tk_pending-none_') : tAccount('accounts.kpi.tk_pending-some_')}
              tone="amber"
              alert={aggregates.pending > 0}
            />
          )}
        </div>

        {/* Pending account-owner invitations panel — same collapsible pattern as the per-account
            "Pending Invitations" panel on the Users tab. Only shown for actors who can list
            every account on the platform. */}
        {canReviewReactivations && <PlatformAccountOwnerInvitations />}

        {/* Filters bar — search + invite. The status filter moved to the KPI cards. */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
            <Input type="text" value={searchInput} onChange={(e) => handleSearch(e.target.value)} placeholder={tAccount('accounts.filters.tk_search-placeholder_')} className="pl-9" />
          </div>
          {canInviteOwner && (
            <WaveButton type="button" onClick={() => setIsInviteOwnerOpen(true)} className="!h-9 !w-auto px-3.5 !text-[11px]">
              <Mail className="h-3.5 w-3.5" />
              {tAccount('overview.recentAccounts.tk_invite-owner_')}
            </WaveButton>
          )}
        </div>

        {/* Tile grid — same affordance as the Roles tab. Each tile = one account. */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-sm" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="border-border bg-card flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed p-10 text-center">
            <Building2 className="text-muted-foreground/60 h-5 w-5" />
            <span className="text-muted-foreground text-sm">{isFiltered ? tAccount('accounts.tk_no-results-filtered_') : tAccount('accounts.tk_no-accounts_')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                canToggleStatus={canToggleStatus}
                isToggling={updateStatus.isLoading}
                onToggleRequest={() => setPendingStatusToggle(acc)}
                onOpenPending={() => setOpenPendingAccount(acc)}
                onOpenContext={() => setCurrentScope({ kind: 'PLATFORM', id: acc.id })}
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
              className="border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-muted-foreground px-2 text-[11px] tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {canInviteOwner && <InviteAccountOwnerDialog isOpen={isInviteOwnerOpen} onOpenChange={setIsInviteOwnerOpen} />}
      </div>

      {pendingStatusToggle && (
        <ConfirmDialog
          isOpen={pendingStatusToggle !== null}
          onOpenChange={(open) => !open && setPendingStatusToggle(null)}
          title={tAccount(pendingStatusToggle.isActive ? 'scopeHeader.tk_status-deactivate-title_' : 'scopeHeader.tk_status-reactivate-title_', { name: pendingStatusToggle.name })}
          description={tAccount(pendingStatusToggle.isActive ? 'scopeHeader.tk_status-deactivate-desc_' : 'scopeHeader.tk_status-reactivate-desc_')}
          tone={pendingStatusToggle.isActive ? 'destructive' : 'default'}
          confirmLabel={tAccount(pendingStatusToggle.isActive ? 'scopeHeader.tk_status-deactivate-cta_' : 'scopeHeader.tk_status-reactivate-cta_')}
          isLoading={updateStatus.isLoading}
          onConfirm={confirmToggle}
        />
      )}

      <PendingReactivationSheet
        account={openPendingAccount}
        onOpenChange={(open) => !open && setOpenPendingAccount(null)}
        isApproving={approveRequest.isLoading}
        isRejecting={rejectRequest.isLoading}
        onApprove={handleApprove}
        onReject={() => setPendingReject(openPendingAccount)}
      />

      {pendingReject && (
        <RejectReactivationDialog
          isOpen={pendingReject !== null}
          onOpenChange={(open) => !open && setPendingReject(null)}
          accountName={pendingReject.name}
          isLoading={rejectRequest.isLoading}
          onConfirm={handleReject}
        />
      )}
    </>
  )
}

/* ─────────────── PLATFORM ACCOUNT-OWNER INVITATIONS PANEL ─────────────── */

/**
 * Collapsible panel listing every PENDING account-owner invitation across the platform —
 * same shape as the per-account "Pending Invitations" panel on the Users tab. Lets a
 * platform-admin resend or cancel pending invites without leaving the Accounts tab.
 *
 * Hidden when there are no pending invitations (zero noise on a clean platform).
 */
function PlatformAccountOwnerInvitations() {
  const { t: tAccount } = useTranslation('account')
  const { data, refetch } = usePlatformAccountOwnerInvitations()
  const { submitAsync: resendInvitation } = useInviteUser()
  const cancelInvitation = useCancelInvitation()
  const [open, setOpen] = useState(false)

  const pending = useMemo(() => data?.invitations.filter((i) => i.status === 'SENT' || i.status === 'EXPIRED') ?? [], [data])

  if (pending.length === 0) return null

  const handleResend = async (invitation: (typeof pending)[number]) => {
    try {
      // Account-owner invitation = zero account/entity targets, no roles either (the role is
      // auto-assigned at activation). Re-emitting with the same email keeps the same flow.
      await resendInvitation({ email: invitation.inviteeUserEmail, roleIds: [], accountIds: [], entityIds: [] })
      refetch()
    } catch (e) {
      console.error('Failed to resend account-owner invitation:', e)
    }
  }

  const handleCancel = async (invitation: (typeof pending)[number]) => {
    if (!confirm(tAccount('platformInvitations.tk_cancel-confirm_'))) return
    try {
      await cancelInvitation.mutateAsync(invitation.id)
    } catch (e) {
      console.error('Failed to cancel invitation:', e)
    }
  }

  return (
    <div className="border-border bg-card mb-4 overflow-hidden rounded-sm border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="border-border hover:bg-muted/40 flex w-full cursor-pointer items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Mail className="text-primary h-3.5 w-3.5" />
          <span className="font-display text-foreground text-[13px] font-bold">{tAccount('platformInvitations.tk_title_')}</span>
          <span className="inline-flex items-center rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400">
            {pending.length}
          </span>
        </div>
        <ChevronRight className={cn('text-muted-foreground h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="flex flex-col">
          {pending.map((inv) => {
            const isExpired = inv.status === 'EXPIRED'
            return (
              <div key={inv.id} className="border-border hover:bg-muted grid grid-cols-[1fr_auto_auto_auto] items-center gap-3.5 border-b px-4 py-3 transition-colors last:border-b-0">
                <div className="min-w-0">
                  <div className="text-foreground truncate text-[13px] leading-tight font-semibold">{inv.inviteeUserEmail}</div>
                  <div className="text-muted-foreground text-[11px] leading-tight">
                    {tAccount('platformInvitations.tk_sent-prefix_')} {formatDateShort(inv.invitedAt)}
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase',
                    isExpired ? 'border-red-500/40 bg-red-500/10 text-red-500 dark:text-red-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  )}
                >
                  {isExpired ? tAccount('platformInvitations.tk_status-expired_') : tAccount('platformInvitations.tk_status-pending_')}
                </span>
                <button
                  type="button"
                  onClick={() => handleResend(inv)}
                  className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
                >
                  {tAccount('platformInvitations.tk_resend_')} <ChevronRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel(inv)}
                  disabled={cancelInvitation.isLoading}
                  className="border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive/40 inline-flex cursor-pointer items-center justify-center rounded-[2px] border p-1 transition-colors disabled:opacity-50"
                  title={tAccount('platformInvitations.tk_cancel_')}
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

/* ─────────────── ACCOUNT CARD ─────────────── */

/**
 * AccountCard — same affordance pattern as the Roles tab cards.
 *
 *   - Header (top row)  : icon + name + status badge/toggle on the right
 *   - Body              : id-with-copy + (when pending) request message preview
 *   - Footer            : counts on the left + "OPEN CONTEXT →" / "REVIEW REQUEST →" CTA on the right
 *
 * The whole card is the click target. Default action: switch the platform-admin's scope into
 * this account (`onOpenContext`). When the account has a pending reactivation request the
 * action becomes "review the request" (`onOpenPending`) and the card adopts the amber theme.
 *
 * Status toggle and id-copy are nested buttons that stop event propagation so they don't
 * trigger the card-level click action.
 */
function AccountCard({
  account,
  canToggleStatus,
  isToggling,
  onToggleRequest,
  onOpenPending,
  onOpenContext
}: {
  account: AccountListItem
  canToggleStatus: boolean
  isToggling: boolean
  onToggleRequest: () => void
  onOpenPending: () => void
  onOpenContext: () => void
}) {
  const { t: tAccount } = useTranslation('account')
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(account.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const hasPending = Boolean(account.pendingReactivation)
  const handleCardClick = () => {
    if (hasPending) onOpenPending()
    else onOpenContext()
  }

  return (
    <div
      data-testid={`account-card-${account.id}`}
      role="button"
      onClick={handleCardClick}
      className={cn(
        'group bg-card cursor-pointer rounded-sm border p-4 transition-all',
        hasPending ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60 hover:bg-amber-500/10' : 'border-border hover:border-primary/40'
      )}
      title={hasPending ? tAccount('accounts.row.tk_pending-tooltip_') : tAccount('accounts.row.tk_open-context-tooltip_')}
    >
      {/* Header — icon + name + status badge/toggle on the right */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border', hasPending ? 'border-amber-500/30 bg-amber-500/10' : 'border-primary/25 bg-primary/10')}>
          {hasPending ? <MessageSquareWarning className={cn('h-4 w-4 text-amber-500')} /> : <Shield className="text-primary h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">{account.name}</span>
            {/* Status pill: keeps the framed badge UI (consistent with the rest of the app's
                bordered status chips), but the dot icon is replaced by a real Switch — so the
                affordance reads as "interactive on/off" without giving up the visual coherence.
                Active = emerald frame + switch tinted emerald; Disabled = muted frame + switch
                tinted muted. */}
            {canToggleStatus ? (
              <label
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'inline-flex flex-shrink-0 items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase transition-colors select-none',
                  account.isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                  isToggling ? 'cursor-wait opacity-50' : 'cursor-pointer'
                )}
                title={tAccount(account.isActive ? 'scopeHeader.tk_status-deactivate_' : 'scopeHeader.tk_status-reactivate_')}
              >
                <Switch
                  checked={account.isActive}
                  disabled={isToggling}
                  onCheckedChange={onToggleRequest}
                  className={cn(
                    '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                    account.isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                  )}
                />
                <span>{tAccount(account.isActive ? 'scopeHeader.tk_status-active_' : 'scopeHeader.tk_status-disabled_')}</span>
              </label>
            ) : (
              <span
                className={cn(
                  'inline-flex flex-shrink-0 items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase',
                  account.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', account.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                {tAccount(account.isActive ? 'scopeHeader.tk_status-active_' : 'scopeHeader.tk_status-disabled_')}
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px] leading-tight">
            <span className="font-mono">{shortenId(account.id)}</span>
            <button type="button" onClick={handleCopy} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" title={tAccount('scopeHeader.tk_copy-id_')}>
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          {hasPending && account.pendingReactivation && <div className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-amber-500/90">{account.pendingReactivation.message}</div>}
        </div>
      </div>

      {/* Footer — counts + CTA hint matching the Roles "VIEW →" affordance */}
      <div className="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <div className="inline-flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <UsersIcon className="text-muted-foreground h-3 w-3" />
            <span className="text-foreground font-medium tabular-nums">{account.usersCount}</span>
            <span className="text-muted-foreground">{tAccount('accounts.table.tk_users_').toLowerCase()}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="text-muted-foreground h-3 w-3" />
            <span className="text-foreground font-medium tabular-nums">{account.entitiesCount}</span>
            <span className="text-muted-foreground">{tAccount('accounts.table.tk_entities_').toLowerCase()}</span>
          </span>
        </div>
        {/* CTA hint — matches the Roles "VIEW →" affordance exactly: same font size, no bold,
            same muted→primary hover transition, literal "→" character (no icon). */}
        <span
          className={cn('text-[10px] tracking-wider uppercase transition-colors', hasPending ? 'text-amber-500/70 group-hover:text-amber-500' : 'text-muted-foreground/70 group-hover:text-primary')}
        >
          {hasPending ? tAccount('accounts.row.tk_review-request_') : tAccount('overview.recentAccounts.tk_open-context_')} →
        </span>
      </div>
    </div>
  )
}

/* ─────────────── PENDING REACTIVATION SHEET ─────────────── */

function PendingReactivationSheet({
  account,
  onOpenChange,
  isApproving,
  isRejecting,
  onApprove,
  onReject
}: {
  account: AccountListItem | null
  onOpenChange: (open: boolean) => void
  isApproving: boolean
  isRejecting: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const { t: tAccount } = useTranslation('account')
  const request = account?.pendingReactivation
  const requesterName = request ? `${request.requestedBy.people?.firstname ?? ''} ${request.requestedBy.people?.lastname ?? ''}`.trim() || request.requestedBy.email : ''

  return (
    <Sheet open={account !== null && request !== null} onOpenChange={onOpenChange}>
      <SheetContent data-testid="reactivation-review-sheet" side="right" className="flex flex-col overflow-hidden p-0 sm:max-w-[500px]">
        <SheetHeader className="border-border border-b px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
              <MessageSquareWarning className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base font-bold tracking-tight">{account?.name}</SheetTitle>
              <SheetDescription className="mt-0.5 text-[11px]">{tAccount('platformReactivation.sheet.tk_subtitle_')}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {request && (
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section>
              <div className="text-muted-foreground mb-2 text-[10px] font-bold tracking-widest uppercase">{tAccount('platformReactivation.sheet.tk_requested-by_')}</div>
              <div className="border-border bg-muted/30 rounded-sm border px-3 py-2.5">
                <div className="text-foreground text-[13px] font-semibold">{requesterName}</div>
                <div className="text-muted-foreground text-[11px]">{request.requestedBy.email}</div>
                <div className="text-muted-foreground mt-1 text-[11px]">{tAccount('platformReactivation.sheet.tk_submitted-at_', { date: formatDateLong(request.createdAt) })}</div>
              </div>
            </section>

            <section>
              <div className="text-muted-foreground mb-2 text-[10px] font-bold tracking-widest uppercase">{tAccount('platformReactivation.sheet.tk_message_')}</div>
              <div className="border-border bg-card text-foreground rounded-sm border p-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap">{request.message}</div>
            </section>
          </div>
        )}

        {request && (
          <div className="border-border bg-muted/20 flex flex-col gap-2 border-t px-6 py-4">
            <button
              data-testid="reactivation-approve"
              type="button"
              onClick={onApprove}
              disabled={isApproving || isRejecting}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10 text-[12px] font-semibold text-emerald-500 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {tAccount('platformReactivation.tk_approve_')}
            </button>
            <button
              data-testid="reactivation-reject"
              type="button"
              onClick={onReject}
              disabled={isApproving || isRejecting}
              className="border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/15 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border text-[12px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              {tAccount('platformReactivation.tk_reject_')}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
