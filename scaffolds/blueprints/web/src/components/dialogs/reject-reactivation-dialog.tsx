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
          data-testid="reactivation-reject-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={tAccount('platformReactivation.reject.tk_placeholder_')}
          className={cn(
            'border-border bg-background text-foreground w-full rounded-sm border p-3 text-[13px]',
            'placeholder:text-muted-foreground/60 focus:ring-destructive/30 focus:border-destructive/40 resize-y transition-colors focus:ring-2 focus:outline-none'
          )}
        />
        <div className="text-muted-foreground flex justify-between text-[11px]">
          <span className={isValid ? 'text-muted-foreground' : 'text-destructive'}>{tAccount('platformReactivation.reject.tk_min-hint_')}</span>
          <span>{note.length} / 2000</span>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2 text-[12px] transition-colors disabled:opacity-50"
          >
            {tCommon('tk_cancel_')}
          </button>
          <WaveButton data-testid="reactivation-reject-submit" type="button" onClick={submit} disabled={isLoading || !isValid} className="!h-9 !w-auto px-4 !text-[12px]">
            {isLoading ? tCommon('tk_loading_') : tAccount('platformReactivation.reject.tk_submit_')}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
