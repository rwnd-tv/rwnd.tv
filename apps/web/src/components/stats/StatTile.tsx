import type { ReactNode } from 'react'
import { Card } from '../ui/Card.js'

/**
 * A single headline number on StatsPage.tsx — a plain Card, no primitive
 * for this existed before the stats page (the closest thing, ProgressBar,
 * is a different shape entirely). `subLabel` is an optional second line
 * under the value, e.g. an "(estimated)" caveat.
 */
export function StatTile({
  label,
  value,
  subLabel,
}: {
  label: string
  value: ReactNode
  subLabel?: ReactNode
}) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-[var(--color-fg-muted)]">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {subLabel && <p className="text-xs text-[var(--color-fg-muted)]">{subLabel}</p>}
    </Card>
  )
}
