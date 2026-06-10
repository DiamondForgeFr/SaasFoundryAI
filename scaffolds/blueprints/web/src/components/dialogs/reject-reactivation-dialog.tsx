/**
 * Resources
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Components
 */
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'

interface RejectReactivationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Display name of the account whose reactivation request is being rejected. */
  accountName: string
  isLoading?: boolean
  onConfirm: (note: string) => void | Promise<void>
}

/**
 * Modal asking the platform-admin for a rejection note before refusing a reactivation request.
 * The note is mandatory — the API rejects an empty body — so the confirm button stays disabled
 * until the textarea has at least 5 characters.
 */
export function RejectReactivationDialog({ isOpen, onOpenChange, accountName, isLoading, onConfirm }: RejectReactivationDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!isOpen) setNote('')
  }, [isOpen])

  const isValid = note.trim().length >= 5
  const submit = async () => {
    if (!isValid) return
    await onConfirm(note.trim())
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tAccount('platformReactivation.reject.tk_title_', { name: accountName })}</DialogTitle>
          <DialogDescription>{tAccount('platformReactivation.reject.tk_description_')}</DialogDescription>
        </DialogHeader>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={tAccount('platformReactivation.reject.tk_placeholder_')}
          className={cn(
            'w-full rounded-sm border border-border bg-background p-3 text-[13px] text-foreground',
            'placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:border-destructive/40 transition-colors resize-y'
          )}
        />
        <div className="text-[11px] text-muted-foreground flex justify-between">
          <span className={isValid ? 'text-muted-foreground' : 'text-destructive'}>{tAccount('platformReactivation.reject.tk_min-hint_')}</span>
          <span>{note.length} / 2000</span>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground transition-colors px-3 py-2 disabled:opacity-50"
          >
            {tCommon('tk_cancel_')}
          </button>
          <WaveButton type="button" onClick={submit} disabled={isLoading || !isValid} className="!h-9 !w-auto !text-[12px] px-4">
            {isLoading ? tCommon('tk_loading_') : tAccount('platformReactivation.reject.tk_submit_')}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
