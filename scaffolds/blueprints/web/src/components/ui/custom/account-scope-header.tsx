import i18next from 'i18next'
import { Building2, Check, ChevronDown, Copy, Globe, Plus, Search, Shield, ShieldCheck, User, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useAccount } from '@/hooks/api/accounts'
import { useAllAccounts } from '@/hooks/api/accounts/queries/useAllAccounts'
import { useUpdateAccountStatus } from '@/hooks/api/accounts/mutations/useUpdateAccountStatus'
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { CreateOwnAccountDialog } from '@/components/dialogs/create-own-account-dialog'
import { ConfirmDialog } from '@/components/ui/custom/confirm-dialog'
import { cn } from '@/utils/ui'
import { Switch } from '@/components/ui/shadcn/switch'

function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString(i18next.language || 'en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortenId(id: string) {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

/**
 * Header rendered above the Account Management page. Three states:
 *
 *  - PLATFORM: a platform-admin sees "All accounts" with a switcher into any
 *              specific account; or, when a specific account is selected, the
 *              account header with a "back to all" affordance.
 *  - ACCOUNT : an account-admin sees their account header (current behavior).
 *  - ENTITY  : an entity-admin sees their entity name in place of the account.
 */
export function AccountScopeHeader() {
  const { isPlatformAdmin, isAccountAdmin, isEntityAdmin, currentScope, allAccounts, isMultiAccount, managedEntities, isMultiEntity, activeEntity, scopedAccountIds, setCurrentScope } = useAdminScope()
  const queryClient = useQueryClient()

  // Resolve the account id to fetch details for: explicit current scope id when ACCOUNT or PLATFORM-with-id,
  // else first managed account; for entity admins (no UserAccountLink) fall back to the entity's parent account.
  // `activeEntity` already resolves to the currently scoped entity (or first active one), so its accountId is
  // the right fallback whichever entity the user just switched into.
  const entityAccountFallback = activeEntity?.accountId ?? managedEntities[0]?.accountId ?? null
  const resolvedAccountId =
    currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : (allAccounts.find((a) => a.isActive)?.id ?? entityAccountFallback)
  const { data: account } = useAccount(resolvedAccountId as string)

  // Entity-admin scope: surface entity metadata (id / created / updated / status) instead of the
  // account's. The entity record comes from the account payload — useAccount already returns the
  // account's entities list. Track the *active* entity (driven by currentScope.id) so a switcher
  // click actually changes the surfaced entity, not just the underlying scope.
  const isEntityScope = currentScope.kind === 'ENTITY'
  const targetEntityId = activeEntity?.id ?? null
  const entity = useMemo(() => {
    if (!isEntityScope || !account || !targetEntityId) return null
    return account.entities.values.find((e) => e.id === targetEntityId) ?? null
  }, [isEntityScope, account, targetEntityId])

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherSearch, setSwitcherSearch] = useState('')
  const [entitySwitcherOpen, setEntitySwitcherOpen] = useState(false)
  const [entitySwitcherSearch, setEntitySwitcherSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false)
  const [createOwnAccountOpen, setCreateOwnAccountOpen] = useState(false)
  const [createOwnEntityOpen, setCreateOwnEntityOpen] = useState(false)
  const { t: tAccount } = useTranslation('account')
  const { hasPermission } = useModuleAccess()
  const updateStatus = useUpdateAccountStatus()
  const canToggleStatus = hasPermission('ACCOUNT_UPDATE')
  // Multi-account / multi-entity features — visible only to actors carrying the perm (module
  // activation gating is enforced upstream: when the module is off, the perm is filtered out of /me).
  const canCreateOwnAccount = hasPermission('ACCOUNT_OWN_CREATE')
  const canCreateOwnEntity = hasPermission('ENTITY_OWN_CREATE')

  const confirmToggleStatus = async () => {
    if (!resolvedAccountId || !account) return
    try {
      await updateStatus.mutateAsync({ accountId: resolvedAccountId, isActive: !account.isActive })
      setConfirmStatusOpen(false)
    } catch (e) {
      console.error('Failed to toggle account status', e)
    }
  }

  const handleCopy = async () => {
    const target = isEntityScope ? targetEntityId : resolvedAccountId
    if (!target) return
    await navigator.clipboard.writeText(target)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // PLATFORM_ALL means a platform-admin browsing the multi-account view (no specific account picked).
  const isPlatformAll = currentScope.kind === 'PLATFORM' && !currentScope.id
  // The meta row (id / created / updated / status) renders when we have a scoped account OR an
  // entity to describe. For entity admins we wait for the entity record to materialise.
  const showAccountMeta = !isPlatformAll && (isEntityScope ? Boolean(entity) : Boolean(resolvedAccountId))

  // Title + role badge.
  // In entity scope we show only the *active* entity name — joining every managed entity made
  // the header lie about which one the rest of the page is contextualised on.
  const title = isPlatformAll
    ? tAccount('scopeHeader.tk_all-accounts_')
    : currentScope.kind === 'ENTITY'
      ? (activeEntity?.name ?? tAccount('scopeHeader.tk_my-entities-fallback_'))
      : (account?.name ?? tAccount('scopeHeader.tk_account-fallback_'))

  // Role badge always reflects the user's *actual* highest privilege, not the contextual scope.
  // A platform-admin browsing a specific account is still a platform-admin.
  const roleBadgeKey = isPlatformAdmin ? 'scopeHeader.tk_role-platform-admin_' : currentScope.kind === 'ENTITY' ? 'scopeHeader.tk_role-entity-admin_' : 'scopeHeader.tk_role-account-admin_'

  const Icon = isPlatformAll ? Globe : isAccountAdmin || (isPlatformAdmin && currentScope.kind === 'ACCOUNT') ? Shield : isEntityAdmin ? Shield : User

  // Accounts the user can switch into. Platform-admins see EVERY account on the platform —
  // they have no `UserAccountLink` so we read the platform-wide list via `useAllAccounts`.
  // Regular account-admins still see only the accounts they have an ACCOUNT-scoped assignment on.
  const { data: allPlatformAccounts } = useAllAccounts({ limit: 50, enabled: isPlatformAdmin })
  // Unfiltered base list — drives `showSwitcher` so the pill never disappears mid-typing
  // (filtering it would unmount the dropdown the moment the user typed something with no match).
  const baseSwitchableAccounts = useMemo(() => {
    return isPlatformAdmin ? (allPlatformAccounts?.items ?? []).map((a) => ({ id: a.id, name: a.name, isActive: a.isActive })) : allAccounts.filter((a) => scopedAccountIds.includes(a.id))
  }, [isPlatformAdmin, allPlatformAccounts, allAccounts, scopedAccountIds])

  // Filtered list used inside the dropdown panel
  const switchableAccounts = useMemo(() => {
    const needle = switcherSearch.trim().toLowerCase()
    if (!needle) return baseSwitchableAccounts
    // Match both the name and the id — admins often paste an id from logs/DB to jump straight in.
    return baseSwitchableAccounts.filter((a) => a.name.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle))
  }, [baseSwitchableAccounts, switcherSearch])

  // Entity-scope view = entity-admin without account/platform elevation. The account switcher
  // is meaningless for them (no UserAccountLink) — the entity switcher takes its slot instead.
  const isEntityScopeView = isEntityAdmin && !isAccountAdmin && !isPlatformAdmin

  // Filtered list of managed entities used inside the entity-switcher dropdown.
  const switchableEntities = useMemo(() => {
    const needle = entitySwitcherSearch.trim().toLowerCase()
    if (!needle) return managedEntities
    return managedEntities.filter((e) => e.name.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle))
  }, [managedEntities, entitySwitcherSearch])

  const showAccountSwitcher = !isEntityScopeView && ((isPlatformAdmin && baseSwitchableAccounts.length > 0) || (!isPlatformAdmin && isMultiAccount))
  const showEntitySwitcher = isEntityScopeView && isMultiEntity
  // Single boolean for "is *some* switcher available" — used by the card-level click affordance.
  const showSwitcher = showAccountSwitcher || showEntitySwitcher

  // Standalone "+ Create new" button rendered next to the title — only when sitting on a SINGLE
  // account/entity with the corresponding multi-* perm. Once they have 2+, the affordance moves
  // into the switcher dropdown tile (no point in two competing UIs).
  const showStandaloneCreateBtn = !isPlatformAdmin && !isEntityScopeView && canCreateOwnAccount && !isMultiAccount
  const showStandaloneCreateEntityBtn = isEntityScopeView && canCreateOwnEntity && !isMultiEntity

  return (
    <>
      <div
        className={cn(
          'mb-5 flex justify-between gap-4 rounded-sm border border-border bg-card px-4 py-3 transition-colors',
          showAccountMeta ? 'items-start' : 'items-center',
          showSwitcher && 'cursor-pointer hover:border-primary/40'
        )}
        onClick={showEntitySwitcher ? () => setEntitySwitcherOpen((v) => !v) : showAccountSwitcher ? () => setSwitcherOpen((v) => !v) : undefined}
        role={showSwitcher ? 'button' : undefined}
        title={showSwitcher ? tAccount(showEntitySwitcher ? 'scopeHeader.tk_switch-entity_' : 'scopeHeader.tk_switch-account_') : undefined}
      >
        {/* Left — scope identity + meta row */}
        <div className={cn('flex gap-3 min-w-0', showAccountMeta ? 'items-start' : 'items-center')}>
          <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', isPlatformAll || isAccountAdmin || isPlatformAdmin ? 'bg-primary/15' : 'bg-muted')}>
            <Icon className={cn('h-4 w-4', isPlatformAll || isAccountAdmin || isPlatformAdmin ? 'text-primary' : 'text-muted-foreground')} />
          </div>

          <div className="min-w-0 flex flex-col gap-1.5">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display font-bold text-foreground truncate text-sm">{title}</span>
              <span
                className={cn(
                  'flex-shrink-0 rounded-[2px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border',
                  isPlatformAll || isAccountAdmin || isPlatformAdmin ? 'bg-primary/15 text-primary border-primary/25' : 'bg-muted text-muted-foreground border-border'
                )}
              >
                {tAccount(roleBadgeKey)}
              </span>
              {showAccountMeta &&
                (isEntityScope ? entity : account) &&
                (() => {
                  // Reuse the same status pill shape for both account and entity. Entity-admin path is
                  // read-only — they don't carry ACCOUNT_UPDATE — so the toggle branch never fires.
                  const target = isEntityScope ? entity! : account!
                  const allowToggle = canToggleStatus && !isEntityScope
                  return allowToggle ? (
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none transition-colors',
                        target.isActive
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                          : 'border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40',
                        updateStatus.isLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                      )}
                      title={tAccount(target.isActive ? 'scopeHeader.tk_status-deactivate_' : 'scopeHeader.tk_status-reactivate_')}
                    >
                      <Switch
                        checked={target.isActive}
                        disabled={updateStatus.isLoading}
                        onCheckedChange={() => setConfirmStatusOpen(true)}
                        className={cn(
                          '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                          target.isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                        )}
                      />
                      <span>{tAccount(target.isActive ? 'scopeHeader.tk_status-active_' : 'scopeHeader.tk_status-disabled_')}</span>
                    </label>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                        target.isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', target.isActive ? 'bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500' : 'bg-muted-foreground/60')} />
                      {tAccount(target.isActive ? 'scopeHeader.tk_status-active_' : 'scopeHeader.tk_status-disabled_')}
                    </span>
                  )
                })()}
              {isPlatformAll && <span className="text-[11px] text-muted-foreground">{tAccount('scopeHeader.tk_platform-overview-hint_')}</span>}
            </div>

            {/* Meta row — ID, Created, Updated (hidden in PLATFORM_ALL view).
              In entity-admin scope the row describes the ENTITY (id/createdAt/updatedAt come from
              the account payload's entities list), otherwise the ACCOUNT. */}
            {showAccountMeta &&
              (isEntityScope ? entity : resolvedAccountId) &&
              (() => {
                const idValue = isEntityScope ? entity!.id : resolvedAccountId!
                const createdAt = isEntityScope ? entity!.createdAt : account?.createdAt
                const updatedAt = isEntityScope ? entity!.updatedAt : account?.updatedAt
                return (
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_id_')}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        {shortenId(idValue)}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCopy()
                          }}
                          className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                          title={tAccount('scopeHeader.tk_copy-id_')}
                        >
                          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </span>
                    </span>
                    {createdAt && (
                      <>
                        <span className="text-border">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_created_')}</span>
                          <span className="text-foreground font-medium">{formatDate(createdAt)}</span>
                        </span>
                      </>
                    )}
                    {updatedAt && (
                      <>
                        <span className="text-border">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_updated_')}</span>
                          <span className="text-foreground font-medium">{formatDate(updatedAt)}</span>
                        </span>
                      </>
                    )}
                  </div>
                )
              })()}
          </div>
        </div>

        {/* Right — switcher visual cue (the whole card is clickable; this is just the affordance).
          Mirrors the multiselect-filter "open" state styling: accent (mustard) bg + border.
          `self-center` overrides the parent's items-start so the pill/button sits vertically
          centered on the header card regardless of how many meta rows the title carries. */}
        <div className="flex flex-shrink-0 items-center gap-2 self-center">
          {showStandaloneCreateBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setCreateOwnAccountOpen(true)
              }}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Plus className="h-3.5 w-3.5" />
              {tAccount('scopeHeader.tk_create-own-account_')}
            </button>
          )}
          {showStandaloneCreateEntityBtn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setCreateOwnEntityOpen(true)
              }}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Plus className="h-3.5 w-3.5" />
              {tAccount('scopeHeader.tk_create-own-entity_')}
            </button>
          )}
          {showAccountSwitcher && (
            <div className="relative">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                  switcherOpen ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-background text-muted-foreground'
                )}
              >
                <Building2 className="h-3.5 w-3.5" />
                {tAccount('scopeHeader.tk_switch-account_')}
                <ChevronDown className={cn('h-3 w-3 transition-transform', switcherOpen && 'rotate-180')} />
              </span>

              {switcherOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSwitcherOpen(false)
                      setSwitcherSearch('')
                    }}
                  />
                  <div className="absolute right-0 top-full z-20 mt-2 w-[480px] max-w-[90vw] rounded-sm border border-border bg-card shadow-lg p-2" onClick={(e) => e.stopPropagation()}>
                    <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {tAccount(isPlatformAdmin ? 'scopeHeader.tk_pick-context_' : 'scopeHeader.tk_your-accounts_')}
                    </p>

                    {/* Search input — same affordance pattern as the multiselect-filter popover. */}
                    <div className="relative mb-2 px-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={switcherSearch}
                        onChange={(e) => setSwitcherSearch(e.target.value)}
                        placeholder={tAccount('scopeHeader.tk_search-placeholder_')}
                        className="h-9 w-full rounded-sm border border-border bg-card pl-7 pr-7 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary/60 focus:outline-none"
                      />
                      {switcherSearch.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSwitcherSearch('')
                          }}
                          className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {(() => {
                      const needle = switcherSearch.trim().toLowerCase()
                      const showAllAccountsTile = isPlatformAdmin && (!needle || tAccount('scopeHeader.tk_all-accounts_').toLowerCase().includes(needle))
                      const hasAccountsToShow = showAllAccountsTile || switchableAccounts.length > 0

                      return (
                        <>
                          {hasAccountsToShow ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto">
                              {showAllAccountsTile && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSwitcherOpen(false)
                                    setCurrentScope({ kind: 'PLATFORM', id: null })
                                    queryClient.invalidateQueries()
                                  }}
                                  className={cn(
                                    'cursor-pointer flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
                                    isPlatformAll ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                  )}
                                >
                                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                    <Globe className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[12px] font-bold text-foreground leading-tight">{tAccount('scopeHeader.tk_all-accounts_')}</div>
                                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{tAccount('scopeHeader.tk_all-accounts-sub_')}</div>
                                  </div>
                                  {isPlatformAll && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />}
                                </button>
                              )}
                              {switchableAccounts.map((acc) => {
                                const isCurrent = currentScope.kind === 'ACCOUNT' ? acc.id === currentScope.id : currentScope.kind === 'PLATFORM' && acc.id === currentScope.id
                                return (
                                  <button
                                    key={acc.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSwitcherOpen(false)
                                      setCurrentScope({ kind: isPlatformAdmin ? 'PLATFORM' : 'ACCOUNT', id: acc.id })
                                      queryClient.invalidateQueries()
                                    }}
                                    className={cn(
                                      'cursor-pointer flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
                                      isCurrent ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                    )}
                                  >
                                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                      <Shield className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[12px] font-bold text-foreground leading-tight truncate">{acc.name}</div>
                                      <div className="text-[10px] font-mono text-muted-foreground leading-tight mt-0.5 truncate">{shortenId(acc.id)}</div>
                                    </div>
                                    {isCurrent && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">{tAccount('scopeHeader.tk_no-match_')}</div>
                          )}
                          {/* Create new account stays outside the filtered grid — the search input
                            is meant to find an existing account, not to gate the create affordance. */}
                          {canCreateOwnAccount && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSwitcherOpen(false)
                                setCreateOwnAccountOpen(true)
                              }}
                              className={cn(
                                'cursor-pointer flex items-center gap-2.5 rounded-sm border border-dashed border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 w-full',
                                hasAccountsToShow && 'mt-2'
                              )}
                            >
                              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                <Plus className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-bold text-foreground leading-tight">{tAccount('scopeHeader.tk_create-own-account_')}</div>
                                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{tAccount('scopeHeader.tk_create-own-account-sub_')}</div>
                              </div>
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {showEntitySwitcher && (
            <div className="relative">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                  entitySwitcherOpen ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-background text-muted-foreground'
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {tAccount('scopeHeader.tk_switch-entity_')}
                <ChevronDown className={cn('h-3 w-3 transition-transform', entitySwitcherOpen && 'rotate-180')} />
              </span>

              {entitySwitcherOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEntitySwitcherOpen(false)
                      setEntitySwitcherSearch('')
                    }}
                  />
                  <div className="absolute right-0 top-full z-20 mt-2 w-[480px] max-w-[90vw] rounded-sm border border-border bg-card shadow-lg p-2" onClick={(e) => e.stopPropagation()}>
                    <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('scopeHeader.tk_your-entities_')}</p>

                    <div className="relative mb-2 px-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={entitySwitcherSearch}
                        onChange={(e) => setEntitySwitcherSearch(e.target.value)}
                        placeholder={tAccount('scopeHeader.tk_search-entity-placeholder_')}
                        className="h-9 w-full rounded-sm border border-border bg-card pl-7 pr-7 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary/60 focus:outline-none"
                      />
                      {entitySwitcherSearch.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEntitySwitcherSearch('')
                          }}
                          className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {switchableEntities.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto">
                        {switchableEntities.map((ent) => {
                          const isCurrent = currentScope.kind === 'ENTITY' && ent.id === currentScope.id
                          return (
                            <button
                              key={ent.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEntitySwitcherOpen(false)
                                setEntitySwitcherSearch('')
                                setCurrentScope({ kind: 'ENTITY', id: ent.id })
                                queryClient.invalidateQueries()
                              }}
                              className={cn(
                                'cursor-pointer flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
                                isCurrent ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                              )}
                            >
                              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-bold text-foreground leading-tight truncate">{ent.name}</div>
                                <div className="text-[10px] font-mono text-muted-foreground leading-tight mt-0.5 truncate">{shortenId(ent.id)}</div>
                              </div>
                              {isCurrent && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">{tAccount('scopeHeader.tk_no-match_')}</div>
                    )}

                    {canCreateOwnEntity && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEntitySwitcherOpen(false)
                          setCreateOwnEntityOpen(true)
                        }}
                        className={cn(
                          'cursor-pointer flex items-center gap-2.5 rounded-sm border border-dashed border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 w-full',
                          switchableEntities.length > 0 && 'mt-2'
                        )}
                      >
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                          <Plus className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-bold text-foreground leading-tight">{tAccount('scopeHeader.tk_create-own-entity_')}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{tAccount('scopeHeader.tk_create-own-entity-sub_')}</div>
                        </div>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog rendered as a sibling of the card — placing it inside would bubble its
        click events back through the React tree to the card's onClick (which toggles the
        switcher) since portals propagate events along the React tree, not the DOM tree. */}
      {account && (
        <ConfirmDialog
          isOpen={confirmStatusOpen}
          onOpenChange={setConfirmStatusOpen}
          title={tAccount(account.isActive ? 'scopeHeader.tk_status-deactivate-title_' : 'scopeHeader.tk_status-reactivate-title_', { name: account.name })}
          description={
            account.isActive && !isPlatformAdmin
              ? // Account-admin self-deactivation: surface the consequence — they can't undo it themselves.
                tAccount('scopeHeader.tk_status-deactivate-self-desc_')
              : tAccount(account.isActive ? 'scopeHeader.tk_status-deactivate-desc_' : 'scopeHeader.tk_status-reactivate-desc_')
          }
          tone={account.isActive ? 'destructive' : 'default'}
          confirmLabel={tAccount(account.isActive ? 'scopeHeader.tk_status-deactivate-cta_' : 'scopeHeader.tk_status-reactivate-cta_')}
          isLoading={updateStatus.isLoading}
          onConfirm={confirmToggleStatus}
        />
      )}
      {canCreateOwnAccount && createOwnAccountOpen && (
        <CreateOwnAccountDialog
          isOpen
          onOpenChange={setCreateOwnAccountOpen}
          // Pre-fill the name with "<current account> #<n+1>" so the user only needs to confirm or
          // override. Falls back to a generic placeholder when the current account hasn't loaded yet.
          defaultName={(() => {
            const base = account?.name ?? tAccount('scopeHeader.tk_account-fallback_')
            return `${base} #${allAccounts.length + 1}`
          })()}
          onCreated={(newAccountId) => {
            // Auto-switch to the freshly created account — better UX than leaving the user on their previous scope.
            setCurrentScope({ kind: isPlatformAdmin ? 'PLATFORM' : 'ACCOUNT', id: newAccountId })
            queryClient.invalidateQueries()
          }}
        />
      )}
      {canCreateOwnEntity && createOwnEntityOpen && (
        // Same dialog as the account-admin entity flow — the dialog branches on perms to call the
        // right mutation (entity-admin uses /entities/own, account-admin uses /entities). After
        // success we auto-switch the scope onto the newly minted entity.
        <CreateEntityDialog
          isOpen
          onOpenChange={setCreateOwnEntityOpen}
          onCreated={(newEntityId) => {
            setCurrentScope({ kind: 'ENTITY', id: newEntityId })
            queryClient.invalidateQueries()
          }}
        />
      )}
    </>
  )
}
