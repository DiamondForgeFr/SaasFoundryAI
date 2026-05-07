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
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useDebounce } from '@/hooks/ui/useDebounce'

/**
 * Components
 */
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { KpiCard } from '@/components/ui/custom/kpi-card'
import { SegmentedFilter, type SegmentedOption } from '@/components/ui/custom/segmented-filter'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Input } from '@/components/ui/shadcn/input'
import { Skeleton } from '@/components/ui/shadcn/skeleton'

import { formatDateShort } from '@/utils/format'

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

/* ─────────────── ENTITY ROW ─────────────── */

function EntityRowItem({ entity }: { entity: EntityRow }) {
  const { t: tAccount } = useTranslation('account')
  const orgType = entity.organization?.type ?? null
  const Icon = (orgType && ORG_TYPE_ICON[orgType]) || Building2
  const showSubName = entity.organization && entity.name !== entity.organization.name
  return (
    <div data-testid="entity-row" className="grid grid-cols-[auto_1fr_120px_120px_120px] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
      <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted border border-border text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground leading-tight truncate">{entity.organization?.name || entity.name}</div>
        {showSubName && <div className="text-[11px] text-muted-foreground leading-tight truncate">{entity.name}</div>}
      </div>
      {orgType ? (
        <span className="inline-flex items-center w-fit px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-muted text-muted-foreground whitespace-nowrap">
          {orgType.toLowerCase()}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">—</span>
      )}
      <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap">
        <span className={`h-1.5 w-1.5 rounded-full ${entity.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`} />
        <span className={entity.isActive ? 'text-foreground' : 'text-muted-foreground'}>
          {entity.isActive ? tAccount('entities.table.tk_status-active_') : tAccount('entities.table.tk_status-disabled_')}
        </span>
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{formatDateShort(entity.createdAt)}</span>
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
  const { t: tAccount } = useTranslation('account')
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const accountId = activeAccount?.id

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
  const isFiltered = debouncedSearch.length > 0 || status !== 'all'

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

      <div data-testid="entities-table" className="rounded-sm border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_120px_120px_120px] gap-3.5 px-4 py-2.5 border-b border-border bg-muted/40">
          <span className="w-8" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('entities.table.tk_entity_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('entities.table.tk_type_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('entities.table.tk_status_')}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('entities.table.tk_created_')}</span>
        </div>
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_120px_120px_120px] items-center gap-3.5 px-4 py-3 border-b border-border last:border-b-0">
                <Skeleton className="skeleton-shimmer-orange h-8 w-8 rounded-sm" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-3/4" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-20" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-16" />
                <Skeleton className="skeleton-shimmer-orange h-4 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-muted-foreground">
            <Building2 className="h-4 w-4 opacity-40" />
            {isFiltered ? tAccount('entities.tk_no-results-filtered_') : tAccount('entities.tk_no-entities-yet_')}
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((e) => (
              <EntityRowItem key={e.id} entity={e} />
            ))}
          </div>
        )}
        <MiniPagination page={currentPage} totalPages={totalPages} onPage={setCurrentPage} />
      </div>

      {canCreate && isCreateDialogOpen && <CreateEntityDialog isOpen={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />}
    </div>
  )
}
