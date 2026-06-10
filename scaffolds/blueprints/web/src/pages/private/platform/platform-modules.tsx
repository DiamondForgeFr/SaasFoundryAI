/**
 * Resources
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { usePlatformModules, useTogglePlatformModule, useToggleSubModule, type PlatformModule, type PlatformModulePermission } from '@/hooks/api/platform/usePlatformModules'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'
import { Boxes, Building2, ChevronDown, FileText, Globe, Layers, Lock, Search, Shield, ShieldCheck, User, UserCircle, Users } from 'lucide-react'
import { cn } from '@/utils/ui'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Input } from '@/components/ui/shadcn/input'
import { Switch } from '@/components/ui/shadcn/switch'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet'
import { KpiFilterCard } from '@/components/ui/custom/kpi-filter-card'
import { MultiSelectFilter, type MultiSelectFilterItem } from '@/components/ui/custom/multiselect-filter'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'

import { formatDateShort } from '@/utils/format'

import type { RoleScope } from '@/hooks/api/auth'

const scopeBadgeStyles: Record<RoleScope, string> = {
  PLATFORM: 'bg-primary/15 text-primary border-primary/25',
  ACCOUNT: 'bg-primary/10 text-primary border-primary/20',
  ENTITY: 'bg-amber-500/15 text-amber-500 border-amber-500/25'
}

/**
 * Visual identity per module type — keeps the catalog scannable when many types live side by side.
 * Falls back to Layers/primary when a custom type is added by a future module.
 */
const TYPE_VISUAL: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string; ring: string; label?: string }> = {
  USER_MANAGEMENT: { icon: UserCircle, tone: 'text-sky-500', ring: 'border-sky-500/25 bg-sky-500/10' },
  PROFILE_MANAGEMENT: { icon: User, tone: 'text-fuchsia-500', ring: 'border-fuchsia-500/25 bg-fuchsia-500/10' },
  ACCOUNT_MANAGEMENT: { icon: Shield, tone: 'text-primary', ring: 'border-primary/30 bg-primary/10' },
  PLATFORM_MANAGEMENT: { icon: Globe, tone: 'text-rose-500', ring: 'border-rose-500/25 bg-rose-500/10' },
  ORGANIZATION_MANAGEMENT: { icon: Building2, tone: 'text-emerald-500', ring: 'border-emerald-500/25 bg-emerald-500/10' }
}

const fallbackVisual = { icon: Layers, tone: 'text-primary', ring: 'border-primary/30 bg-primary/10' }

function visualOf(typeName: string) {
  return TYPE_VISUAL[typeName] ?? fallbackVisual
}

function prettifyTypeName(typeName: string) {
  return typeName
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/(^|\s)\w/g, (m) => m.toUpperCase())
}

/* ─────────────── KPI FILTER ROW ─────────────── */

/**
 * KPIs double as the status filter: clicking a card narrows the grid below. Same affordance as
 * every other KPI-as-filter row on the platform (account-roles, account-users, …) — mustard accent
 * when active, muted otherwise.
 */
