/**
 * Resources
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle, type LucideIcon } from 'lucide-react'

/**
 * Components
 */
import { cn } from '@/utils/ui'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { WaveButton } from '@/components/ui/custom/wave-button'

export type ConfirmDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Visual tone — destructive for irreversible actions, default for benign confirmations. */
  tone?: 'default' | 'destructive' | 'warning'
  confirmLabel?: string
  cancelLabel?: string
  /** Optional icon override; defaults to AlertTriangle for destructive/warning. */
  icon?: LucideIcon
  isLoading?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * Drop-in replacement for `window.confirm()` — keeps the app's visual language, supports loading
 * states, and exposes a `tone` knob to colour-code destructive vs. benign actions.
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *   <ConfirmDialog
 *     isOpen={open}
 *     onOpenChange={setOpen}
 *     title="Delete this role?"
 *     description="This cannot be undone."
 *     tone="destructive"
 *     onConfirm={handleDelete}
 *   />
 */
export function ConfirmDialog({ isOpen, onOpenChange, title, description, tone = 'default', confirmLabel, cancelLabel, icon: Icon = AlertTriangle, isLoading = false, onConfirm }: ConfirmDialogProps) {
  const { t: tCommon } = useTranslation('common')

  const toneClasses = {
    default: 'border-primary/30 bg-primary/12 text-primary',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    destructive: 'border-destructive/30 bg-destructive/10 text-destructive'
  } as const

  const handleConfirm = async () => {
    try {
      await onConfirm()
    } finally {
      // Caller is expected to close the dialog on success; we keep it open on async failure
      // so the user can retry. Loading state is driven externally via `isLoading`.
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent tone={tone === 'destructive' ? 'destructive' : 'default'} className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border', toneClasses[tone])}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm">{title}</DialogTitle>
              {description && <DialogDescription className="text-xs text-foreground/80 mt-1 leading-snug">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-[2px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {cancelLabel ?? tCommon('actions.tk_cancel_')}
          </button>
          <WaveButton type="button" tone={tone === 'destructive' ? 'destructive' : 'default'} disabled={isLoading} onClick={handleConfirm}>
            {isLoading ? tCommon('actions.tk_loading_') : (confirmLabel ?? tCommon('actions.tk_confirm_'))}
          </WaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
