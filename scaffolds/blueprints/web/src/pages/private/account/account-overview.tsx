/**
 * Resources
 */
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useAccount } from '@/hooks/api/accounts'
import { useAllAccounts } from '@/hooks/api/accounts/queries/useAllAccounts'
import { usePlatformOverview } from '@/hooks/api/accounts/queries/usePlatformOverview'
import { useSignOut } from '@/hooks/api/auth'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { InviteAccountOwnerDialog } from '@/components/dialogs/invite-account-owner-dialog'
import { InviteUserDialog } from '@/components/dialogs/invite-user-dialog'
import { formatDateShort, getInitials } from '@/utils/format'

/**
 * Components
 */
import { cn } from '@/utils/ui'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, Clock, Mail, Plus, Shield, ShieldCheck, User as UserIcon, Users } from 'lucide-react'

/**
 * Types
 */
import type { AccountResponseDto } from '@/hooks/api/accounts/queries/useAccount'
import type { MeResponseDto } from '@/hooks/api/auth'
type UserDto = AccountResponseDto['users']['values'][0]
type EntityDto = AccountResponseDto['entities']['values'][0]
type RoleDto = AccountResponseDto['roles']['values'][0]

/* ─────────────── KPI ROW (3 KPIs + Quick Actions inline) ─────────────── */

function KpiRow({
  account,
  pendingInvitations,
  pendingSignups,
  scopedUsers,
  scopedEntitiesCount,
  isEntityScoped
}: {
  account: AccountResponseDto
  pendingInvitations: number
  pendingSignups: number
  scopedUsers: AccountResponseDto['users']['values']
  scopedEntitiesCount: number
  isEntityScoped: boolean
}) {
  const { t: tAccount } = useTranslation('account')
  const usersForBreakdown = isEntityScoped ? scopedUsers : account.users.values
  const usersTotal = isEntityScoped ? scopedUsers.length : account.users.count
  const accountLinkedCount = useMemo(() => usersForBreakdown.filter((u) => u.isDirectlyLinked).length, [usersForBreakdown])
  const entityOnlyCount = usersTotal - accountLinkedCount
  const pendingTotal = pendingInvitations + pendingSignups
  // Adaptive sub-line: nothing awaiting → neutral copy; otherwise list both counters with sensible pluralization.
  const pendingSub = pendingTotal === 0 ? tAccount('overview.kpi.tk_pending-none_') : tAccount('overview.kpi.tk_pending-breakdown_', { invitations: pendingInvitations, signups: pendingSignups })
  const entitiesTotal = isEntityScoped ? scopedEntitiesCount : account.entities.count

  return (
    <div data-testid="overview-kpis" className="mb-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
      {/* Users KPI */}
      <div data-testid="kpi-users" className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
            <Users className="text-primary h-3 w-3" />
            {tAccount('overview.kpi.tk_users_')}
          </span>
        </div>
        <div className="font-display text-3xl leading-none font-bold">{usersTotal}</div>
        <div className="text-muted-foreground text-[11px]">{tAccount('overview.kpi.tk_users-sub_', { accountLinked: accountLinkedCount, entityLinked: entityOnlyCount })}</div>
      </div>

      {/* Entities KPI */}
      <div data-testid="kpi-entities" className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
            <Building2 className="text-primary h-3 w-3" />
            {tAccount('overview.kpi.tk_entities_')}
          </span>
        </div>
        <div className="font-display text-3xl leading-none font-bold">{entitiesTotal}</div>
        <div className="text-muted-foreground text-[11px]">{tAccount('overview.kpi.tk_entities-sub_', { active: entitiesTotal, disabled: 0 })}</div>
      </div>

      {/* Pending invitations / sign-ups KPI — two numbers (invitations · sign-ups) with an adaptive sub-line. */}
      <div data-testid="kpi-pending" className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
            <Clock className="text-primary h-3 w-3" />
            {tAccount('overview.kpi.tk_pending_')}
          </span>
          {pendingTotal > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px] shadow-amber-500" />}
        </div>
        <div className="font-display flex items-baseline gap-2 text-3xl leading-none font-bold">
          <span>{pendingInvitations}</span>
          <span className="text-muted-foreground/50 text-xl">·</span>
          <span>{pendingSignups}</span>
        </div>
        <div className="text-muted-foreground text-[11px]">{pendingSub}</div>
      </div>
    </div>
  )
}