function KpiFilterRow({
  total,
  active,
  totalPermissions,
  value,
  onChange
}: {
  total: number
  active: number
  totalPermissions: number
  value: 'ALL' | 'ACTIVE' | 'INACTIVE'
  onChange: (next: 'ALL' | 'ACTIVE' | 'INACTIVE') => void
}) {
  const { t: tPlatform } = useTranslation('platform')
  const inactive = total - active
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      <KpiFilterCard
        active={value === 'ALL'}
        onClick={() => onChange('ALL')}
        icon={Layers}
        label={tPlatform('modules.kpi.tk_total_')}
        value={total}
        sub={tPlatform('modules.kpi.tk_total-sub_', { permissions: totalPermissions })}
      />
      <KpiFilterCard
        active={value === 'ACTIVE'}
        onClick={() => onChange('ACTIVE')}
        icon={ShieldCheck}
        label={tPlatform('modules.kpi.tk_active_')}
        value={active}
        sub={
          // Multi-section progress bar — one segment per module, filled when active. Spans the
          // whole card width so the active/inactive split is readable at a glance.
          <div className="flex w-full gap-0.5">
            {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-sm',
                  i < active ? (value === 'ACTIVE' ? 'bg-accent-foreground/80' : 'bg-emerald-500') : value === 'ACTIVE' ? 'bg-accent-foreground/20' : 'bg-muted'
                )}
              />
            ))}
          </div>
        }
        tone="emerald"
      />
      <KpiFilterCard
        active={value === 'INACTIVE'}
        onClick={() => onChange('INACTIVE')}
        icon={ShieldCheck}
        label={tPlatform('modules.kpi.tk_inactive_')}
        value={inactive}
        sub={inactive === 0 ? tPlatform('modules.kpi.tk_inactive-none_') : tPlatform('modules.kpi.tk_inactive-some_')}
        tone="muted"
      />
    </div>
  )
}

/* ─────────────── MODULE CARD ─────────────── */

/**
 * Modules whose deactivation would lock the platform-admin out of this very page.
 * The backend enforces the same rule — this is just the UX hint.
 */
const LOCKED_MODULES = new Set<string>(['PLATFORM_ADMINISTRATION'])

function ModuleCard({ mod, onOpen, onToggle, busy, canToggle }: { mod: PlatformModule; onOpen: () => void; onToggle: (next: boolean) => void; busy: boolean; canToggle: boolean }) {
  const { t: tPlatform } = useTranslation('platform')
  const visual = visualOf(mod.typeName)
  const Icon = visual.icon
  const isActive = mod.isActive
  const isLocked = LOCKED_MODULES.has(mod.name)

  return (
    <div
      role="button"
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-sm border bg-card p-4 transition-all',
        'hover:border-primary/40 hover:shadow-[0_0_0_1px_var(--primary)/15]',
        isActive ? 'border-border' : 'border-dashed border-border/60 opacity-90'
      )}
    >
      {/* Top row: icon + name + version + status-switch pill (same affordance as role/account cards) */}
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border', visual.ring, !isActive && 'opacity-60')}>
          <Icon className={cn('h-4 w-4', visual.tone)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="font-mono text-[12.5px] font-bold text-foreground truncate flex-1 min-w-0">{mod.name}</span>
            <span className="flex-shrink-0 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">v{mod.version}</span>
            {/* Status switch — locked modules degrade to a display-only pill (disabling them would
                self-lockout the platform admin from this very page). */}
            {isLocked ? (
              <span
                className="flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-muted-foreground"
                title={tPlatform('modules.tk_locked-tooltip_')}
              >
                <Lock className="h-2.5 w-2.5" />
                {tPlatform('modules.tk_locked_')}
              </span>
            ) : !canToggle ? (
              // Read-only actor (no MODULE_MANAGEMENT): browse the catalog but no toggle affordance.
              <span
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                  isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                {isActive ? tPlatform('modules.tk_active_') : tPlatform('modules.tk_inactive_')}
              </span>
            ) : (
              <label
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none transition-colors',
                  isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                    : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                  busy ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                )}
              >
                <Switch
                  checked={isActive}
                  disabled={busy}
                  onCheckedChange={onToggle}
                  className={cn(
                    '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                    isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                  )}
                />
                <span>{isActive ? tPlatform('modules.tk_active_') : tPlatform('modules.tk_inactive_')}</span>
              </label>
            )}
          </div>
          <div className="text-xs text-foreground/80 mt-1 line-clamp-2 leading-snug">{mod.description}</div>
        </div>
      </div>

      {/* Footer: permissions count + updatedAt on the left, VIEW → on the right (same shape as role/account cards) */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border/60 text-[11px]">
        <div className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{modulePermCount(mod)}</span>
            <span className="text-muted-foreground">{tPlatform('modules.tk_permissions_')}</span>
          </span>
          {mod.subModules.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Boxes className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium text-foreground">{mod.subModules.length}</span>
              <span className="text-muted-foreground">{tPlatform('modules.tk_sub-modules_')}</span>
            </span>
          )}
          <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatDateShort(mod.updatedAt, { withYear: false })}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-primary transition-colors">{tPlatform('modules.tk_view_')} →</span>
      </div>
    </div>
  )
}

