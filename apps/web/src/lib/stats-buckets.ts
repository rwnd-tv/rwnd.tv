/**
 * Pure, unit-tested, no React — local-time bucketing for StatsPage.tsx's
 * year selector and activity-over-time chart, fed by GET /stats/timeline's
 * epoch-minute arrays (statsTimelineSchema's doc comment: minute
 * granularity, ascending, sentinel-excluded). Everything here reads the
 * *local* year/month via the plain `Date` accessors, matching date.ts's
 * `localDayStartISO`/`localDayEndISO` convention — the whole point of
 * bucketing client-side rather than server-side is agreeing with the
 * browser's own timezone, same reasoning as this file's own doc comment in
 * statsTimelineSchema.
 *
 * Neither vitest.config.ts nor the setup file pins `TZ`, so tests for these
 * functions build inputs with the local `new Date(y, m, d, h)` constructor
 * (converted to epoch minutes via `.getTime() / 60_000`) rather than
 * hardcoded UTC timestamps with hand-computed local-day expectations —
 * otherwise the suite would be machine/season-dependent.
 */

function toLocalDate(epochMinutes: number): Date {
  return new Date(epochMinutes * 60_000)
}

/** Every local year present in either array, newest first — the options
 * for StatsPage.tsx's year selector (plus an "all time" choice the
 * frontend adds itself, not represented here). */
export function availableYearsFrom(episodePlays: number[], moviePlays: number[]): number[] {
  const years = new Set<number>()
  for (const minutes of episodePlays) years.add(toLocalDate(minutes).getFullYear())
  for (const minutes of moviePlays) years.add(toLocalDate(minutes).getFullYear())
  return [...years].sort((a, b) => b - a)
}

/** Twelve counts (January..December), for the plays in `epochMinutes` that
 * fall in local `year` — every other year's plays are simply not counted,
 * not an error case. */
export function bucketByMonth(epochMinutes: number[], year: number): number[] {
  const buckets = new Array<number>(12).fill(0)
  for (const minutes of epochMinutes) {
    const date = toLocalDate(minutes)
    if (date.getFullYear() === year) buckets[date.getMonth()] = buckets[date.getMonth()]! + 1
  }
  return buckets
}

/** Play count per local year, for the "all time" view of the activity
 * chart (one bar per year rather than per month). */
export function bucketByYear(epochMinutes: number[]): Map<number, number> {
  const buckets = new Map<number, number>()
  for (const minutes of epochMinutes) {
    const year = toLocalDate(minutes).getFullYear()
    buckets.set(year, (buckets.get(year) ?? 0) + 1)
  }
  return buckets
}

/**
 * A 7x24 matrix of play counts, indexed `[dayOfWeek][hour]` with
 * `dayOfWeek` in JS's own `Date.getDay()` numbering (0 = Sunday .. 6 =
 * Saturday) — deliberately locale-agnostic, matching this file's own
 * "everything here reads local time, nothing here reads locale" scope.
 * WeekHourHeatmap.tsx (the only caller) rotates the returned rows to the
 * viewer's locale-appropriate week start when it renders them, the same
 * split CalendarMonthGrid.tsx draws between locale-agnostic date math and
 * locale-aware presentation.
 *
 * `year: 'all'` includes every play; a specific local year restricts to
 * that year only, same convention as bucketByMonth above.
 */
export function weekHourMatrix(epochMinutes: number[], year: number | 'all'): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  for (const minutes of epochMinutes) {
    const date = toLocalDate(minutes)
    if (year !== 'all' && date.getFullYear() !== year) continue
    const day = date.getDay()
    const hour = date.getHours()
    matrix[day]![hour] = matrix[day]![hour]! + 1
  }
  return matrix
}
