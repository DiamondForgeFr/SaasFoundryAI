/**
 * Resources
 */
import { useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, Globe, Plus, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useAccount } from '@/hooks/api/accounts'
import { EntityOrderBy, useAccountEntities } from '@/hooks/api/accounts/queries/useAccountEntities'
import { useEntityUpdate } from '@/hooks/api/entities/mutations/useEntityUpdate'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useDebounce } from '@/hooks/ui/useDebounce'

/**
 * Components
 */
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { EditEntityDialog, type EditEntityTarget } from '@/components/dialogs/edit-entity-dialog'
import { KpiCard } from '@/components/ui/custom/kpi-card'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Input } from '@/components/ui/shadcn/input'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Switch } from '@/components/ui/shadcn/switch'

/**
 * Types
 */
import type { AccountEntitiesResponseDto } from '@/hooks/api/accounts/queries/useAccountEntities'
import type { MeResponseDto } from '@/hooks/api/auth'

type EntityRow = AccountEntitiesResponseDto['items'][number]
type StatusFilter = 'all' | 'active' | 'disabled'

const ORG_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  COMPANY: Building2,
  ASSOCIATION: Users,
  COMMUNITY: Globe
}

/* ─────────────── KPI ROW ─────────────── */

function KpiRow({ total, active, disabled }: { total: number; active: number; disabled: number }) {
  const { t: tAccount } = useTranslation('account')
  const activePct = total === 0 ? 0 : Math.round((active / total) * 100)
  return (
    <div className="mb-6 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
      <KpiCard icon={<Building2 className="text-primary h-3 w-3" />} label={tAccount('entities.kpi.tk_total_')} value={total} sub={tAccount('entities.kpi.tk_total-sub_', { active, disabled })} />
      <KpiCard
        icon={<Building2 className="text-primary h-3 w-3" />}
        label={tAccount('entities.kpi.tk_active_')}
        value={active}
        sub={total === 0 ? tAccount('entities.kpi.tk_active-sub-empty_') : tAccount('entities.kpi.tk_active-sub_', { percent: activePct })}
      />
      <KpiCard
        icon={<Building2 className="text-primary h-3 w-3" />}
        label={tAccount('entities.kpi.tk_disabled_')}
        value={disabled}
        sub={disabled === 0 ? tAccount('entities.kpi.tk_disabled-sub-none_') : tAccount('entities.kpi.tk_disabled-sub-some_')}
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
  onCreate,
  canCreate
}: {
  search: string
  onSearch: (v: string) => void
  status: StatusFilter
  onStatus: (v: StatusFilter) => void
  onCreate: () => void
  canCreate: boolean
}) {
  const { t: tAccount } = useTranslation('account')
  const statusOptions: readonly SegmentedOption<StatusFilter>[] = [
    { value: 'all', label: tAccount('entities.filters.tk_status-all_') },
    { value: 'active', label: tAccount('entities.filters.tk_status-active_') },
    { value: 'disabled', label: tAccount('entities.filters.tk_status-disabled_') }
  ]
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative flex-1 min-w-[260px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input type="text" data-testid="search-filter" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={tAccount('entities.filters.tk_search-placeholder_')} className="pl-9" />
      </div>
      <SegmentedFilter value={status} onChange={onStatus} options={statusOptions} />
      {canCreate && (
        <WaveButton type="button" onClick={onCreate} className="!h-9 !w-auto !text-[11px] px-3.5">
          <Plus className="h-3.5 w-3.5" />
          {tAccount('entities.tk_create-entity_')}
        </WaveButton>
      )}
    </div>
  )
}

/* ─────────────── ENTITY CARD ─────────────── */

