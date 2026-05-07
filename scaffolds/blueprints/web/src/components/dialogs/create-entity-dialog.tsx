/**
 * Ressources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Globe, ImagePlus, Users, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { useEntityCreate, useEntityCreateSchema } from '@/hooks/api/entities/mutations/useEntityCreate'
import { useOrganizationLogoUpload } from '@/hooks/api/organizations/mutations/useOrganizationLogoUpload'
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
}

export function CreateEntityDialog({ isOpen, onOpenChange }: CreateEntityDialogProps) {
  const queryClient = useQueryClient()
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const { hasPermission } = useModuleAccess()

  // Get accountId from authMe
  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])!
  const activeAccount = authMe.accounts.find((acc) => acc.isActive)
  const accountId = activeAccount?.id

  // Create entity mutation
  const createEntity = useEntityCreate()
  const uploadLogo = useOrganizationLogoUpload()

  // Logo file state
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { payload: formSchema } = useEntityCreateSchema()
  type FormValues = z.infer<typeof formSchema>

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
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

  const handleSubmit = async (data: FormValues) => {
    try {
      const result = await createEntity.submitAsync({
        ...data
      })

      // Entity created — close dialog and reset form immediately to prevent duplicate submissions
      await queryClient.invalidateQueries({ queryKey: ['account', accountId, 'entities'] })
      form.reset()
      handleRemoveLogo()
      onOpenChange(false)

      // Upload logo after dialog is closed (best-effort, non-blocking)
      if (logoFile && result.organization?.id) {
        try {
          await uploadLogo.submitAsync({
            organizationId: result.organization.id,
            file: logoFile
          })
          await queryClient.invalidateQueries({ queryKey: ['account', accountId, 'entities'] })
        } catch (logoError) {
          console.error('Failed to upload logo:', logoError)
        }
      }
    } catch (error) {
      console.error('Failed to create entity:', error)
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

  const isLoading = createEntity.isLoading || uploadLogo.isLoading

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="glow-card sm:max-w-[700px] overflow-visible">
        <div className="igw-glow" aria-hidden="true" />
        <div className="igw-border" aria-hidden="true" />
        <div className="relative z-10">
          <DialogHeader>
            <DialogTitle>{tAccount('entities.tk_create-entity_')}</DialogTitle>
            <DialogDescription>{tAccount('entities.tk_create-entity-description_')}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={(e) => form.handleSubmit(handleSubmit)(e)} className="space-y-5 mt-4">
              {hasPermission('ENTITY_CREATION') && hasPermission('ORGANIZATION_CREATION') && (
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

              <DialogFooter>
                <WaveButton type="submit" disabled={isLoading}>
                  {isLoading ? tCommon('actions.tk_loading_') : tCommon('actions.tk_create_')}
                </WaveButton>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
