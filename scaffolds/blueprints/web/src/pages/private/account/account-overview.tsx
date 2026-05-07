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
import { useInvitedUsers } from '@/hooks/api/invitations/queries/useInvitedUsers'
import { useSignOut } from '@/hooks/api/auth'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { InviteUserDialog } from '@/components/dialogs/invite-user-dialog'
import { formatDateShort, getInitials } from '@/utils/format'

/**
 * Components
 */
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

function KpiRow({ account, pendingCount }: { account: AccountResponseDto; pendingCount: number }) {
  const { t: tAccount } = useTranslation('account')
  const accountLinkedCount = useMemo(() => account.users.values.filter((u) => u.isDirectlyLinked).length, [account])
  const entityOnlyCount = account.users.count - accountLinkedCount
  const pendingSubKey = pendingCount === 0 ? 'overview.kpi.tk_pending-none_' : pendingCount === 1 ? 'overview.kpi.tk_pending-one_' : 'overview.kpi.tk_pending-many_'

  return (
    <div data-testid="overview-kpis" className="grid gap-3 mb-6 grid-cols-1 sm:grid-cols-3 items-stretch">
      {/* Users KPI */}
      <div data-testid="kpi-users" className="flex flex-col gap-1.5 justify-between rounded-sm border border-border border-t-2 border-t-primary bg-card px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3 w-3 text-primary" />
            {tAccount('overview.kpi.tk_users_')}
          </span>
        </div>
        <div className="font-display text-3xl font-bold leading-none">{account.users.count}</div>
        <div className="text-[11px] text-muted-foreground">{tAccount('overview.kpi.tk_users-sub_', { accountLinked: accountLinkedCount, entityLinked: entityOnlyCount })}</div>
      </div>

      {/* Entities KPI */}
      <div data-testid="kpi-entities" className="flex flex-col gap-1.5 justify-between rounded-sm border border-border border-t-2 border-t-primary bg-card px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Building2 className="h-3 w-3 text-primary" />
            {tAccount('overview.kpi.tk_entities_')}
          </span>
        </div>
        <div className="font-display text-3xl font-bold leading-none">{account.entities.count}</div>
        <div className="text-[11px] text-muted-foreground">{tAccount('overview.kpi.tk_entities-sub_', { active: account.entities.count, disabled: 0 })}</div>
      </div>

      {/* Pending KPI */}
      <div data-testid="kpi-pending" className="flex flex-col gap-1.5 justify-between rounded-sm border border-border border-t-2 border-t-primary bg-card px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3 w-3 text-primary" />
            {tAccount('overview.kpi.tk_pending_')}
          </span>
          {pendingCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_6px] shadow-amber-500 animate-pulse" />}
        </div>
        <div className="font-display text-3xl font-bold leading-none">{pendingCount}</div>
        <div className="text-[11px] text-muted-foreground">{tAccount(pendingSubKey)}</div>
      </div>
    </div>
  )
}

/* ─────────────── CARD ─────────────── */

function Card({ children, dataTestid }: { children: React.ReactNode; dataTestid?: string }) {
  return (
    <div data-testid={dataTestid} className="rounded-sm border border-border bg-card overflow-hidden">
      {children}
    </div>
  )
}

