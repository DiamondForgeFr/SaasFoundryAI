import { cn } from '@/utils/ui'

interface WaveButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
  /** `destructive` swaps the primary fill for the destructive (red) one — same wave animation. */
  tone?: 'default' | 'destructive'
}

export function WaveButton({ children, className, tone = 'default', ...props }: WaveButtonProps) {
  return (
    <button
      className={cn(
        'wave-btn flex h-11 w-full cursor-pointer items-center justify-center rounded-sm text-sm font-semibold tracking-wide uppercase transition-shadow duration-300 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'destructive' && 'wave-btn--destructive',
        className
      )}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">{children}</span>
      <i aria-hidden="true" />
    </button>
  )
}
