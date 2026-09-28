/**
 * Ressources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Globe, ImagePlus, Users, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { useCreateOwnEntity } from '@/hooks/api/entities/mutations/useCreateOwnEntity'
import { useEntityCreate, useEntityCreateSchema } from '@/hooks/api/entities/mutations/useEntityCreate'
import { useOrganizationLogoUpload } from '@/hooks/api/organizations/mutations/useOrganizationLogoUpload'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'

/**
 * Components
 */
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/shadcn/form'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { cn } from '@/utils/ui'

/**
 * Types
 */
import type { MeResponseDto } from '@/hooks/api/auth'

type CreateEntityDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Optional callback fired with the freshly-created entity id (drives the entity-admin scope switch). */
  onCreated?: (entityId: string) => void
}

/**
 * Single create-entity dialog used by both account-admins and entity-admins.
 *
 * Same form (Type · Name · Logo · Description · Website), branching only on which mutation runs:
 *   - account-admin path: `useEntityCreate` → `POST /entities` (ENTITY_CREATION).
 *   - entity-admin path : `useCreateOwnEntity` → `POST /entities/own` (ENTITY_OWN_CREATE on the
 *     MULTI_ENTITY_MANAGEMENT module, auto-binds the creator as entity-admin on the new entity).
 *
 * The mutation choice is permission-driven: ENTITY_CREATION wins when present (account-admins),
 * otherwise we fall back to the own-create endpoint.
 */
