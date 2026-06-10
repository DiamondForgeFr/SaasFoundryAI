/**
 * Ressources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Globe, Mail, Search, Shield, ShieldCheck, User as UserIcon, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { useInviteUser, useInviteUserSchema } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import { useAccountEntities } from '@/hooks/api/accounts/queries/useAccountEntities'
import { useAccountRoles } from '@/hooks/api/accounts/queries/useAccountRoles'
import { useAllAccounts } from '@/hooks/api/accounts/queries/useAllAccounts'
import { useSystemRoles } from '@/hooks/api/accounts/queries/useSystemRoles'
import { useInvitedUsers } from '@/hooks/api/invitations/queries/useInvitedUsers'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'

/**
 * Components
 */
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/shadcn/form'
import { Input } from '@/components/ui/shadcn/input'
import { Skeleton } from '@/components/ui/shadcn/skeleton'

/**
 * Types
 */
import type { InviteUserPayloadDto } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import type { MeResponseDto } from '@/hooks/api/auth'

type InviteUserDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

function CompactSearch({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-8 pr-8 h-9 text-xs" />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function InviteUserDialog({ isOpen, onOpenChange }: InviteUserDialogProps) {
  const { t: tCommon } = useTranslation('common')
  const { t: tAccount } = useTranslation('account')
  const { hasPermission } = useModuleAccess()
  const { isAccountAdmin, isPlatformAdmin, currentScope, managedEntities, activeEntity } = useAdminScope()

  // PLATFORM_ALL = a platform-admin browsing the all-accounts view, no specific account scoped.
  // In that mode the access-scope section trades "Account access + entities of THIS account" for
  // "Platform access + multi-select of EXISTING accounts". Everything else (Who?, Roles, summary)
  // stays identical, sharing the same modal shape and visual treatment.
  const isPlatformAllMode = isPlatformAdmin && currentScope.kind === 'PLATFORM' && !currentScope.id
  // A platform-admin contextualized on a single account keeps `currentScope.kind === 'PLATFORM'`
  // but carries the target account id in `currentScope.id` (see account-scope-header.tsx). Treat
  // that case as account-admin flow so the dialog renders the entities list and Account access tile,
  // not the entity-admin "pre-selected" lock-in (which fires when they don't carry an ACCOUNT role).
  const isPlatformAdminOnAccount = isPlatformAdmin && currentScope.kind === 'PLATFORM' && !!currentScope.id
  const isAccountAdminFlow = isAccountAdmin || isPlatformAdminOnAccount

  // Create extended schema based on existing API schema
  const baseInviteSchema = useInviteUserSchema()
  const formSchemaBase = baseInviteSchema.payload.extend({
    isDirectlyLinked: z.boolean(),
    isPlatformAccess: z.boolean()
  })
  const formSchema = formSchemaBase.refine(
    (data) => {
      if (isPlatformAllMode) {
        // Platform-admin invite: either platform access OR at least one account selected.
        return data.isPlatformAccess || (data.accountIds && data.accountIds.length > 0)
      }
      // Account-admin invite: account access OR at least one entity selected.
      return data.isDirectlyLinked || (data.entityIds && data.entityIds.length > 0)
    },
    {
      message: tCommon('fields.errors.tk_minOneEntityOrDirectLink_'),
      path: isPlatformAllMode ? ['accountIds'] : ['entityIds']
    }
  )

  type FormValues = z.infer<typeof formSchemaBase>

  const queryClient = useQueryClient()
  const [searchRoles, setSearchRoles] = useState('')
  const [searchEntities, setSearchEntities] = useState('')
  const [searchAccounts, setSearchAccounts] = useState('')

  // Get accountId — prefer the currently-scoped account (covers the platform-admin-on-account
  // case where authMe.accounts may not include the viewed account at all). Mirrors the resolution
  // used in account-scope-header.tsx: both `kind=ACCOUNT` and `kind=PLATFORM` with an id point to
  // a single account. Falls back to the user's own active account for the regular admin path;
  // for entity-admins (no UserAccountLink) we resolve via the active entity's parent account so
  // the roles / entities queries below actually receive a non-empty accountId.
  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const scopedAccountId = currentScope.kind === 'ACCOUNT' || (currentScope.kind === 'PLATFORM' && currentScope.id) ? currentScope.id : null
  const accountId = scopedAccountId ?? activeAccount?.id ?? activeEntity?.accountId ?? managedEntities[0]?.accountId

  // Get roles and entities — datasources branch on the dialog mode.
  // Platform mode: use system roles catalog + all-accounts list (cross-account).
  // Account mode: use per-account roles + per-account entities (current behaviour).
  const accountRolesQuery = useAccountRoles(accountId as string, { search: searchRoles, limit: 10 })
  const systemRolesQuery = useSystemRoles({ search: searchRoles, limit: 10, enabled: isPlatformAllMode })
  const rolesData = isPlatformAllMode ? systemRolesQuery.data : accountRolesQuery.data
  const isLoadingRoles = isPlatformAllMode ? systemRolesQuery.isLoading : accountRolesQuery.isLoading

  const { data: entitiesData, isLoading: isLoadingEntities } = useAccountEntities(accountId as string, {
    search: searchEntities,
    limit: 10
  })

  // Platform-admin-only datasource (the all-accounts list). Gate it on the platform mode so an
  // account-admin mounting this dialog (it's always mounted on the overview, `isOpen` only toggles
  // visibility) doesn't fire the platform endpoint and get a 403. Mirrors `systemRolesQuery` above.
  const { data: accountsData, isLoading: isLoadingAccounts } = useAllAccounts({ search: searchAccounts || undefined, isActive: true, limit: 20, enabled: isPlatformAllMode })

  // Invite user mutation
  const inviteUser = useInviteUser()

  const { refetch: refreshInvitations } = useInvitedUsers()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      firstname: '',
      lastname: '',
      roleIds: [],
      entityIds: [],
      isDirectlyLinked: false,
      isPlatformAccess: false,
      accountIds: []
    }
  })

  // Entity-admin path: invitations are scoped to the entity they're CURRENTLY contextualised
  // on (the one in the scope switcher), not every entity they manage. Falls back to all managed
  // entities only when activeEntity hasn't resolved yet (e.g. fresh page load before /me).
  const targetEntities = activeEntity ? [activeEntity] : managedEntities
  useEffect(() => {
    if (!isOpen) return
    if (isAccountAdminFlow || isPlatformAllMode) return
    const targetIds = targetEntities.map((e) => e.id)
    const current = form.getValues('entityIds') ?? []
    // Re-sync when activeEntity changes (e.g. user closed/reopened the dialog after switching).
    if (targetIds.length > 0 && (current.length === 0 || current.join(',') !== targetIds.join(','))) {
      form.setValue('entityIds', targetIds, { shouldValidate: true })
    }
  }, [isOpen, isAccountAdminFlow, isPlatformAllMode, targetEntities, form])

  // The platform-admin role id is auto-assigned in platform mode when "Platform access" is picked.
  // Resolved lazily from the same system-roles fetch — its row is always present in the catalog.
  const platformAdminRole = (rolesData?.items ?? []).find((r) => r.name === 'platform-admin')

  const handleSubmit = async (data: FormValues) => {
    let finalPayload: InviteUserPayloadDto
    if (isPlatformAllMode) {
      if (data.isPlatformAccess) {
        // Platform access: auto-pick platform-admin, no targets.
        if (!platformAdminRole) {
          console.error('platform-admin role not found in system roles catalog')
          return
        }
        finalPayload = {
          email: data.email,
          firstname: data.firstname,
          lastname: data.lastname,
          roleIds: [platformAdminRole.id],
          accountIds: [],
          entityIds: []
        }
      } else {
        // Accounts selection: invite the user to N existing accounts with the chosen ACCOUNT-scoped roles.
        finalPayload = {
          email: data.email,
          firstname: data.firstname,
          lastname: data.lastname,
          roleIds: data.roleIds ?? [],
          accountIds: data.accountIds ?? [],
          entityIds: []
        }
      }
    } else {
      finalPayload = {
        email: data.email,
        firstname: data.firstname,
        lastname: data.lastname,
        roleIds: data.roleIds,
        entityIds: data.entityIds,
        accountIds: data.isDirectlyLinked && accountId ? [accountId] : []
      }
    }

    try {
      await inviteUser.submitAsync(finalPayload)
      refreshInvitations()
      form.reset()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to invite user:', error)
    }
  }

  const emailValue = form.watch('email')
  const entityIdsValue = form.watch('entityIds') ?? []
  const isDirectlyLinkedValue = form.watch('isDirectlyLinked')
  const isPlatformAccessValue = form.watch('isPlatformAccess')
  const accountIdsValue = form.watch('accountIds') ?? []
  const roleIdsValue = form.watch('roleIds') ?? []

  const showSummary = !!emailValue && (isPlatformAllMode ? isPlatformAccessValue || accountIdsValue.length > 0 : isDirectlyLinkedValue || entityIdsValue.length > 0)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          form.reset()
          setSearchEntities('')
          setSearchRoles('')
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{tAccount('users.tk_invite-new-user_')}</DialogTitle>
          <DialogDescription>
            {isPlatformAllMode
              ? tAccount('dialogs.inviteUser.tk_description-platform_')
              : isAccountAdminFlow
                ? tAccount('users.tk_invite-description_')
                : `Inviting to: ${targetEntities.map((e) => e.name).join(' · ')}`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5 mt-4">
            {/* A — Who? */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('dialogs.inviteUser.tk_section-who_')}</p>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FloatingLabelInput label={tCommon('user.tk_email_')} type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstname"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('user.tk_firstName_')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastname"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('user.tk_lastName_')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* B — Access scope (compact unified list).
                  Three mode branches:
                    • PLATFORM_ALL  : Search accounts + "Platform access" tile + accounts grid
                    • account-admin : Search entities + "Account access" tile + entities grid (current)
                    • entity-admin  : Locked managed-entities pills (current)
                  Mutual exclusion in PLATFORM mode: selecting any account auto-deselects Platform
                  access; selecting Platform access auto-clears the accounts list. */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('dialogs.inviteUser.tk_section-access-scope_')}</p>

              {isPlatformAllMode ? (
                <>
                  <CompactSearch placeholder={tAccount('dialogs.inviteUser.tk_search-accounts_')} value={searchAccounts} onChange={setSearchAccounts} />

                  <div className="max-h-[212px] overflow-y-auto rounded-sm border border-border p-1.5">
                    {isLoadingAccounts ? (
                      <div className="grid grid-cols-2 gap-1.5 opacity-25">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="skeleton-shimmer-orange h-[62px] rounded-sm" />
                        ))}
                      </div>
                    ) : (
                      <FormField
                        control={form.control}
                        name="isPlatformAccess"
                        render={({ field: platField }) => (
                          <FormField
                            control={form.control}
                            name="accountIds"
                            render={({ field: accField }) => {
                              const accounts = accountsData?.items ?? []
                              const accIds: string[] = accField.value ?? []
                              return (
                                <div data-testid="invite-access-scope-platform" className="flex flex-col gap-1.5" role="listbox" aria-label="Select access scope">
                                  <button
                                    type="button"
                                    data-testid="invite-platform-access"
                                    onClick={() => {
                                      const next = !platField.value
                                      platField.onChange(next)
                                      // Mutually exclusive — turning on Platform access clears any account selection
                                      // and auto-locks the role to platform-admin (handleSubmit also enforces this).
                                      if (next) {
                                        accField.onChange([])
                                        if (platformAdminRole) form.setValue('roleIds', [platformAdminRole.id], { shouldValidate: true })
                                      } else {
                                        form.setValue('roleIds', [], { shouldValidate: true })
                                      }
                                    }}
                                    className={cn(
                                      'cursor-pointer flex items-center gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors w-full',
                                      platField.value ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                    )}
                                  >
                                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                      <Globe className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-bold text-foreground leading-tight">{tAccount('dialogs.inviteUser.tk_platform-access_')}</div>
                                      <div className="text-[11px] text-muted-foreground mt-0.5">{tAccount('dialogs.inviteUser.tk_platform-access-sub_')}</div>
                                    </div>
                                  </button>
                                  {accounts.length === 0 && searchAccounts ? (
                                    <div className="flex h-[46px] items-center justify-center rounded-sm border border-dashed border-border bg-muted/40 px-3 text-center text-[11px] text-muted-foreground">
                                      {tAccount('dialogs.inviteUser.tk_no-accounts-match_', { search: searchAccounts })}
                                    </div>
                                  ) : accounts.length > 0 ? (
                                    <div data-testid="invite-accounts-list" className="grid grid-cols-2 gap-1.5">
                                      {accounts.map((a) => {
                                        const selected = accIds.includes(a.id)
                                        return (
                                          <button
                                            key={a.id}
                                            type="button"
                                            data-testid="invite-account-tile"
                                            onClick={() => {
                                              const next = selected ? accIds.filter((id) => id !== a.id) : [...accIds, a.id]
                                              accField.onChange(next)
                                              // Mutually exclusive — picking an account turns off Platform access.
                                              if (next.length > 0 && platField.value) platField.onChange(false)
                                            }}
                                            className={cn(
                                              'cursor-pointer flex items-start gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors',
                                              selected ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                            )}
                                          >
                                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                                              <Building2 className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="min-w-0">
                                              <div className="text-[12px] font-bold text-foreground leading-tight truncate">{a.name}</div>
                                              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tAccount('dialogs.inviteUser.tk_account-target-sub_')}</div>
                                            </div>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            }}
                          />
                        )}
                      />
                    )}
                  </div>
                </>
              ) : isAccountAdminFlow ? (
                <>
                  <CompactSearch placeholder={tAccount('dialogs.inviteUser.tk_search-entities_')} value={searchEntities} onChange={setSearchEntities} />

                  {/* Account access full-row, entities 2 cols, fits content up to max 3 tile rows */}
                  <div className="max-h-[212px] overflow-y-auto rounded-sm border border-border p-1.5">
                    {isLoadingEntities ? (
                      <div className="grid grid-cols-2 gap-1.5 opacity-25">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="skeleton-shimmer-orange h-[62px] rounded-sm" />
                        ))}
                      </div>
                    ) : (
                      <FormField
                        control={form.control}
                        name="isDirectlyLinked"
                        render={({ field: accField }) => (
                          <FormField
                            control={form.control}
                            name="entityIds"
                            render={({ field: entField }) => {
                              const entities = entitiesData?.items || []
                              const entIds: string[] = entField.value || []
                              const getEntityIcon = (type?: string | null) => {
                                if (type === 'ASSOCIATION') return <Users className="h-3.5 w-3.5" />
                                if (type === 'COMMUNITY') return <Globe className="h-3.5 w-3.5" />
                                return <Building2 className="h-3.5 w-3.5" />
                              }
                              return (
                                <div data-testid="invite-access-scope" className="flex flex-col gap-1.5" role="listbox" aria-label="Select access scope">
                                  {hasPermission('USER_ACCOUNTS_INVITATION') && (
                                    <button
                                      type="button"
                                      data-testid="invite-account-access"
                                      onClick={() => accField.onChange(!accField.value)}
                                      className={cn(
                                        'cursor-pointer flex items-center gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors w-full',
                                        accField.value ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                      )}
                                    >
                                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                        <Shield className="h-3.5 w-3.5" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="text-[12px] font-bold text-foreground leading-tight">{tAccount('dialogs.inviteUser.tk_account-access_')}</div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">{tAccount('dialogs.inviteUser.tk_account-access-sub_')}</div>
                                      </div>
                                    </button>
                                  )}
                                  {entities.length === 0 && searchEntities ? (
                                    <div className="flex h-[46px] items-center justify-center rounded-sm border border-dashed border-border bg-muted/40 px-3 text-center text-[11px] text-muted-foreground">
                                      No entity matches “{searchEntities}”. Try another keyword.
                                    </div>
                                  ) : entities.length > 0 ? (
                                    <div data-testid="invite-entities-list" className="grid grid-cols-2 gap-1.5">
                                      {entities.map((entity) => {
                                        const selected = entIds.includes(entity.id)
                                        const orgName = entity.organization?.name
                                        return (
                                          <button
                                            key={entity.id}
                                            type="button"
                                            data-testid="invite-entity-tile"
                                            onClick={() => entField.onChange(selected ? entIds.filter((id) => id !== entity.id) : [...entIds, entity.id])}
                                            className={cn(
                                              'cursor-pointer flex items-start gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors',
                                              selected ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                            )}
                                          >
                                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                                              {getEntityIcon((entity.organization as { type?: string } | null)?.type)}
                                            </div>
                                            <div className="min-w-0">
                                              <div className="text-[12px] font-bold text-foreground leading-tight truncate">{orgName || entity.name}</div>
                                              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tAccount('dialogs.inviteUser.tk_entity-access-sub_')}</div>
                                            </div>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            }}
                          />
                        )}
                      />
                    )}
                  </div>
                </>
              ) : (
                /* Entity-admin: locked, just show their entities as pills */
                <div className="rounded-sm border border-primary/25 bg-primary/8 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-foreground">{tAccount('dialogs.inviteUser.tk_will-be-linked-to_')}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">pre-selected</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {targetEntities.map((e) => (
                      <span key={e.id} className="rounded-[2px] bg-primary/20 border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {e.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{tAccount('dialogs.inviteUser.tk_at-least-one-access_')}</p>
            </div>

            {/* C — Roles */}
            {hasPermission('USER_ROLE_ALLOCATION') && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('dialogs.inviteUser.tk_section-roles_')}</p>
                <FormField
                  control={form.control}
                  name="roleIds"
                  render={({ field }) => (
                    <FormItem>
                      <div className="mb-2">
                        <CompactSearch placeholder={tAccount('dialogs.inviteUser.tk_search-roles_')} value={searchRoles} onChange={setSearchRoles} />
                      </div>
                      <div className="max-h-[140px] overflow-y-auto rounded-sm border border-border p-1.5" data-testid="roles-filter">
                        {(() => {
                          // Filter roles by the scopes available to the current selection.
                          // PLATFORM_ALL mode:
                          //   • Platform access → only the platform-admin row (locked on)
                          //   • Accounts picked → ACCOUNT-scoped roles (no ENTITY, no PLATFORM)
                          //   • Neither         → empty state
                          // Account-admin mode:
                          //   • Account access selected → ACCOUNT-scoped roles
                          //   • Entities selected       → ENTITY-scoped roles
                          const allowAccountScoped = isPlatformAllMode ? accountIdsValue.length > 0 : isDirectlyLinkedValue
                          const allowEntityScoped = isPlatformAllMode ? false : entityIdsValue.length > 0 || (!isAccountAdminFlow && targetEntities.length > 0)
                          const visibleRoles = (rolesData?.items ?? []).filter((r) => {
                            if (r.name.toLowerCase() === 'guest') return false
                            if (r.scope === 'PLATFORM') return isPlatformAllMode && isPlatformAccessValue && r.name === 'platform-admin'
                            if (r.scope === 'ACCOUNT') return allowAccountScoped
                            if (r.scope === 'ENTITY') return allowEntityScoped
                            return false
                          })

                          if (isLoadingRoles) {
                            return (
                              <div className="grid grid-cols-2 gap-1.5 opacity-25">
                                {Array.from({ length: 2 }).map((_, i) => (
                                  <Skeleton key={i} className="skeleton-shimmer-orange h-[62px] rounded-sm" />
                                ))}
                              </div>
                            )
                          }

                          if (visibleRoles.length === 0) {
                            return (
                              <div className="flex h-[46px] items-center justify-center rounded-sm border border-dashed border-border bg-muted/40 px-3 text-center text-[11px] text-muted-foreground">
                                {!allowAccountScoped && !allowEntityScoped
                                  ? tAccount('dialogs.inviteUser.tk_pick-scope-first_')
                                  : searchRoles
                                    ? `No role matches “${searchRoles}”.`
                                    : 'No roles available for the selected scope.'}
                              </div>
                            )
                          }

                          return (
                            <div className="grid grid-cols-2 gap-1.5" role="listbox" aria-label="Select roles">
                              {visibleRoles.map((role) => {
                                const selected = (field.value || []).includes(role.id)
                                const roleKey = role.name?.toLowerCase()
                                const knownKeys = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
                                const isBuiltIn = role.isSystem && knownKeys.includes(roleKey)
                                const displayName = isBuiltIn ? tAccount(`roles.builtin.tk_${roleKey.replace('-', '_')}_`) : role.name
                                const displayDescription = isBuiltIn ? tAccount(`roles.builtin.tk_${roleKey.replace('-', '_')}-description_`) : role.description
                                const hasDesc = !!displayDescription
                                return (
                                  <button
                                    key={role.id}
                                    type="button"
                                    data-testid="invite-role-tile"
                                    onClick={() => {
                                      const current = field.value || []
                                      field.onChange(selected ? current.filter((id: number) => id !== role.id) : [...current, role.id])
                                    }}
                                    className={cn(
                                      'cursor-pointer flex gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors',
                                      hasDesc ? 'items-start' : 'items-center',
                                      selected ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                    )}
                                  >
                                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-primary/12 text-primary">
                                      {role.name?.toLowerCase().includes('admin') ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserIcon className="h-3.5 w-3.5" />}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <div className="text-[12px] font-bold text-foreground capitalize leading-tight truncate">{displayName}</div>
                                        <span
                                          className={cn(
                                            'flex-shrink-0 rounded-[2px] border px-1 py-0 text-[9px] font-bold uppercase tracking-wider',
                                            role.scope === 'ACCOUNT' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-amber-500/15 text-amber-500 border-amber-500/25'
                                          )}
                                        >
                                          {role.scope}
                                        </span>
                                      </div>
                                      {hasDesc && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{displayDescription}</div>}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{tAccount('dialogs.inviteUser.tk_roles-scope-hint_')}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* D — Summary */}
            {showSummary && (
              <div className="rounded-sm border border-primary/20 bg-primary/6 p-3 space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary">D — Summary</p>
                <p className="text-xs text-foreground">
                  Inviting: <span className="font-semibold">{emailValue}</span>
                </p>
                {isDirectlyLinkedValue && (
                  <p className="text-xs text-muted-foreground">
                    Access: <span className="text-foreground">Account + {entityIdsValue.length > 0 ? `${entityIdsValue.length} entities` : 'all entities'}</span>
                  </p>
                )}
                {!isDirectlyLinkedValue && entityIdsValue.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Access:{' '}
                    <span className="text-foreground">
                      {entityIdsValue.length} {entityIdsValue.length === 1 ? 'entity' : 'entities'}
                    </span>
                  </p>
                )}
                {roleIdsValue.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Roles: <span className="text-foreground">{roleIdsValue.length} selected</span>
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <WaveButton type="submit" disabled={inviteUser.isLoading}>
                <Mail className="h-3.5 w-3.5" />
                {inviteUser.isLoading ? tCommon('actions.tk_loading_') : tAccount('users.tk_invite-new-user_')}
              </WaveButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
