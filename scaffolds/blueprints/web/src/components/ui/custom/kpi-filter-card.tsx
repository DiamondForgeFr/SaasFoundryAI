import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/utils/ui'

export type KpiFilterTone = 'primary' | 'emerald' | 'amber' | 'muted'

interface KpiFilterCardProps {
  active: boolean
  onClick: () => void
  icon: ComponentType<{ className?: string }>
  label: string
  value: number | string
  /** Footer slot — plain text by default, accepts a ReactNode for richer affordances
      like a multi-section progress bar (one segment per item, filled segments = active count). */
  sub: ReactNode
  /** Idle-state tone — only affects the icon colour at rest. Active state is uniform. */
  tone?: KpiFilterTone
  /** Pulsing dot in the header — visible only when idle, suppressed when active. */
  alert?: boolean
}

/**
 * Clickable KPI card used as a filter chip.
 *
 * The IDLE state varies per tone (icon colour + neutral border) so the user can scan a row
 * of cards and recognise the semantic of each one (primary, emerald = active count,
 * amber = needs attention, muted = inactive count).
 *
 * The SELECTED state is uniform across cards: the mustard `accent` token used elsewhere
 * for "this thing is selected" affordances (Switch account button, multiselect-open chip,
 * etc.). Keeping that visual language consistent everywhere makes the selected state
 * instantly recognisable regardless of which card it lives on.
 */
export function KpiFilterCard({ active, onClick, icon: Icon, label, value, sub, tone = 'primary', alert }: KpiFilterCardProps) {
  const idleIcon = {
    primary: 'text-primary',
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    muted: 'text-muted-foreground'
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'cursor-pointer text-left rounded-sm border p-4 flex flex-col gap-1.5 transition-colors',
        active ? 'border-accent bg-accent text-accent-foreground' : 'bg-card border-border hover:border-foreground/20'
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest', active ? 'text-accent-foreground/90' : 'text-muted-foreground')}>
        <Icon className={cn('h-3 w-3', active ? 'text-accent-foreground' : idleIcon)} />
        <span>{label}</span>
        {alert && !active && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px] shadow-amber-500" />}
      </div>
      <div className={cn('text-[26px] font-bold leading-none tabular-nums', active ? 'text-accent-foreground' : 'text-foreground')}>{value}</div>
      <div className={cn('text-[11px] leading-tight', active ? 'text-accent-foreground/80' : 'text-muted-foreground')}>{sub}</div>
    </button>
  )
}