export function CreateEntityDialog({ isOpen, onOpenChange, onCreated }: CreateEntityDialogProps) {
  const queryClient = useQueryClient()
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const { hasPermission } = useModuleAccess()
  const { activeEntity, managedEntities } = useAdminScope()

  // Get accountId — account-admin path resolves via authMe.accounts (their UserAccountLink);
  // entity-admin path has no UserAccountLink so we fall back to the active entity's parent account.
  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const accountId = activeAccount?.id ?? activeEntity?.accountId ?? managedEntities[0]?.accountId

  // Pick the mutation based on what the actor is actually allowed to call. Account-admins keep the
  // regular ENTITY_CREATION endpoint; entity-admins (who lack ENTITY_CREATION but carry
  // ENTITY_OWN_CREATE once MULTI_ENTITY_MANAGEMENT is on) get the own-create endpoint instead.
  const useOwnFlow = !hasPermission('ENTITY_CREATION') && hasPermission('ENTITY_OWN_CREATE')
  const createEntity = useEntityCreate()
  const createOwnEntity = useCreateOwnEntity()
  const uploadLogo = useOrganizationLogoUpload()

  // Logo file state
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { payload: formSchema } = useEntityCreateSchema()
  type FormValues = z.infer<typeof formSchema>

  // `website` carries a Zod `.transform()` (prefixes https://), so the schema's input and output
  // types diverge. Our shared FormField only forwards two generics, so we collapse the resolver's
  // input/output to FormValues — the runtime transform still runs, only the static type is unified.
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      accountId: accountId,
      organization: {
        name: '',
        type: 'COMPANY',
        description: '',
        website: ''
      }
    }
  })

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (data: FormValues) => {
    setSubmitError(null)
    try {
      // The schema's `description` field is `.optional()` (not nullable), so empty string would
      // get rejected on the own-create endpoint. Normalise to undefined for both flows.
      const orgDescription = data.organization?.description?.trim() || undefined
      const orgWebsite = data.organization?.website?.trim() || undefined
      const orgName = data.organization?.name ?? ''
      let createdId: string
      let createdOrganizationId: string | undefined
      if (useOwnFlow) {
        const res = await createOwnEntity.mutateAsync({
          accountId: data.accountId,
          organization: {
            name: orgName,
            type: data.organization!.type,
            ...(orgDescription !== undefined ? { description: orgDescription } : {}),
            ...(orgWebsite !== undefined ? { website: orgWebsite } : {})
          }
        })
        createdId = res.id
        createdOrganizationId = res.organization?.id
      } else {
        const res = await createEntity.submitAsync({ ...data })
        createdId = res.id
        createdOrganizationId = res.organization?.id
      }
      await queryClient.invalidateQueries({ queryKey: ['account', accountId, 'entities'] })

      // Logo upload runs BEFORE closing the dialog so any failure surfaces inline and the
      // user can retry without losing their context. The previous "best-effort, fire-and-forget"
      // pattern silently dropped errors and left `organization.logoUrl` null in DB even when
      // the user thought the upload succeeded.
      if (logoFile && createdOrganizationId) {
        try {
          await uploadLogo.submitAsync({
            organizationId: createdOrganizationId,
            file: logoFile
          })
          await queryClient.invalidateQueries({ queryKey: ['account', accountId, 'entities'] })
        } catch (logoError) {
          console.error('Failed to upload logo:', logoError)
          setSubmitError(logoError instanceof Error ? logoError.message : 'Logo upload failed — entity was created, please retry the logo from the edit dialog.')
          return
        }
      }

      // Both entity + logo persisted — safe to close.
      form.reset()
      handleRemoveLogo()
      onOpenChange(false)
      onCreated?.(createdId)
    } catch (error) {
      console.error('Failed to create entity:', error)
      setSubmitError(error instanceof Error ? error.message : 'Failed to create entity')
    }
  }

  // Reset form when dialog is closed
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      form.reset()
      handleRemoveLogo()
    }
    onOpenChange(open)
  }

  const isLoading = createEntity.isLoading || createOwnEntity.isLoading || uploadLogo.isLoading
  // Either ENTITY_CREATION (account-admin) or ENTITY_OWN_CREATE (entity-admin, gated by module
  // activation) is enough to render the form. ORGANIZATION_CREATION is part of the account-admin
  // bundle; the own-create endpoint creates the org server-side regardless of the actor's frontend
  // perm set.
  const canRenderForm = (hasPermission('ENTITY_CREATION') && hasPermission('ORGANIZATION_CREATION')) || hasPermission('ENTITY_OWN_CREATE')

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{tAccount('entities.tk_create-entity_')}</DialogTitle>
          <DialogDescription>{tAccount('entities.tk_create-entity-description_')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => form.handleSubmit(handleSubmit)(e)} className="space-y-5 mt-4">
            {canRenderForm && (
              <div data-testid="organization-details" className="space-y-4">
                {/* 1 — Type — visual cards */}
                <FormField
                  control={form.control}
                  name="organization.type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tCommon('other.tk_type_')}</FormLabel>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        {(
                          [
                            { value: 'COMPANY', label: tAccount('organizations.tk_type-company_'), sub: tAccount('organizations.tk_type-company-sub_'), icon: <Building2 className="h-5 w-5" /> },
                            {
                              value: 'ASSOCIATION',
                              label: tAccount('organizations.tk_type-association_'),
                              sub: tAccount('organizations.tk_type-association-sub_'),
                              icon: <Users className="h-5 w-5" />
                            },
                            { value: 'COMMUNITY', label: tAccount('organizations.tk_type-community_'), sub: tAccount('organizations.tk_type-community-sub_'), icon: <Globe className="h-5 w-5" /> }
                          ] as const
                        ).map(({ value, label, sub, icon }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => field.onChange(value)}
                            className={cn(
                              'cursor-pointer flex flex-col items-center gap-1.5 rounded-sm border p-3 text-center transition-all',
                              field.value === value ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground'
                            )}
                          >
                            {icon}
                            <span className="text-xs font-semibold">{label}</span>
                            <span className="text-[10px] opacity-70">{sub}</span>
                          </button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 2 — Name */}
                <FormField
                  control={form.control}
                  name="organization.name"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('other.tk_name_')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 3 — Logo + Description side-by-side (aligned heights) */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Logo column */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tAccount('organizations.tk_logo_')}</span>
                    {logoPreview ? (
                      <div className="flex h-24 items-center gap-3 rounded-sm border border-border bg-secondary px-3">
                        <img src={logoPreview} alt="Logo preview" className="h-16 w-16 rounded-sm border border-border object-cover" />
                        <button type="button" onClick={handleRemoveLogo} className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="cursor-pointer flex h-24 w-full flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        <ImagePlus className="h-5 w-5" />
                        <span className="text-[11px] font-medium">{tAccount('organizations.tk_logo-dropzone_')}</span>
                        <span className="text-[10px] text-muted-foreground/60">{tAccount('organizations.tk_logo-formats_')}</span>
                      </button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={handleLogoChange} className="hidden" />
                  </div>

                  {/* Description column — same vertical structure */}
                  <FormField
                    control={form.control}
                    name="organization.description"
                    render={({ field }) => (
                      <FormItem className="flex flex-col gap-2 space-y-0">
                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tCommon('other.tk_description_')}</FormLabel>
                        <FormControl>
                          <Textarea {...field} className="resize-none h-24" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 4 — Website (full width — accepts www. or full https://) */}
                <FormField
                  control={form.control}
                  name="organization.website"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('other.tk_website_')} type="text" inputMode="url" autoComplete="url" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {submitError && <p className="text-[12px] text-destructive">{submitError}</p>}

            <DialogFooter>
              <WaveButton type="submit" disabled={isLoading}>
                {isLoading ? tCommon('actions.tk_loading_') : tCommon('actions.tk_create_')}
              </WaveButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
