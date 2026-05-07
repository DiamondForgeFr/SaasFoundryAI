import type { ReactNode } from 'react'

type KpiCardProps = {
  icon: ReactNode
  label: string
  value: number | string
  sub: string
  alert?: boolean
}

export function KpiCard({ icon, label, value, sub, alert }: KpiCardProps) {
  return (
    <div className="border-border border-t-primary bg-card flex flex-col justify-between gap-1.5 rounded-sm border border-t-2 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
          {icon}
          {label}
        </span>
        {alert && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px] shadow-amber-500" />}
      </div>
      <div className="font-display text-3xl leading-none font-bold">{value}</div>
      <div className="text-muted-foreground text-[11px]">{sub}</div>
    </div>
  )
}
