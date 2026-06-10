import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/utils'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * DialogContent — wraps every dialog with the same `glow-card` halo so the modal frame is
 * visually consistent across the app. The two `igw-glow` / `igw-border` divs are the layers
 * the `glow-card` CSS hooks into; `relative z-10` lifts the actual content above them.
 *
 * Children are rendered inside a `relative z-10` wrapper to sit above the glow layers — they
 * lose the outer `grid gap-4` between siblings, so callers should use their own vertical
 * spacing (space-y-* or margin) on the body. Existing dialogs already do this.
 *
 * Callers can opt out by passing `glow={false}` (e.g. micro-prompts where the halo would
 * feel heavy), but the default carries the affordance everywhere.
 *
 * `tone="destructive"` swaps the rotating halo colour from primary (orange) to destructive
 * (red) — used by ConfirmDialog when the action is irreversible (deactivation, deletion).
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { glow?: boolean; tone?: 'default' | 'destructive' }
>(({ className, children, glow = true, tone = 'default', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-top-[20%] data-[state=open]:slide-in-from-top-[20%] sm:rounded-lg',
        glow && 'glow-card overflow-visible',
        glow && tone === 'destructive' && 'glow-card--destructive',
        className
      )}
      {...props}
    >
      {glow ? (
        <>
          <div className="igw-glow" aria-hidden="true" />
          <div className="igw-border" aria-hidden="true" />
          <div className="relative z-10 flex flex-col gap-4">{children}</div>
        </>
      ) : (
        children
      )}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-20 cursor-pointer rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-border focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger }
