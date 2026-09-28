import type { ReactNode } from 'react'

import { cn } from '@/utils/ui'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
}

type SegmentedFilterProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  dataTestid?: string
  className?: string
}

export function SegmentedFilter<T extends string>({ value, onChange, options, dataTestid = 'status-filter', className }: SegmentedFilterProps<T>) {
  return (
    <div data-testid={dataTestid} className={cn('border-border bg-card inline-flex items-center rounded-sm border p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-[10px] font-bold tracking-widest uppercase transition-colors',
            // Active segment uses the same mustard `accent` token as the KPI filter cards and
            // the Switch-account button — one shared "selected" affordance everywhere.
            value === o.value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
