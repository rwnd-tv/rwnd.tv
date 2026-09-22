/**
 * "3 days, 4 hours" / "9 hours, 2 minutes" / "42 minutes" — a minute count
 * to a human duration string, for StatsPage.tsx's total-time-watched tile
 * and per-title minutes. Pure, no React — same "worth unit-testing on its
 * own" reasoning as rating.ts/library-filter.ts. Shows at most the two
 * largest non-zero units (days+hours, or hours+minutes), never all three —
 * "3 days, 4 hours, 12 minutes" is more precision than a watch-time estimate
 * (itself partly a guess — see lib/runtime.ts on the API side) deserves.
 */
export function formatDuration(
  totalMinutes: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const remainingMinutes = minutes % 60

  if (days > 0) {
    const parts = [t('stats.duration.days', { count: days })]
    if (hours > 0) parts.push(t('stats.duration.hours', { count: hours }))
    return parts.join(', ')
  }
  if (hours > 0) {
    const parts = [t('stats.duration.hours', { count: hours })]
    if (remainingMinutes > 0) parts.push(t('stats.duration.minutes', { count: remainingMinutes }))
    return parts.join(', ')
  }
  return t('stats.duration.minutes', { count: remainingMinutes })
}