function EntityCard({
  entity,
  onEdit,
  canEdit,
  canToggle,
  isToggling,
  onToggle
}: {
  entity: EntityRow
  onEdit: (e: EntityRow) => void
  canEdit: boolean
  canToggle: boolean
  isToggling: boolean
  onToggle: (next: boolean) => void
}) {
  const { t: tAccount } = useTranslation('account')
  const orgType = entity.organization?.type ?? null
  const Icon = (orgType && ORG_TYPE_ICON[orgType]) || Building2
  const logoUrl = entity.organization?.logoUrl ?? null
  const showSubName = entity.organization && entity.name !== entity.organization.name
  const handleClick = () => canEdit && onEdit(entity)
  const dimmed = !entity.isActive

  return (
    <div
      data-testid="entity-row"
      role={canEdit ? 'button' : undefined}
      onClick={handleClick}
      className={cn(
        'group rounded-sm border bg-card p-4 transition-all',
        'hover:border-primary/40 hover:shadow-[0_0_0_1px_var(--primary)/15]',
        dimmed ? 'border-border/60 bg-muted/30' : 'border-border',
        canEdit && 'cursor-pointer'
      )}
      title={canEdit ? tAccount('entities.tk_edit-title_') : undefined}
    >
      {/* Top row: logo (or org-type icon) + name + type badge + status switch */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted text-muted-foreground', dimmed && 'opacity-60')}>
          {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className={cn('font-bold text-sm truncate flex-1 min-w-0', dimmed ? 'text-muted-foreground' : 'text-foreground')}>{entity.organization?.name || entity.name}</span>
            {orgType && (
              <span
                className={cn(
                  'flex-shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border-border bg-muted text-muted-foreground',
                  dimmed && 'opacity-70'
                )}
              >
                {orgType.toLowerCase()}
              </span>
            )}
            {/* Status switch — same affordance as role/account cards. Falls back to a display-only
                pill when the actor cannot toggle this entity (no ACCOUNT_ENTITY_MANAGEMENT). */}
            {canToggle ? (
              <label
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none transition-colors',
                  entity.isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                  isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                )}
              >
                <Switch
                  checked={entity.isActive}
                  disabled={isToggling}
                  onCheckedChange={onToggle}
                  className={cn(
                    '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                    entity.isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                  )}
                />
                <span>{tAccount(entity.isActive ? 'entities.table.tk_status-active_' : 'entities.table.tk_status-disabled_')}</span>
              </label>
            ) : (
              <span
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                  entity.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', entity.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                {tAccount(entity.isActive ? 'entities.table.tk_status-active_' : 'entities.table.tk_status-disabled_')}
              </span>
            )}
          </div>
          {showSubName && <div className={cn('text-[11px] leading-tight truncate mt-0.5', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')}>{entity.name}</div>}
          {entity.description && <div className={cn('text-[12px] mt-1 line-clamp-2 leading-snug', dimmed ? 'text-muted-foreground/70' : 'text-foreground/80')}>{entity.description}</div>}
        </div>
      </div>

      {/* Footer: user count (left) + EDIT cta (right) — same shape as role cards */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border/60 text-[11px]">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium text-foreground tabular-nums">{entity.userCount}</span>
          <span className="text-muted-foreground">{tAccount('entities.tk_users-short_')}</span>
        </span>
        {canEdit && <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-primary transition-colors">{tAccount('entities.tk_edit-cta_')} →</span>}
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

export function AccountEntities() {
  const queryClient = useQueryClient()
  const { hasPermission } = useModuleAccess()
  const { currentScope } = useAdminScope()
  const { t: tAccount } = useTranslation('account')
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EditEntityTarget | null>(null)

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])
  const accountIdFromScope = currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : null
  const activeAccount = authMe?.accounts.find((acc) => acc.isActive)
  const accountId = accountIdFromScope ?? activeAccount?.id ?? authMe?.entities.find((e) => e.isActive)?.accountId

  const isActive = status === 'all' ? undefined : status === 'active'

  const { data: account } = useAccount(accountId as string)
  const { data: entitiesData, isLoading } = useAccountEntities(accountId as string, {
    search: debouncedSearch,
    isActive,
    orderBy: EntityOrderBy.CREATED_AT,
    page: currentPage,
    limit: pageSize
  })

  const items = entitiesData?.items ?? []
  const totalItems = entitiesData?.meta.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  const { totalAll, activeAll, disabledAll } = useMemo(() => {
    const values = account?.entities.values ?? []
    const activeCount = values.filter((e) => e.isActive).length
    return {
      totalAll: account?.entities.count ?? 0,
      activeAll: activeCount,
      disabledAll: (account?.entities.count ?? 0) - activeCount
    }
  }, [account])

  const canCreate = hasPermission('ENTITY_CREATION')
  const canEdit = hasPermission('ACCOUNT_ENTITY_MANAGEMENT')
  const isFiltered = debouncedSearch.length > 0 || status !== 'all'

  const entityUpdateMutation = useEntityUpdate()
  // Track WHICH entity is being toggled so only that switch shows the wait state.
  const [togglingEntityId, setTogglingEntityId] = useState<string | null>(null)
  const handleToggleEntity = async (entity: EntityRow, next: boolean) => {
    if (!accountId) return
    setTogglingEntityId(entity.id)
    try {
      await entityUpdateMutation.mutateAsync({ entityId: entity.id, accountId, isActive: next })
    } catch (e) {
      console.error('Failed to toggle entity status', e)
    } finally {
      setTogglingEntityId(null)
    }
  }

  const handleEdit = (entity: EntityRow) => {
    if (!accountId) return
    setEditTarget({
      id: entity.id,
      accountId,
      name: entity.name,
      description: entity.description,
      isActive: entity.isActive,
      organization: entity.organization
        ? {
            id: entity.organization.id,
            name: entity.organization.name,
            type: entity.organization.type as 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY',
            description: entity.organization.description ?? null,
            website: entity.organization.website ?? null,
            logoUrl: entity.organization.logoUrl ?? null
          }
        : null
    })
  }

  const handleSearch = (v: string) => {
    setSearchInput(v)
    setCurrentPage(1)
  }
  const handleStatus = (v: StatusFilter) => {
    setStatus(v)
    setCurrentPage(1)
  }

  return (
    <div>
      <KpiRow total={totalAll} active={activeAll} disabled={disabledAll} />

      <FilterBar search={searchInput} onSearch={handleSearch} status={status} onStatus={handleStatus} onCreate={() => setIsCreateDialogOpen(true)} canCreate={canCreate} />

      <div data-testid="entities-table">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="skeleton-shimmer-orange h-32 w-full rounded-sm" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border bg-card p-10 flex flex-col items-center justify-center gap-2 text-center">
            <Building2 className="h-5 w-5 text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground">{isFiltered ? tAccount('entities.tk_no-results-filtered_') : tAccount('entities.tk_no-entities-yet_')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {items.map((e) => (
              <EntityCard key={e.id} entity={e} onEdit={handleEdit} canEdit={canEdit} canToggle={canEdit} isToggling={togglingEntityId === e.id} onToggle={(next) => handleToggleEntity(e, next)} />
            ))}
          </div>
        )}
        <div className="mt-3">
          <MiniPagination page={currentPage} totalPages={totalPages} onPage={setCurrentPage} />
        </div>
      </div>

      {canCreate && isCreateDialogOpen && <CreateEntityDialog isOpen={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />}
      <EditEntityDialog isOpen={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)} entity={editTarget} />
    </div>
  )
}
