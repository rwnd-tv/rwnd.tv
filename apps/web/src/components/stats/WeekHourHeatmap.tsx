import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { weekHourMatrix } from '../../lib/stats-buckets.js'

// A known Sunday — used only to get a real `Date` with the right
// `getDay()`/`getHours()` to format a weekday/hour label through `Intl`,
// never displayed or compared against itself.
const REFERENCE_SUNDAY = new Date(2023, 0, 1)

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Same two-locale special case as CalendarMonthGrid.tsx's own
 * `firstDayOfWeek` (en-US starts Sunday, en-GB starts Monday) — expressed
 * here as the JS `getDay()` index to start from, not that function's
 * 1=Monday..7=Sunday grid-offset numbering, since this file has no grid
 * offset to compute. */
function weekdayDisplayOrder(locale: string): number[] {
  const start = locale.startsWith('en-US') ? 0 : 1
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7)
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * Day-of-week / hour-of-day heatmap (stage 3, M6) — a real `<table>`
 * (accessibility, and it's genuinely tabular data), following
 * CalendarMonthGrid.tsx's `<caption class="sr-only">`/`scope="col"` shape
 * rather than an SVG grid. Each cell's count lives in a `title` attribute
 * plus an `.sr-only` span, never as visible cell text — the cell's color
 * alone (a `color-mix` intensity ramp, same `{pct}%` primary-over-surface
 * trick the M6 plan uses for the genre bars) is what's visible, which
 * sidesteps contrast-checking a ramp of text-on-color combinations.
 *
 * Combines episode and movie plays into one matrix for the color ramp
 * (this heatmap answers "when do I watch", not "what do I watch"), but
 * keeps the two split going into `weekHourMatrix` so each cell's tooltip
 * can still break the count down, same pattern as ActivityChart.tsx's
 * bars.
 */
export function WeekHourHeatmap({
  episodePlays,
  moviePlays,
  year,
  locale,
}: {
  episodePlays: number[]
  moviePlays: number[]
  year: number | 'all'
  locale: string
}) {
  const { t } = useTranslation()

  const { matrix, max } = useMemo(() => {
    const episodeMatrix = weekHourMatrix(episodePlays, year)
    const movieMatrix = weekHourMatrix(moviePlays, year)
    const combined = episodeMatrix.map((row, day) =>
      row.map((count, hour) => count + movieMatrix[day]![hour]!),
    )
    return { matrix: combined, max: Math.max(1, ...combined.flat()) }
  }, [episodePlays, moviePlays, year])

  if (matrix.flat().every((count) => count === 0)) {
    return <p className="text-sm text-[var(--color-fg-muted)]">{t('stats.heatmap.empty')}</p>
  }

  const dayOrder = weekdayDisplayOrder(locale)
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const weekdayLongFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long' })
  const hourFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric' })

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-center">
        <caption className="sr-only">{t('stats.heatmap.title')}</caption>
        <thead>
          <tr>
            {/* `table-fixed` (same precedent as CalendarMonthGrid.tsx) is
                what makes this width actually authoritative — under the
                default auto layout, the browser was free to widen this
                column well past what "Wed" needs, and since the row header
                below is right-aligned, all that slack showed up as a large
                blank gap to its left rather than distributed evenly. */}
            <th scope="col" className="w-8"></th>
            {HOURS.map((hour) => (
              <th
                key={hour}
                scope="col"
                className="text-[9px] font-normal text-[var(--color-fg-muted)]"
              >
                {hour}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dayOrder.map((day) => (
            <tr key={day}>
              <th
                scope="row"
                className="pr-1 text-right text-xs font-normal text-[var(--color-fg-muted)]"
              >
                {weekdayFormatter.format(addDays(REFERENCE_SUNDAY, day))}
              </th>
              {HOURS.map((hour) => {
                const count = matrix[day]![hour]!
                const text = `${weekdayLongFormatter.format(addDays(REFERENCE_SUNDAY, day))} ${hourFormatter.format(
                  new Date(2023, 0, 1, hour),
                )}: ${t('stats.heatmap.cellCount', { count })}`
                const pct = count === 0 ? 0 : Math.max(15, Math.round((count / max) * 100))
                return (
                  <td
                    key={hour}
                    title={text}
                    className="h-4 w-4 border border-[var(--color-border)] p-0"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--color-primary) ${pct}%, var(--color-surface))`,
                    }}
                  >
                    <span className="sr-only">{text}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