function CardHeader({ icon, title, meta, action, onAction, rightSlot }: { icon: React.ReactNode; title: string; meta?: string; action?: string; onAction?: () => void; rightSlot?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <span className="font-display text-[13px] font-bold text-foreground">{title}</span>
        {meta && <span className="text-[11px] text-muted-foreground font-medium">{meta}</span>}
      </div>
      <div className="flex items-center gap-3">
        {rightSlot}
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-foreground transition-colors"
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
            <WaveButton type="button" onClick={onInvite} className="!h-8 !w-auto !text-[11px] px-3.5">
              <Mail className="h-3.5 w-3.5" />
              {tAccount('overview.recentUsers.tk_invite-cta_')}
            </WaveButton>
          ) : undefined
        }
      />
      <div className="flex flex-col">
        {users.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">{tAccount('overview.recentUsers.tk_no-users_')}</div>
        ) : (
          users.slice(0, 5).map((u) => {
            const fullName = `${u.people?.firstname ?? ''} ${u.people?.lastname ?? ''}`.trim() || u.email
            const initials = getInitials(u.people?.firstname ?? u.email[0], u.people?.lastname ?? '')
            const accessClass = u.isDirectlyLinked ? 'bg-primary/22 text-primary' : 'bg-muted text-muted-foreground'
            return (
              <div
                data-testid="recent-user-row"
                key={u.id}
                className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${accessClass}`}>{initials}</div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground leading-tight truncate">{fullName}</div>
                  <div className="text-[11px] text-muted-foreground leading-tight truncate">{u.email}</div>
                </div>
                {u.isDirectlyLinked ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-primary/22 bg-primary/12 text-primary whitespace-nowrap">
                    {tAccount('users.table.tk_access-account_')}
                  </span>
                ) : u.entities && u.entities.length > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground whitespace-nowrap">
                    {u.entities[0].name}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {(() => {
                    const r = u.roles?.[0]?.name
                    if (!r) return '—'
                    const k = r.toLowerCase()
                    return k === 'guest' || k === 'user' || k === 'admin' ? tAccount(`roles.builtin.tk_${k}_`) : r
                  })()}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{formatDateShort(u.createdAt, { withYear: false })}</span>
              </div>
            )
          })
        )}
      </div>
      {users.length > 0 && (
        <div className="flex justify-end border-t border-border px-4 py-2.5">
          <button
            type="button"
            data-testid="recent-users-view-all"
            onClick={() => navigate('/account?tab=users')}
            className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-foreground transition-colors"
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
            <WaveButton type="button" onClick={onCreate} className="!h-8 !w-auto !text-[11px] px-3.5">
              <Plus className="h-3.5 w-3.5" />
              {tAccount('overview.recentEntities.tk_create-cta_')}
            </WaveButton>
          ) : undefined
        }
      />
      <div className="flex flex-col">
        {entities.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">{tAccount('overview.recentEntities.tk_no-entities-yet_')}</div>
        ) : (
          entities.slice(0, 5).map((e) => (
            <div data-testid="recent-entity-row" key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
              <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-muted border border-border text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-foreground leading-tight truncate">{e.name}</div>
                {e.organization?.name && <div className="text-[11px] text-muted-foreground leading-tight truncate">{e.organization.name}</div>}
              </div>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground whitespace-nowrap">
                {(e.organization as { type?: string } | null)?.type ?? '—'}
              </span>
            </div>
          ))
        )}
      </div>
      {entities.length > 0 && (
        <div className="flex justify-end border-t border-border px-4 py-2.5">
          <button
            type="button"
            data-testid="recent-entities-view-all"
            onClick={() => navigate('/account?tab=entities')}
            className="cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-foreground transition-colors"
          >
            {tAccount('overview.recentEntities.tk_view-all-entities_')} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </Card>
  )
}

/* ─────────────── ROLES ─────────────── */

function RolesCard({ roles }: { roles: RoleDto[] }) {
  const { t: tAccount } = useTranslation('account')
  const visible = roles.slice(0, 6)
  return (
    <Card dataTestid="roles-section">
      <CardHeader icon={<Shield className="h-3.5 w-3.5" />} title={tAccount('overview.rolesCard.tk_title_')} meta={tAccount('overview.rolesCard.tk_meta-defined_', { count: roles.length })} />
      <div className="p-4">
        {roles.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">{tAccount('overview.rolesCard.tk_no-roles_')}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((r) => {
              const key = r.name?.toLowerCase()
              const isGuest = key === 'guest'
              const isBuiltIn = key === 'guest' || key === 'user' || key === 'admin'
              const displayName = isBuiltIn ? tAccount(`roles.builtin.tk_${key}_`) : r.name
              const displayDescription = isBuiltIn ? tAccount(`roles.builtin.tk_${key}-description_`) : r.description
              return (
                <div data-testid="role-card" key={r.id} className="flex items-start gap-2.5 rounded-sm border border-border bg-secondary px-3 py-2.5 hover:border-primary/40 transition-colors">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm ${isGuest ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary'}`}>
                    {key?.includes('admin') ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[12px] font-bold capitalize ${isGuest ? 'text-muted-foreground' : 'text-foreground'}`}>{displayName}</div>
                    {displayDescription && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{displayDescription}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

/* ─────────────── MAIN ─────────────── */

export function AccountOverview() {
  const queryClient = useQueryClient()
  const { submit: signOut } = useSignOut()
  const { isAccountAdmin } = useAdminScope()
  const { hasPermission } = useModuleAccess()
  const { t: tAccount } = useTranslation('account')
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isCreateEntityOpen, setIsCreateEntityOpen] = useState(false)

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((a) => a.isActive)
  const accountId = activeAccount?.id ?? authMe.entities.find((e) => e.isActive)?.accountId

  const { data: account, isLoading, error } = useAccount(accountId as string)
  const { data: invitationsData } = useInvitedUsers()
  const pendingCount = useMemo(() => invitationsData?.invitations?.filter((i) => i.status === 'SENT').length ?? 0, [invitationsData])

  const recentUsers = useMemo(() => account?.users.values.slice(0, 5) ?? [], [account])
  const recentEntities = useMemo(() => account?.entities.values.slice(0, 5) ?? [], [account])
  const roles = useMemo(() => account?.roles.values ?? [], [account])

  const canInvite = hasPermission('USER_ACCOUNTS_INVITATION') || hasPermission('USER_ENTITIES_INVITATION')
  const canCreateEntity = isAccountAdmin && hasPermission('ENTITY_CREATION')

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
      <KpiRow account={account} pendingCount={pendingCount} />

      <div className="flex flex-col gap-4">
        <RecentUsers users={recentUsers} onInvite={() => setIsInviteOpen(true)} canInvite={canInvite} />
        <RecentEntities entities={recentEntities} onCreate={() => setIsCreateEntityOpen(true)} canCreate={canCreateEntity} />
        <RolesCard roles={roles} />
      </div>

      <InviteUserDialog isOpen={isInviteOpen} onOpenChange={setIsInviteOpen} />
      <CreateEntityDialog isOpen={isCreateEntityOpen} onOpenChange={setIsCreateEntityOpen} />
    </div>
  )
}
