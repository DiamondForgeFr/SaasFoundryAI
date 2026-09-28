/**
 * Resources
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Globe, ImagePlus, Users, X } from 'lucide-react'

/**
 * Dependencies
 */
import { useEntityUpdate } from '@/hooks/api/entities/mutations/useEntityUpdate'
import { useOrganizationLogoUpload } from '@/hooks/api/organizations/mutations/useOrganizationLogoUpload'

/**
 * Components
 */
import { cn } from '@/utils/ui'
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Switch } from '@/components/ui/shadcn/switch'
import { Textarea } from '@/components/ui/shadcn/textarea'

export type EditEntityTarget = {
  id: string
  accountId: string
  name: string
  description: string | null
  isActive: boolean
  organization: {
    id: string
    name: string
    type: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
    description: string | null
    website: string | null
    logoUrl?: string | null
  } | null
}

type EditEntityDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  entity: EditEntityTarget | null
}

const ORG_TYPES = [
  { value: 'COMPANY', tk: 'organizations.tk_type-company_', subTk: 'organizations.tk_type-company-sub_', icon: Building2 },
  { value: 'ASSOCIATION', tk: 'organizations.tk_type-association_', subTk: 'organizations.tk_type-association-sub_', icon: Users },
  { value: 'COMMUNITY', tk: 'organizations.tk_type-community_', subTk: 'organizations.tk_type-community-sub_', icon: Globe }
] as const

/**
 * Edit an existing entity. Layout mirrors the create dialog one-for-one (type tiles → name →
 * logo+description grid → website) so users can move between create and edit without
 * relearning the form. Two edit-only additions:
 *
 *   - **Status pill**: same affordance as the entity card's active/inactive switch — the
 *     "dedicated button" to toggle activation.
 *   - **Logo preview**: current logo shows in the dropzone; uploading a new file replaces it
 *     after the entity update succeeds.
 *
 * The single "name" input writes back to BOTH `entity.name` and `organization.name`. They
 * are stored separately in the schema but the UX treats them as one — matching create.
 */