/* ─────────────── CARD ─────────────── */

function Card({ children, dataTestid }: { children: React.ReactNode; dataTestid?: string }) {
  return (
    <div data-testid={dataTestid} className="border-border bg-card overflow-hidden rounded-sm border">
      {children}
    </div>
  )
}

function CardHeader({ icon, title, meta, action, onAction, rightSlot }: { icon: React.ReactNode; title: string; meta?: string; action?: string; onAction?: () => void; rightSlot?: React.ReactNode }) {
  return (
    <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <span className="font-display text-foreground text-[13px] font-bold">{title}</span>
        {meta && <span className="text-muted-foreground text-[11px] font-medium">{meta}</span>}
      </div>
      <div className="flex items-center gap-3">
        {rightSlot}
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {action} <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

/* ─────────────── RECENT USERS ─────────────── */

function RecentUsers({ users, onInvite, canInvite }: { users: UserDto[]; onInvite: () => void; canInvite: boolean }) {
  const navigate = useNavigate()
  const { t: tAccount } = useTranslation('account')
  return (
    <Card dataTestid="recent-users-section">
      <CardHeader
        icon={<Users className="h-3.5 w-3.5" />}
        title={tAccount('overview.recentUsers.tk_title_')}
        meta={tAccount('overview.recentUsers.tk_meta-most-recent_', { count: users.length })}
        rightSlot={
          canInvite ? (
            <WaveButton type="button" onClick={onInvite} className="!h-8 !w-auto px-3.5 !text-[11px]">
              <Mail className="h-3.5 w-3.5" />
              {tAccount('overview.recentUsers.tk_invite-cta_')}
            </WaveButton>
          ) : undefined
        }
      />
      <div className="flex flex-col">
        {users.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center text-xs">{tAccount('overview.recentUsers.tk_no-users_')}</div>
        ) : (
          users.slice(0, 5).map((u) => {
            const fullName = `${u.people?.firstname ?? ''} ${u.people?.lastname ?? ''}`.trim() || u.email
            const initials = getInitials(u.people?.firstname ?? u.email[0], u.people?.lastname ?? '')
            const accessClass = u.isDirectlyLinked ? 'bg-primary/22 text-primary' : 'bg-muted text-muted-foreground'
            return (
              <div
                data-testid="recent-user-row"
                key={u.id}
                className="border-border hover:bg-muted grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3.5 border-b px-4 py-3 transition-colors last:border-b-0"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold ${accessClass}`}>{initials}</div>
                <div className="min-w-0">
                  <div className="text-foreground truncate text-[13px] leading-tight font-semibold">{fullName}</div>
                  <div className="text-muted-foreground truncate text-[11px] leading-tight">{u.email}</div>
                </div>
                {u.isDirectlyLinked ? (
                  <span className="border-primary/22 bg-primary/12 text-primary inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase">
                    {tAccount('users.table.tk_access-account_')}
                  </span>
                ) : u.entities && u.entities.length > 0 ? (
                  <span className="border-border bg-muted text-muted-foreground inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase">
                    {u.entities[0].name}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[11px]">—</span>
                )}
                {/* Role chip — same affordance as the other role tags so it reads as "this is a role". */}
                {(() => {
                  const r = u.roles?.[0]?.name
                  if (!r) return <span className="text-muted-foreground text-[11px]">—</span>
                  const k = r.toLowerCase()
                  const knownRoles = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
                  const label = knownRoles.includes(k) ? tAccount(`roles.builtin.tk_${k.replace('-', '_')}_`) : r
                  return (
                    <span
                      className="border-border bg-secondary text-foreground/80 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase"
                      title={tAccount('overview.recentUsers.tk_role-tooltip_', { role: label })}
                    >
                      <Shield className="h-2.5 w-2.5" />
                      {label}
                    </span>
                  )
                })()}
                <span className="text-muted-foreground text-[11px] whitespace-nowrap tabular-nums">{formatDateShort(u.createdAt, { withYear: false })}</span>
              </div>
            )
          })
        )}
      </div>
      {users.length > 0 && (
        <div className="border-border flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            data-testid="recent-users-view-all"
            onClick={() => navigate('/account?tab=users')}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {tAccount('overview.recentUsers.tk_view-all-users_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── RECENT ENTITIES ─────────────── */

function RecentEntities({ entities, onCreate, canCreate }: { entities: EntityDto[]; onCreate: () => void; canCreate: boolean }) {
  const navigate = useNavigate()
  const { t: tAccount } = useTranslation('account')
  return (
    <Card dataTestid="recent-entities-section">
      <CardHeader
        icon={<Building2 className="h-3.5 w-3.5" />}
        title={tAccount('overview.recentEntities.tk_title_')}
        meta={tAccount('overview.recentEntities.tk_meta-total_', { count: entities.length })}
        rightSlot={
          canCreate ? (
            <WaveButton type="button" onClick={onCreate} className="!h-8 !w-auto px-3.5 !text-[11px]">
              <Plus className="h-3.5 w-3.5" />
              {tAccount('overview.recentEntities.tk_create-cta_')}
            </WaveButton>
          ) : undefined
        }
      />
      <div className="flex flex-col">
        {entities.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center text-xs">{tAccount('overview.recentEntities.tk_no-entities-yet_')}</div>
        ) : (
          entities.slice(0, 5).map((e) => (
            <div data-testid="recent-entity-row" key={e.id} className="border-border hover:bg-muted flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0">
              <div className="bg-muted border-border text-muted-foreground flex h-7 w-7 items-center justify-center rounded-sm border">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-[13px] leading-tight font-semibold">{e.name}</div>
                {e.organization?.name && <div className="text-muted-foreground truncate text-[11px] leading-tight">{e.organization.name}</div>}
              </div>
              <span className="border-border bg-muted text-muted-foreground inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase">
                {(e.organization as { type?: string } | null)?.type ?? '—'}
              </span>
            </div>
          ))
        )}
      </div>
      {entities.length > 0 && (
        <div className="border-border flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            data-testid="recent-entities-view-all"
            onClick={() => navigate('/account?tab=entities')}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {tAccount('overview.recentEntities.tk_view-all-entities_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── ROLES ─────────────── */

function RolesCard({ roles, allowPlatform }: { roles: RoleDto[]; allowPlatform: boolean }) {
  const { t: tAccount } = useTranslation('account')
  const navigate = useNavigate()
  // Account-level overview never surfaces PLATFORM-scoped roles for non-platform-admins —
  // those exist only for the platform context (guest, platform-admin) and have no meaning here.
  const visibleRoles = allowPlatform ? roles : roles.filter((r) => r.scope !== 'PLATFORM')
  const visible = visibleRoles.slice(0, 6)
  return (
    <Card dataTestid="roles-section">
      <CardHeader icon={<Shield className="h-3.5 w-3.5" />} title={tAccount('overview.rolesCard.tk_title_')} meta={tAccount('overview.rolesCard.tk_meta-defined_', { count: visibleRoles.length })} />
      <div className="p-4">
        {visible.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-xs">{tAccount('overview.rolesCard.tk_no-roles_')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((r) => {
              const key = r.name?.toLowerCase()
              const isGuest = key === 'guest'
              const known = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
              const isBuiltIn = known.includes(key)
              const displayName = isBuiltIn ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : r.name
              const displayDescription = isBuiltIn ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}-description_`) : r.description
              return (
                <div data-testid="role-card" key={r.id} className="border-border bg-secondary hover:border-primary/40 flex items-start gap-2.5 rounded-sm border px-3 py-2.5 transition-colors">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm ${isGuest ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary'}`}>
                    {key?.includes('admin') ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[12px] font-bold capitalize ${isGuest ? 'text-muted-foreground' : 'text-foreground'}`}>{displayName}</div>
                    {displayDescription && <div className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">{displayDescription}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {visibleRoles.length > 0 && (
        <div className="border-border flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            data-testid="roles-view-all"
            onClick={() => navigate('/account?tab=roles')}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {tAccount('overview.rolesCard.tk_view-all-roles_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── PLATFORM-ADMIN OVERVIEW ─────────────── */

/**
 * "All accounts" view for the platform-admin. Mirrors the layout of a single-account overview
 * (KPIs · Recent users · Recent entities · Roles list) with figures rolled up across every
 * account on the platform — plus a Recent accounts list / invite-owner CTA on top.
 */
function PlatformOverview() {
  const { t: tAccount } = useTranslation('account')
  const { setCurrentScope } = useAdminScope()
  const { hasPermission } = useModuleAccess()
  const navigate = useNavigate()
  const [isInviteOwnerOpen, setIsInviteOwnerOpen] = useState(false)

  const { data: overview, isLoading: overviewLoading } = usePlatformOverview()
  // No search here — the card shows the 5 most recent ACTIVE accounts only, mirroring how
  // Recent Users / Recent Roles also show active rows only. Full search (incl. disabled
  // accounts) lives in the header switcher and the dedicated Accounts tab.
  const { data: allAccountsData, isLoading: accountsLoading } = useAllAccounts({ limit: 5, isActive: true })

  const canInviteOwner = hasPermission('ACCOUNT_INVITE_OWNER')

  if (overviewLoading || !overview) {
    return (
      <div className="space-y-4 opacity-25">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-sm" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-sm" />
        <Skeleton className="h-40 w-full rounded-sm" />
      </div>
    )
  }

  // Recent Entities is intentionally not surfaced here — entities are scoped to a single
  // account, so the platform-admin sees them by contextualizing into the relevant account.
  const { kpis, recentUsers, systemRoles } = overview
  const accounts = allAccountsData?.items ?? []

  return (
    <div>
      {/* KPI band — aggregated across every account */}
      <PlatformKpiRow kpis={kpis} />

      <div className="flex flex-col gap-4">
        {/* Recent accounts (with click-to-scope + invite-owner action) */}
        <Card dataTestid="recent-accounts-section">
          <CardHeader
            icon={<Building2 className="h-3.5 w-3.5" />}
            title={tAccount('overview.recentAccounts.tk_title_')}
            meta={tAccount('overview.recentAccounts.tk_meta-total_', { count: kpis.accountsCount })}
            rightSlot={
              canInviteOwner ? (
                <WaveButton type="button" onClick={() => setIsInviteOwnerOpen(true)} className="!h-8 !w-auto px-3.5 !text-[11px]">
                  <Mail className="h-3.5 w-3.5" />
                  {tAccount('overview.recentAccounts.tk_invite-owner_')}
                </WaveButton>
              ) : undefined
            }
          />
          <div className="divide-border divide-y">
            {accountsLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-sm" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="text-muted-foreground px-4 py-8 text-center text-xs">{tAccount('overview.recentAccounts.tk_no-accounts_')}</div>
            ) : (
              accounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setCurrentScope({ kind: 'PLATFORM', id: acc.id })}
                  className="group hover:bg-secondary w-full cursor-pointer px-4 py-3 text-left transition-colors"
                  title={tAccount('overview.recentAccounts.tk_select-account_')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="bg-primary/15 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg">
                        <Shield className="text-primary h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-foreground truncate text-sm font-semibold">{acc.name}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {acc.usersCount} users · {acc.entitiesCount} entities
                        </div>
                      </div>
                    </div>
                    {/* CTA hint — same affordance as the Roles "VIEW →" footer: muted text that
                        turns primary on hover, literal arrow character. Conveys "click to open this
                        account context" without competing with the row's other content. */}
                    <span className="text-muted-foreground/70 group-hover:text-primary text-[10px] tracking-wider whitespace-nowrap uppercase transition-colors">
                      {tAccount('overview.recentAccounts.tk_open-context_')} →
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
          {accounts.length > 0 && (
            <div className="border-border flex justify-end border-t px-4 py-2.5">
              <button
                type="button"
                data-testid="recent-accounts-view-all"
                onClick={() => navigate('/account?tab=accounts')}
                className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
              >
                {tAccount('overview.recentAccounts.tk_view-all-accounts_')} <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </Card>

        {/* Cross-account recent users — adapted from the single-account RecentUsers card */}
        <PlatformRecentUsers users={recentUsers} />

        {/* System roles catalog — visible only to platform-admins by definition */}
        <PlatformRolesCard roles={systemRoles} />
      </div>

      <InviteAccountOwnerDialog isOpen={isInviteOwnerOpen} onOpenChange={setIsInviteOwnerOpen} />
    </div>
  )
}

/* ─────────────── PLATFORM KPI ROW ─────────────── */

function PlatformKpiRow({
  kpis
}: {
  kpis: {
    usersCount: number
    entitiesCount: number
    accountsCount: number
    pendingReactivationCount: number
    pendingAccountOwnerInvitationsCount: number
    pendingInvitations: number
    pendingSignups: number
  }
}) {
  const { t: tAccount } = useTranslation('account')
  const pendingTotal = kpis.pendingInvitations + kpis.pendingSignups
  const pendingInvSub =
    pendingTotal === 0 ? tAccount('overview.kpi.tk_pending-none_') : tAccount('overview.kpi.tk_pending-breakdown_', { invitations: kpis.pendingInvitations, signups: kpis.pendingSignups })
  const pendingReacSubKey = kpis.pendingReactivationCount === 0 ? 'overview.kpi.tk_pending-reactivation-none_' : 'overview.kpi.tk_pending-reactivation-some_'
  return (
    // Order: Accounts → Pending invitations → Reactivation requests → Total users
    // Two attention-worthy actionable cards bracketed between the two stable-state cards.
    <div className="mb-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-4">
      <div className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
          <Building2 className="text-primary h-3 w-3" />
          {tAccount('overview.kpi.tk_accounts_')}
        </span>
        <div className="font-display text-3xl leading-none font-bold">{kpis.accountsCount}</div>
        <div className="text-muted-foreground text-[11px]">{tAccount('overview.kpi.tk_accounts-sub_')}</div>
      </div>
      <div className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
          <Mail className="text-primary h-3 w-3" />
          {tAccount('overview.kpi.tk_pending-invitation_')}
        </span>
        <div className={cn('font-display flex items-baseline gap-2 text-3xl leading-none font-bold', pendingTotal > 0 && 'text-amber-500')}>
          <span>{kpis.pendingInvitations}</span>
          <span className="text-muted-foreground/50 text-xl">·</span>
          <span>{kpis.pendingSignups}</span>
        </div>
        <div className="text-muted-foreground text-[11px]">{pendingInvSub}</div>
      </div>
      <div className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
          <Clock className="text-primary h-3 w-3" />
          {tAccount('overview.kpi.tk_pending-reactivation_')}
        </span>
        <div className={cn('font-display text-3xl leading-none font-bold', kpis.pendingReactivationCount > 0 && 'text-amber-500')}>{kpis.pendingReactivationCount}</div>
        <div className="text-muted-foreground text-[11px]">{tAccount(pendingReacSubKey)}</div>
      </div>
      <div className="border-border border-l-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-l-2 px-4 py-2.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
          <Users className="text-primary h-3 w-3" />
          {tAccount('overview.kpi.tk_users_')}
        </span>
        <div className="font-display text-3xl leading-none font-bold">{kpis.usersCount}</div>
        <div className="text-muted-foreground text-[11px]">{tAccount('overview.kpi.tk_users-platform-sub_')}</div>
      </div>
    </div>
  )
}

/* ─────────────── PLATFORM RECENT USERS ─────────────── */

type PlatformUser = NonNullable<ReturnType<typeof usePlatformOverview>['data']>['recentUsers'][number]
type PlatformSystemRole = NonNullable<ReturnType<typeof usePlatformOverview>['data']>['systemRoles'][number]

function PlatformRecentUsers({ users }: { users: PlatformUser[] }) {
  const { t: tAccount } = useTranslation('account')
  const navigate = useNavigate()
  return (
    <Card dataTestid="recent-users-section">
      <CardHeader icon={<Users className="h-3.5 w-3.5" />} title={tAccount('overview.recentUsers.tk_title_')} meta={tAccount('overview.recentUsers.tk_meta-most-recent_', { count: users.length })} />
      <div className="flex flex-col">
        {users.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center text-xs">{tAccount('overview.recentUsers.tk_no-users_')}</div>
        ) : (
          users.map((u) => {
            const fullName = `${u.people?.firstname ?? ''} ${u.people?.lastname ?? ''}`.trim() || u.email
            const initials = getInitials(u.people?.firstname ?? u.email[0], u.people?.lastname ?? '')
            const isDirect = u.accounts.length > 0
            const accessClass = isDirect ? 'bg-primary/22 text-primary' : 'bg-muted text-muted-foreground'
            const accountLabel = isDirect ? u.accounts[0].name : (u.entities[0]?.name ?? null)
            const primaryRoleName = u.roles[0]?.name
            const knownRoles = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
            const roleLabel = primaryRoleName
              ? knownRoles.includes(primaryRoleName.toLowerCase())
                ? tAccount(`roles.builtin.tk_${primaryRoleName.toLowerCase().replace('-', '_')}_`)
                : primaryRoleName
              : null
            return (
              <div key={u.id} className="border-border hover:bg-muted grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3.5 border-b px-4 py-3 transition-colors last:border-b-0">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold ${accessClass}`}>{initials}</div>
                <div className="min-w-0">
                  <div className="text-foreground truncate text-[13px] leading-tight font-semibold">{fullName}</div>
                  <div className="text-muted-foreground truncate text-[11px] leading-tight">{u.email}</div>
                </div>
                {accountLabel ? (
                  <span
                    className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase ${
                      isDirect ? 'border-primary/22 bg-primary/12 text-primary' : 'border-border bg-muted text-muted-foreground'
                    }`}
                    title={accountLabel}
                  >
                    {accountLabel}
                  </span>
                ) : (
                  <span />
                )}
                {/* Role chip — same visual language as the role tags on user cards (border + tinted bg
                    + scope icon) so the user immediately reads "this is a role" rather than free text. */}
                {roleLabel ? (
                  <span
                    className="border-border bg-secondary text-foreground/80 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase"
                    title={tAccount('overview.recentUsers.tk_role-tooltip_', { role: roleLabel })}
                  >
                    <Shield className="h-2.5 w-2.5" />
                    {roleLabel}
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground text-[11px] whitespace-nowrap tabular-nums">{formatDateShort(u.createdAt, { withYear: false })}</span>
              </div>
            )
          })
        )}
      </div>
      {users.length > 0 && (
        <div className="border-border flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            data-testid="platform-recent-users-view-all"
            onClick={() => navigate('/account?tab=users')}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {tAccount('overview.recentUsers.tk_view-all-users_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── PLATFORM ROLES CARD ─────────────── */

function PlatformRolesCard({ roles }: { roles: PlatformSystemRole[] }) {
  const { t: tAccount } = useTranslation('account')
  const navigate = useNavigate()
  const visible = roles.slice(0, 6)
  return (
    <Card dataTestid="platform-roles-section">
      <CardHeader icon={<Shield className="h-3.5 w-3.5" />} title={tAccount('overview.rolesCard.tk_title_')} meta={tAccount('overview.rolesCard.tk_meta-defined_', { count: roles.length })} />
      <div className="p-4">
        {visible.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-xs">{tAccount('overview.rolesCard.tk_no-roles_')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((r) => {
              const key = r.name.toLowerCase()
              const isGuest = key === 'guest'
              const known = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
              const displayName = known.includes(key) ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : r.name
              const displayDescription = known.includes(key) ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}-description_`) : r.description
              return (
                <div key={r.id} className="border-border bg-secondary hover:border-primary/40 flex items-start gap-2.5 rounded-sm border px-3 py-2.5 transition-colors">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm ${isGuest ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary'}`}>
                    {key.includes('admin') ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className={`text-[12px] font-bold capitalize ${isGuest ? 'text-muted-foreground' : 'text-foreground'}`}>{displayName}</div>
                      <span className="border-primary/25 bg-primary/10 text-primary rounded-[2px] border px-1 py-0 text-[9px] font-bold tracking-wider uppercase">{r.scope}</span>
                    </div>
                    {displayDescription && <div className="text-foreground/80 mt-0.5 line-clamp-2 text-xs leading-snug">{displayDescription}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {roles.length > 0 && (
        <div className="border-border flex justify-end border-t px-4 py-2.5">
          <button
            type="button"
            data-testid="platform-roles-view-all"
            onClick={() => navigate('/account?tab=roles')}
            className="text-primary hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold tracking-wider uppercase transition-colors"
          >
            {tAccount('overview.rolesCard.tk_view-all-roles_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── MAIN ─────────────── */

export function AccountOverview() {
  // ALL hooks must be called unconditionally — branching on render comes AFTER, otherwise React
  // panics with "Rendered more hooks than during the previous render" when the user switches
  // scope from a specific account to "All accounts" (or back).
  const queryClient = useQueryClient()
  const { submit: signOut } = useSignOut()
  const { isAccountAdmin, isPlatformAdmin, isEntityAdmin, currentScope, managedEntities, activeEntity } = useAdminScope()
  const { hasPermission } = useModuleAccess()
  const { t: tAccount } = useTranslation('account')
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isCreateEntityOpen, setIsCreateEntityOpen] = useState(false)

  const isPlatformAll = isPlatformAdmin && currentScope.kind === 'PLATFORM' && !currentScope.id

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])
  const accountIdFromScope = currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : null
  const activeAccount = authMe?.accounts.find((a) => a.isActive)
  const accountId = accountIdFromScope ?? activeAccount?.id ?? authMe?.entities.find((e) => e.isActive)?.accountId ?? null

  // useAccount is internally guarded by `enabled: !!accountId` so this is safe even when accountId is null.
  const { data: account, isLoading, error } = useAccount(accountId ?? '')

  // Entity-admin (no account-admin / no platform-admin) only sees the slice of the account that
  // belongs to the *active* entity (the one currently selected in the scope switcher): users
  // linked to it, only the active entity in the recent-entities card, and ENTITY-scoped roles.
  // The account payload from the API is the full picture — filter on the client.
  const isEntityScopedView = isEntityAdmin && !isAccountAdmin && !isPlatformAdmin
  const activeEntityId = activeEntity?.id ?? null

  const scopedUsers = useMemo(() => {
    if (!account) return []
    if (!isEntityScopedView || !activeEntityId) return account.users.values
    return account.users.values.filter((u) => u.entities?.some((e) => e.id === activeEntityId))
  }, [account, isEntityScopedView, activeEntityId])

  const recentUsers = useMemo(() => scopedUsers.slice(0, 5), [scopedUsers])
  // Entity-admins see only the currently-scoped entity as a "you're here" context indicator.
  // Account/platform admins still see the most recent N.
  const recentEntities = useMemo(() => {
    const raw = account?.entities.values ?? []
    const scoped = isEntityScopedView && activeEntityId ? raw.filter((e) => e.id === activeEntityId) : raw
    return scoped.slice(0, 5)
  }, [account, isEntityScopedView, activeEntityId])
  const roles = useMemo(() => {
    const raw = account?.roles.values ?? []
    if (!isEntityScopedView) return raw
    return raw.filter((r) => r.scope === 'ENTITY')
  }, [account, isEntityScopedView])

  const canInvite = hasPermission('USER_ACCOUNTS_INVITATION') || hasPermission('USER_ENTITIES_INVITATION')
  const canCreateEntity = isAccountAdmin && hasPermission('ENTITY_CREATION')

  // Render branches — past this line, no hooks below.
  if (isPlatformAll) return <PlatformOverview />

  if (!accountId) {
    signOut()
    return null
  }

  if (isLoading) {
    return (
      <div className="space-y-4 opacity-25">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="skeleton-shimmer-orange h-24 w-full rounded-sm" />
          ))}
        </div>
        <Skeleton className="skeleton-shimmer-orange h-72 w-full rounded-sm" />
        <Skeleton className="skeleton-shimmer-orange h-40 w-full rounded-sm" />
        <Skeleton className="skeleton-shimmer-orange h-40 w-full rounded-sm" />
      </div>
    )
  }
  if (error) return <div className="text-destructive">{tAccount('tk_failed-load_')}</div>
  if (!account) return null

  return (
    <div>
      <KpiRow
        account={account}
        pendingInvitations={account.pendingInvitations}
        pendingSignups={account.pendingSignups}
        scopedUsers={scopedUsers}
        scopedEntitiesCount={isEntityScopedView && activeEntityId ? 1 : managedEntities.length}
        isEntityScoped={isEntityScopedView}
      />

      <div className="flex flex-col gap-4">
        <RecentUsers users={recentUsers} onInvite={() => setIsInviteOpen(true)} canInvite={canInvite} />
        <RecentEntities entities={recentEntities} onCreate={() => setIsCreateEntityOpen(true)} canCreate={canCreateEntity} />
        <RolesCard roles={roles} allowPlatform={isPlatformAdmin} />
      </div>

      <InviteUserDialog isOpen={isInviteOpen} onOpenChange={setIsInviteOpen} />
      <CreateEntityDialog isOpen={isCreateEntityOpen} onOpenChange={setIsCreateEntityOpen} />
    </div>
  )
}
