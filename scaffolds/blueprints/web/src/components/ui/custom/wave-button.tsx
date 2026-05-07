import { cn } from '@/utils/ui'

interface WaveButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

export function WaveButton({ children, className, ...props }: WaveButtonProps) {
  return (
    <button
      className={cn(
        'wave-btn cursor-pointer flex h-11 w-full items-center justify-center rounded-sm text-sm font-semibold tracking-wide uppercase transition-shadow duration-300 disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">{children}</span>
      <i aria-hidden="true" />
    </button>
  )
}
