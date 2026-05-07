/**
 * Ressources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Globe, Mail, Search, Shield, ShieldCheck, User as UserIcon, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { useInviteUser, useInviteUserSchema } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import { useAccountEntities } from '@/hooks/api/accounts/queries/useAccountEntities'
import { useAccountRoles } from '@/hooks/api/accounts/queries/useAccountRoles'
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
  // Create extended schema based on existing API schema
  const baseInviteSchema = useInviteUserSchema()
  const formSchemaBase = baseInviteSchema.payload.extend({
    isDirectlyLinked: z.boolean()
  })
  const formSchema = formSchemaBase.refine(
    (data) => {
      // At least one entity or direct link must be selected
      return data.isDirectlyLinked || (data.entityIds && data.entityIds.length > 0)
    },
    {
      message: tCommon('fields.errors.tk_minOneEntityOrDirectLink_'),
      path: ['entityIds']
    }
  )

  type FormValues = z.infer<typeof formSchemaBase>

  const queryClient = useQueryClient()
  const [searchRoles, setSearchRoles] = useState('')
  const [searchEntities, setSearchEntities] = useState('')
  const { t: tAccount } = useTranslation('account')
  const { hasPermission } = useModuleAccess()
  const { isAccountAdmin, managedEntities } = useAdminScope()

  // Get accountId from authMe
  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const accountId = activeAccount?.id

  // Get roles and entities
  const { data: rolesData, isLoading: isLoadingRoles } = useAccountRoles(accountId as string, {
    search: searchRoles,
    limit: 10
  })

  const { data: entitiesData, isLoading: isLoadingEntities } = useAccountEntities(accountId as string, {
    search: searchEntities,
    limit: 10
  })

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
      accountIds: []
    }
  })

  const handleSubmit = async (data: FormValues) => {
    const finalPayload: InviteUserPayloadDto = {
      email: data.email,
      firstname: data.firstname,
      lastname: data.lastname,
      roleIds: data.roleIds,
      entityIds: data.entityIds,
      accountIds: data.isDirectlyLinked && accountId ? [accountId] : []
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
  const roleIdsValue = form.watch('roleIds') ?? []

  const showSummary = !!emailValue && (isDirectlyLinkedValue || entityIdsValue.length > 0)

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
      <DialogContent className="glow-card sm:max-w-[620px] overflow-visible">
        <div className="igw-glow" aria-hidden="true" />
        <div className="igw-border" aria-hidden="true" />
        <div className="relative z-10">
          <DialogHeader>
            <DialogTitle>{tAccount('users.tk_invite-new-user_')}</DialogTitle>
            <DialogDescription>{isAccountAdmin ? tAccount('users.tk_invite-description_') : `Inviting to: ${managedEntities.map((e) => e.name).join(' · ')}`}</DialogDescription>
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

              {/* B — Access scope (compact unified list) */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('dialogs.inviteUser.tk_section-access-scope_')}</p>

                {isAccountAdmin ? (
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
                                          const hasSubtitle = orgName && entity.name !== orgName
                                          return (
                                            <button
                                              key={entity.id}
                                              type="button"
                                              data-testid="invite-entity-tile"
                                              onClick={() => entField.onChange(selected ? entIds.filter((id) => id !== entity.id) : [...entIds, entity.id])}
                                              className={cn(
                                                'cursor-pointer flex gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors',
                                                hasSubtitle ? 'items-start' : 'items-center',
                                                selected ? 'border-primary bg-primary/8' : 'border-border bg-secondary hover:border-primary/40'
                                              )}
                                            >
                                              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                                                {getEntityIcon((entity.organization as { type?: string } | null)?.type)}
                                              </div>
                                              <div className="min-w-0">
                                                <div className="text-[12px] font-bold text-foreground leading-tight truncate">{orgName || entity.name}</div>
                                                {hasSubtitle && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{entity.name}</div>}
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
                      {managedEntities.map((e) => (
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
                          {isLoadingRoles ? (
                            <div className="grid grid-cols-2 gap-1.5 opacity-25">
                              {Array.from({ length: 2 }).map((_, i) => (
                                <Skeleton key={i} className="skeleton-shimmer-orange h-[62px] rounded-sm" />
                              ))}
                            </div>
                          ) : (rolesData?.items.filter((r) => r.name.toLowerCase() !== 'guest').length ?? 0) === 0 ? (
                            <div className="flex h-[46px] items-center justify-center rounded-sm border border-dashed border-border bg-muted/40 px-3 text-center text-[11px] text-muted-foreground">
                              {searchRoles ? `No role matches “${searchRoles}”. Try another keyword.` : 'No roles available.'}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1.5" role="listbox" aria-label="Select roles">
                              {rolesData?.items
                                .filter((r) => r.name.toLowerCase() !== 'guest')
                                .map((role) => {
                                  const selected = (field.value || []).includes(role.id)
                                  const roleKey = role.name?.toLowerCase()
                                  const isBuiltIn = roleKey === 'guest' || roleKey === 'user' || roleKey === 'admin'
                                  const displayName = isBuiltIn ? tAccount(`roles.builtin.tk_${roleKey}_`) : role.name
                                  const displayDescription = isBuiltIn ? tAccount(`roles.builtin.tk_${roleKey}-description_`) : role.description
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
                                        <div className="text-[12px] font-bold text-foreground capitalize leading-tight truncate">{displayName}</div>
                                        {hasDesc && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{displayDescription}</div>}
                                      </div>
                                    </button>
                                  )
                                })}
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{tAccount('dialogs.inviteUser.tk_roles-account-scoped_')}</p>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
