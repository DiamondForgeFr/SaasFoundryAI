/**
 * Resources
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useCreateOwnAccount } from '@/hooks/api/accounts/mutations/useCreateOwnAccount'

/**
 * Components
 */
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Plus } from 'lucide-react'

type CreateOwnAccountDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (accountId: string) => void
  /** Suggested initial name — e.g. "<current account> #<n+1>" for the multi-account flow. */
  defaultName?: string
}

export function CreateOwnAccountDialog({ isOpen, onOpenChange, onCreated, defaultName = '' }: CreateOwnAccountDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const createMutation = useCreateOwnAccount()

  // Lazy initialiser keeps the suggestion fresh on every mount — the parent only renders this
  // component while `isOpen` is true, so each open creates a new component instance with the
  // up-to-date defaultName.
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tAccount('dialogs.createOwnAccount.tk_name-required_'))
      return
    }
    if (trimmed.length > 100) {
      setError(tAccount('dialogs.createOwnAccount.tk_name-too-long_'))
      return
    }
    try {
      const created = await createMutation.mutateAsync({ name: trimmed, description: description.trim() || null })
      setName('')
      setDescription('')
      onOpenChange(false)
      onCreated?.(created.id)
    } catch (err) {
      console.error('Failed to create own account', err)
      setError(tAccount('dialogs.createOwnAccount.tk_submit-error_'))
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setName('')
          setDescription('')
          setError(null)
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{tAccount('dialogs.createOwnAccount.tk_title_')}</DialogTitle>
          <DialogDescription>{tAccount('dialogs.createOwnAccount.tk_description_')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <FloatingLabelInput label={tAccount('dialogs.createOwnAccount.tk_name-label_')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <FloatingLabelInput label={tAccount('dialogs.createOwnAccount.tk_description-label_')} value={description} onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <DialogFooter>
            <WaveButton type="submit" disabled={createMutation.isLoading} className="w-full">
              <Plus className="h-3.5 w-3.5" />
              {tAccount('dialogs.createOwnAccount.tk_submit_')}
            </WaveButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