/* ─────────────── DETAIL SHEET (sliding side panel, accordion tree) ─────────────── */

/** Total permissions of a module = module-level + every sub-module's. */
function modulePermCount(mod: PlatformModule) {
  return mod.permissions.length + mod.subModules.reduce((acc, sm) => acc + sm.permissions.length, 0)
}

/** Sub-modules of this parent module cannot be deactivated (they gate the platform console itself). */
const LOCKED_SUBMODULE_PARENT = 'PLATFORM_ADMINISTRATION'

/** Active/inactive state dot, shared by the accordion rows and headers. */
function StateDot({ active }: { active: boolean }) {
  return <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', active ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/50')} />
}

function PermissionCard({ p, muted }: { p: PlatformModulePermission; muted?: boolean }) {
  const { t: tPlatform } = useTranslation('platform')
  return (
    <div className={cn('rounded-sm border border-border bg-card px-3 py-2.5 transition-opacity', muted && 'opacity-55')}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[11px] font-bold text-foreground break-all leading-snug">{p.name}</div>
        {muted && (
          <span className="flex-shrink-0 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {tPlatform('modules.detail.tk_hidden_')}
          </span>
        )}
      </div>
      <div className="text-xs text-foreground/80 mt-1 leading-snug">{p.description}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {p.applicableScopes.map((s) => (
          <span key={s} className={cn('inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', scopeBadgeStyles[s as RoleScope])}>
            {s === 'PLATFORM' && <Globe className="h-2.5 w-2.5" />}
            {s === 'ACCOUNT' && <Shield className="h-2.5 w-2.5" />}
            {s === 'ENTITY' && <ShieldCheck className="h-2.5 w-2.5" />}
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A compact active/inactive pill or live toggle, reused for the module header and sub-module header. */
function StatusControl({
  isActive,
  locked,
  canToggle,
  busy,
  onToggle,
  lockedTooltip
}: {
  isActive: boolean
  locked: boolean
  canToggle: boolean
  busy: boolean
  onToggle: (next: boolean) => void
  lockedTooltip: string
}) {
  const { t: tPlatform } = useTranslation('platform')
  const label = isActive ? tPlatform('modules.tk_active_') : tPlatform('modules.tk_inactive_')
  if (locked) {
    return (
      <span
        className="flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        title={lockedTooltip}
      >
        <Lock className="h-2.5 w-2.5" /> {tPlatform('modules.tk_locked_')}
      </span>
    )
  }
  if (!canToggle) {
    return (
      <span
        className={cn(
          'flex-shrink-0 inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
        )}
      >
        <StateDot active={isActive} /> {label}
      </span>
    )
  }
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider select-none',
        isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground',
        busy ? 'opacity-50 cursor-wait' : 'cursor-pointer'
      )}
    >
      <Switch
        checked={isActive}
        disabled={busy}
        onCheckedChange={onToggle}
        className={cn(
          '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
          isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
        )}
      />
      {label}
    </label>
  )
}

function ModuleDetailSheet({
  mod,
  onOpenChange,
  onToggleModule,
  onToggleSubModule,
  busy,
  canToggle
}: {
  mod: PlatformModule | null
  onOpenChange: (open: boolean) => void
  onToggleModule: (next: boolean) => void
  onToggleSubModule: (subModuleId: number, next: boolean) => void
  busy: boolean
  canToggle: boolean
}) {
  return (
    <Sheet open={mod !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        {/* Keyed by module id so search + accordion state reset cleanly when switching modules. */}
        {mod && <ModuleDetailBody key={mod.id} mod={mod} onToggleModule={onToggleModule} onToggleSubModule={onToggleSubModule} busy={busy} canToggle={canToggle} />}
      </SheetContent>
    </Sheet>
  )
}

function ModuleDetailBody({
  mod,
  onToggleModule,
  onToggleSubModule,
  busy,
  canToggle
}: {
  mod: PlatformModule
  onToggleModule: (next: boolean) => void
  onToggleSubModule: (subModuleId: number, next: boolean) => void
  busy: boolean
  canToggle: boolean
}) {
  const { t: tPlatform } = useTranslation('platform')
  const visual = visualOf(mod.typeName)
  const Icon = visual.icon
  const isModuleLocked = LOCKED_MODULES.has(mod.name)
  const subLocked = mod.name === LOCKED_SUBMODULE_PARENT

  const [query, setQuery] = useState('')
  // Accordion state. Default — everything open so the full module → sub-module → permission tree is
  // visible at a glance; the admin collapses what they don't need. Under search we force-open matches.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>(['module', ...mod.subModules.map((sm) => `sub-${sm.id}`)]))
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const q = query.trim().toLowerCase()
  const permMatches = (p: PlatformModulePermission) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  const sectionOpen = (key: string) => (q ? true : expanded.has(key)) // search force-opens relevant sections

  // Module-level (no sub-module) permissions
  const moduleLevelMatches = mod.permissions.filter(permMatches)
  const showModuleSection = mod.permissions.length > 0 && (!q || moduleLevelMatches.length > 0)

  // Sub-modules, with per-section visibility + which permissions to surface under search
  const subSections = mod.subModules.map((sm) => {
    const nameMatch = sm.name.toLowerCase().includes(q)
    const matches = sm.permissions.filter(permMatches)
    return { sm, visible: !q || nameMatch || matches.length > 0, perms: q && !nameMatch ? matches : sm.permissions }
  })
  const visibleSubs = subSections.filter((s) => s.visible)
  const nothingMatches = !!q && !showModuleSection && visibleSubs.length === 0

  return (
    <>
      {/* Header — module identity + activation */}
      <SheetHeader className="border-b border-border px-5 pb-4 pt-6">
        <div className="flex items-start gap-3">
          <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border', visual.ring)}>
            <Icon className={cn('h-4 w-4', visual.tone)} />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="break-all font-mono text-sm leading-snug">{mod.name}</SheetTitle>
            <SheetDescription className="mt-1 text-xs leading-snug text-foreground/80">{mod.description}</SheetDescription>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-[2px] border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">v{mod.version}</span>
              <span className="text-muted-foreground">· {prettifyTypeName(mod.typeName)}</span>
              <StatusControl isActive={mod.isActive} locked={isModuleLocked} canToggle={canToggle} busy={busy} onToggle={onToggleModule} lockedTooltip={tPlatform('modules.tk_locked-tooltip_')} />
            </div>
          </div>
        </div>
      </SheetHeader>

      {/* Search */}
      <div className="border-b border-border px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tPlatform('modules.detail.tk_search-placeholder_')} className="h-9 pl-8 text-xs" />
        </div>
      </div>

      {/* Accordion tree: module-level permissions, then one collapsible per sub-module */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {showModuleSection && (
          <div className="overflow-hidden rounded-sm border border-border">
            <button type="button" onClick={() => toggleExpand('module')} className="flex w-full items-center gap-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
              <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', !sectionOpen('module') && '-rotate-90')} />
              <Layers className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span className="flex-1 text-[12px] font-semibold text-foreground">{tPlatform('modules.detail.tk_module-permissions_')}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{(q ? moduleLevelMatches : mod.permissions).length}</span>
            </button>
            {sectionOpen('module') && (
              <div className="space-y-2 border-t border-border bg-background/40 p-2.5">
                {(q ? moduleLevelMatches : mod.permissions).map((p) => (
                  <PermissionCard key={p.id} p={p} />
                ))}
              </div>
            )}
          </div>
        )}

        {visibleSubs.length > 0 && <div className="px-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">{tPlatform('modules.detail.tk_sub-modules_')}</div>}
        {visibleSubs.map(({ sm, perms }) => {
          const key = `sub-${sm.id}`
          const open = sectionOpen(key)
          return (
            <div key={sm.id} className={cn('overflow-hidden rounded-sm border border-border', !sm.isActive && 'opacity-70')}>
              <div className="flex items-center gap-2 bg-card px-3 py-2.5">
                <button type="button" onClick={() => toggleExpand(key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
                  <Boxes className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-[12px] font-medium text-foreground">{sm.name}</span>
                  <StateDot active={sm.isActive} />
                  <span className="text-[10px] tabular-nums text-muted-foreground">{perms.length}</span>
                </button>
                <StatusControl
                  isActive={sm.isActive}
                  locked={subLocked}
                  canToggle={canToggle}
                  busy={busy}
                  onToggle={(next) => onToggleSubModule(sm.id, next)}
                  lockedTooltip={tPlatform('modules.detail.tk_sub-locked-tooltip_')}
                />
              </div>
              {open && (
                <div className="space-y-2 border-t border-border bg-background/40 p-2.5">
                  <p className="text-[11px] leading-snug text-muted-foreground">{sm.description}</p>
                  {!sm.isActive && (
                    <div className="rounded-sm border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                      {tPlatform('modules.detail.tk_inactive-hint_')}
                    </div>
                  )}
                  {perms.length === 0 ? (
                    <p className="text-[11px] italic text-muted-foreground">{tPlatform('modules.tk_no-permissions_')}</p>
                  ) : (
                    perms.map((p) => <PermissionCard key={p.id} p={p} muted={!sm.isActive} />)
                  )}
                </div>
              )}
            </div>
          )
        })}

        {nothingMatches && <p className="px-1 py-6 text-center text-[12px] italic text-muted-foreground">{tPlatform('modules.detail.tk_no-results_')}</p>}
      </div>
    </>
  )
}

/* ─────────────── MAIN ─────────────── */

export function PlatformModules() {
  const { t: tPlatform } = useTranslation('platform')
  const { setBreadcrumb } = useBreadcrumb()
  const { data, isLoading } = usePlatformModules()
  const toggleMutation = useTogglePlatformModule()
  const toggleSubModuleMutation = useToggleSubModule()
  const { hasPermission } = useModuleAccess()
  const canToggleModule = hasPermission('MODULE_MANAGEMENT')

  const [search, setSearch] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [typeFilterSearch, setTypeFilterSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  // Store the open module's id, NOT the full object — the object reference changes on every
  // refetch and would otherwise trigger a setState/useEffect infinite loop.
  const [openModuleId, setOpenModuleId] = useState<number | null>(null)

  useEffect(() => {
    setBreadcrumb([{ label: tPlatform('breadcrumb.tk_platform_') }, { label: tPlatform('modules.tk_title_'), description: tPlatform('modules.tk_description_') }])
  }, [setBreadcrumb, tPlatform])

  const allModules = data ?? []
  const totalActive = allModules.filter((m) => m.isActive).length
  const totalPermissions = allModules.reduce((acc, m) => acc + modulePermCount(m), 0)

  const availableTypes = useMemo(() => {
    const set = new Set(allModules.map((m) => m.typeName))
    return Array.from(set).sort()
  }, [allModules])

  const typeFilterItems: MultiSelectFilterItem[] = useMemo(() => {
    const haystack = typeFilterSearch.trim().toLowerCase()
    return availableTypes
      .map((t) => ({
        id: t,
        label: prettifyTypeName(t)
          .replace(/Management$/, '')
          .trim()
      }))
      .filter((item) => !haystack || item.label.toLowerCase().includes(haystack) || String(item.id).toLowerCase().includes(haystack))
  }, [availableTypes, typeFilterSearch])

  const filtered = useMemo(() => {
    return allModules.filter((mod) => {
      if (selectedTypes.length > 0 && !selectedTypes.includes(mod.typeName)) return false
      if (statusFilter === 'ACTIVE' && !mod.isActive) return false
      if (statusFilter === 'INACTIVE' && mod.isActive) return false
      if (search) {
        const needle = search.toLowerCase()
        const haystack = [
          mod.name.toLowerCase(),
          mod.description.toLowerCase(),
          mod.typeName.toLowerCase(),
          ...mod.permissions.map((p) => p.name.toLowerCase()),
          ...mod.permissions.map((p) => p.description.toLowerCase()),
          ...mod.subModules.map((sm) => sm.name.toLowerCase()),
          ...mod.subModules.flatMap((sm) => sm.permissions.map((p) => p.name.toLowerCase())),
          ...mod.subModules.flatMap((sm) => sm.permissions.map((p) => p.description.toLowerCase()))
        ].join(' ')
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [allModules, selectedTypes, statusFilter, search])

  // Derive the open module from the live list — automatically picks up updates after a toggle
  // and gracefully closes the Sheet when the module disappears.
  const openModule = useMemo(() => allModules.find((m) => m.id === openModuleId) ?? null, [allModules, openModuleId])

  return (
    <div className="container mx-auto">
      {/* Header — no search here anymore; it moved next to the type filter below. */}
      <div className="mb-5 flex items-center justify-between gap-4 rounded-sm border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border border-primary/30 bg-primary/12">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-foreground text-sm">{tPlatform('modules.tk_title_')}</span>
              <span className="rounded-[2px] bg-primary/15 text-primary border border-primary/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {tPlatform('modules.tk_platform-only_')}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{tPlatform('modules.tk_subtitle_', { active: totalActive, total: allModules.length })}</p>
          </div>
        </div>
      </div>

      {/* KPI filter row — clicking a card narrows the grid below. Replaces the legacy segmented status filter. */}
      {!isLoading && allModules.length > 0 && <KpiFilterRow total={allModules.length} active={totalActive} totalPermissions={totalPermissions} value={statusFilter} onChange={setStatusFilter} />}

      {/* Filter bar — search on the left, type multi-select on the right (mirrors the users page layout). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tPlatform('modules.tk_search-placeholder_')} className="pl-9" />
        </div>
        <MultiSelectFilter
          dataTestid="modules-type-filter"
          icon={<Layers className="h-3.5 w-3.5" />}
          selected={selectedTypes}
          onChange={(s) => setSelectedTypes(s.map(String))}
          items={typeFilterItems}
          placeholder={tPlatform('modules.filters.tk_type-placeholder_')}
          selectedLabel={tPlatform('modules.filters.tk_type-selected_')}
          badgeBg="bg-primary/15"
          badgeText="text-primary"
          search={typeFilterSearch}
          onSearchChange={setTypeFilterSearch}
          emptyText={tPlatform('modules.filters.tk_type-empty_')}
        />
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
          <Users className="h-5 w-5 text-muted-foreground/60" />
          <span className="text-sm text-muted-foreground">{tPlatform('modules.tk_empty_')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((mod) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              busy={toggleMutation.isLoading}
              canToggle={canToggleModule}
              onOpen={() => setOpenModuleId(mod.id)}
              onToggle={(next) => toggleMutation.mutate({ moduleId: mod.id, isActive: next })}
            />
          ))}
        </div>
      )}

      <ModuleDetailSheet
        mod={openModule}
        onOpenChange={(open) => !open && setOpenModuleId(null)}
        busy={toggleMutation.isLoading || toggleSubModuleMutation.isLoading}
        canToggle={canToggleModule}
        onToggleModule={(next) => openModule && toggleMutation.mutate({ moduleId: openModule.id, isActive: next })}
        onToggleSubModule={(subModuleId, next) => openModule && toggleSubModuleMutation.mutate({ moduleId: openModule.id, subModuleId, isActive: next })}
      />
    </div>
  )
}