export function EditEntityDialog({ isOpen, onOpenChange, entity }: EditEntityDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const updateEntity = useEntityUpdate()
  const uploadLogo = useOrganizationLogoUpload()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [orgType, setOrgType] = useState<'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'>('COMPANY')
  const [orgWebsite, setOrgWebsite] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  // `localLogoPreview` is set only when the user picks a new file; the existing logoUrl
  // shown otherwise is the canonical URL coming from the API.
  const [localLogoPreview, setLocalLogoPreview] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen || !entity) return
    setName(entity.organization?.name ?? entity.name)
    setDescription(entity.organization?.description ?? entity.description ?? '')
    setIsActive(entity.isActive)
    if (entity.organization) {
      setOrgType(entity.organization.type)
      setOrgWebsite(entity.organization.website ?? '')
    } else {
      setOrgType('COMPANY')
      setOrgWebsite('')
    }
    setLogoFile(null)
    setLocalLogoPreview(null)
    setSubmitError(null)
  }, [isOpen, entity])

  const isValid = name.trim().length >= 2 && name.trim().length <= 100
  const isLoading = updateEntity.isLoading || uploadLogo.isLoading

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setLocalLogoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleRemoveStagedLogo = () => {
    setLogoFile(null)
    setLocalLogoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (!entity || !isValid) return
    setSubmitError(null)
    try {
      const trimmedName = name.trim()
      await updateEntity.mutateAsync({
        entityId: entity.id,
        accountId: entity.accountId,
        name: trimmedName,
        description: description.trim() || null,
        isActive,
        organization: entity.organization
          ? {
              name: trimmedName,
              type: orgType,
              description: description.trim() || null,
              website: orgWebsite.trim() || null
            }
          : undefined
      })
      // Logo upload runs BEFORE closing so any failure surfaces to the user (instead of
      // silently leaving `organization.logoUrl` null in DB while the entity edits persist).
      if (logoFile && entity.organization?.id) {
        try {
          await uploadLogo.submitAsync({ organizationId: entity.organization.id, file: logoFile })
        } catch (logoError) {
          console.error('Failed to upload logo', logoError)
          setSubmitError(logoError instanceof Error ? logoError.message : 'Logo upload failed — entity changes were saved, please retry the logo upload.')
          return
        }
      }
      onOpenChange(false)
    } catch (e) {
      console.error('Failed to update entity', e)
      setSubmitError(e instanceof Error ? e.message : 'Failed to update entity')
    }
  }

  const currentLogoUrl = entity?.organization?.logoUrl ?? null
  const previewUrl = localLogoPreview ?? currentLogoUrl

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{tAccount('entities.tk_edit-title_')}</DialogTitle>
          <DialogDescription>{tAccount('entities.tk_edit-description_')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {entity?.organization ? (
            <div data-testid="organization-details" className="space-y-4">
              {/* 1 — Status pill — placed at the very top so the most consequential action
                  (de/activating the entity) is always within thumb reach and can't be missed. */}
              <label
                className={cn(
                  'flex items-center justify-between gap-3 rounded-sm border bg-card px-3 py-2.5 cursor-pointer select-none transition-colors',
                  isActive ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-bold text-foreground uppercase tracking-wider">{tAccount('entities.edit.tk_active_')}</span>
                  <span className="text-[11px] text-muted-foreground">{tAccount(isActive ? 'entities.edit.tk_active-on_' : 'entities.edit.tk_active-off_')}</span>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                    isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  <Switch
                    checked={isActive}
                    onCheckedChange={setIsActive}
                    className={cn(
                      '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                      isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                    )}
                  />
                  <span>{tAccount(isActive ? 'entities.edit.tk_toggle-on_' : 'entities.edit.tk_toggle-off_')}</span>
                </span>
              </label>

              {/* 2 — Type — visual cards (same layout as create) */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tCommon('other.tk_type_')}</span>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {ORG_TYPES.map(({ value, tk, subTk, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOrgType(value)}
                      className={cn(
                        'cursor-pointer flex flex-col items-center gap-1.5 rounded-sm border p-3 text-center transition-all',
                        orgType === value ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-semibold">{tAccount(tk)}</span>
                      <span className="text-[10px] opacity-70">{tAccount(subTk)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 3 — Name (single field — drives both entity.name and organization.name) */}
              <FloatingLabelInput label={tCommon('other.tk_name_')} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />

              {/* 4 — Logo + Description side-by-side (matches create) */}
              <div className="grid grid-cols-2 gap-3">
                {/* Logo column — shows existing logo unless user picked a new file */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tAccount('organizations.tk_logo_')}</span>
                  {previewUrl ? (
                    <div className="flex h-24 items-center gap-3 rounded-sm border border-border bg-secondary px-3">
                      <img src={previewUrl} alt="Logo preview" className="h-16 w-16 rounded-sm border border-border object-cover" />
                      {localLogoPreview ? (
                        <button
                          type="button"
                          onClick={handleRemoveStagedLogo}
                          className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                          {tAccount('organizations.tk_logo-remove_')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          {tAccount('organizations.tk_logo-replace_')}
                        </button>
                      )}
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
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tCommon('other.tk_description_')}</span>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="resize-none h-24" maxLength={255} />
                </div>
              </div>

              {/* 5 — Website (full width) */}
              <FloatingLabelInput
                label={tCommon('other.tk_website_')}
                type="text"
                inputMode="url"
                autoComplete="url"
                value={orgWebsite}
                onChange={(e) => setOrgWebsite(e.target.value)}
                maxLength={100}
              />
            </div>
          ) : (
            // Fallback for entities without an organization profile — status + entity name + description.
            <div className="space-y-3">
              <label
                className={cn(
                  'flex items-center justify-between gap-3 rounded-sm border bg-card px-3 py-2.5 cursor-pointer select-none transition-colors',
                  isActive ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-bold text-foreground uppercase tracking-wider">{tAccount('entities.edit.tk_active_')}</span>
                  <span className="text-[11px] text-muted-foreground">{tAccount(isActive ? 'entities.edit.tk_active-on_' : 'entities.edit.tk_active-off_')}</span>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
                    isActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  <Switch
                    checked={isActive}
                    onCheckedChange={setIsActive}
                    className={cn(
                      '!h-3 !w-6 [&>span]:!h-2 [&>span]:!w-2 [&>span]:data-[state=checked]:!translate-x-3 [&>span]:data-[state=unchecked]:!translate-x-0',
                      isActive ? 'data-[state=checked]:!bg-emerald-500' : 'data-[state=unchecked]:!bg-muted-foreground/40'
                    )}
                  />
                  <span>{tAccount(isActive ? 'entities.edit.tk_toggle-on_' : 'entities.edit.tk_toggle-off_')}</span>
                </span>
              </label>
              <FloatingLabelInput label={tCommon('other.tk_name_')} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={tAccount('entities.edit.tk_description-placeholder_')}
                className="text-sm min-h-[60px]"
                maxLength={255}
              />
            </div>
          )}
        </div>

        {submitError && <p className="text-[12px] text-destructive mt-3">{submitError}</p>}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-[2px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {tCommon('actions.tk_cancel_')}
          </button>
          <WaveButton type="button" disabled={!isValid || isLoading} onClick={handleSubmit}>
            {isLoading ? tCommon('actions.tk_loading_') : tAccount('entities.edit.tk_submit_')}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
