import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { weekHourMatrix } from '../../lib/stats-buckets.js'
import { useMediaQuery } from '../../lib/use-media-query.js'

/**
 * This table's own compact/wide threshold — deliberately not
 * `BELOW_SM_QUERY` (640px), which CalendarMonthGrid.tsx's 7-column grid
 * uses. 24 columns needs far more room than 7 does, and 640px isn't
 * remotely enough: confirmed live in a plain desktop browser window
 * (~990px, well above 640px) that `table-fixed` still crushes every
 * column down to fit, and — since a `<th>` has no `overflow: hidden` —
 * the too-narrow "00:00"/"12 AM" text doesn't wrap or truncate, it just
 * visually spills into neighboring cells. 1024px (Tailwind's own `lg`)
 * is the next natural breakpoint up and comfortably clears the ~990px
 * width that broke; a plain viewport check rather than a container query,
 * matching every other compact/wide split in this app, even though the
 * real constraint is this page's content-column width (viewport minus the
 * sidebar) — close enough in practice, and simpler than plumbing a
 * container query through just for this one table.
 */
const BELOW_HEATMAP_SPLIT_QUERY = '(max-width: 1023px)'

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
const FIRST_HALF_HOURS = HOURS.slice(0, 12)
const SECOND_HALF_HOURS = HOURS.slice(12)

/**
 * A 12-hour locale (e.g. en-US) gets a compact "12 AM"/"1 PM" — ICU's own
 * `hour: 'numeric'` default for these locales, no minutes shown at all,
 * since an on-the-hour "12:00 AM" reads as more precision than an hour
 * label needs and is meaningfully wider across 24 columns. A 24-hour
 * locale (e.g. en-GB) gets a zero-padded "00:00"/"13:00" instead — ICU's
 * own `hour: 'numeric'` for these locales already zero-pads the hour
 * ("00".."23") but drops the minutes/colon entirely, which reads as an
 * unfamiliar bare two-digit number rather than a clock time, so `2-digit`
 * hour+minute is asked for explicitly instead. Checking a locale's own
 * `resolvedOptions().hour12` (rather than guessing from the locale tag)
 * is what lets this generalize to any future 12-hour locale, not just
 * en-US specifically.
 */
function hourLabelFormatter(locale: string): Intl.DateTimeFormat {
  const hour12 = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12
  return hour12
    ? new Intl.DateTimeFormat(locale, { hour: 'numeric' })
    : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
}

interface HeatmapTableProps {
  hours: number[]
  caption: string
  dayOrder: number[]
  matrix: number[][]
  max: number
  weekdayFormatter: Intl.DateTimeFormat
  weekdayLongFormatter: Intl.DateTimeFormat
  hourFormatter: Intl.DateTimeFormat
  cellCount: (count: number) => string
}

/** One `<table>` over a given subset of hours — the whole day (24 columns,
 * wide layouts) or half of it (12 columns, `BELOW_HEATMAP_SPLIT_QUERY`
 * layouts, see WeekHourHeatmap's own doc comment on why 24 columns don't
 * stay legible below that width). Factored out rather than inlined twice
 * so the compact split can't drift out of sync with the wide rendering. */
function HeatmapTable({
  hours,
  caption,
  dayOrder,
  matrix,
  max,
  weekdayFormatter,
  weekdayLongFormatter,
  hourFormatter,
  cellCount,
}: HeatmapTableProps) {
  return (
    // min-w-0: this table sits as a flex item (the compact split's
    // `flex flex-col` wrapper), which has the exact same default
    // `min-width: auto` behavior as the cells below — without overriding
    // it here too, the table itself could refuse to shrink to `w-full`
    // even with every cell inside it correctly capped.
    <table className="w-full min-w-0 table-fixed border-collapse text-center">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {/* `table-fixed` (same precedent as CalendarMonthGrid.tsx) is
              what makes this width actually authoritative — under the
              default auto layout, the browser was free to widen this
              column well past what "Wed" needs, and since the row header
              below is right-aligned, all that slack showed up as a large
              blank gap to its left rather than distributed evenly. */}
          <th scope="col" className="w-8"></th>
          {hours.map((hour) => (
            <th
              key={hour}
              scope="col"
              title={hourFormatter.format(new Date(2023, 0, 1, hour))}
              // overflow-hidden + text-ellipsis: a safety net, not the
              // primary fix (that's BELOW_HEATMAP_SPLIT_QUERY above) — if a
              // column is ever narrower than its label for some other
              // reason (browser zoom, an unusually wide locale format),
              // this clips it cleanly instead of letting it visually spill
              // into the neighboring column the way a bare `whitespace-
              // nowrap` does. `min-w-0` is what actually makes that safety
              // net work: a table cell's default `min-width: auto` still
              // respects its content's natural (unbreakable, nowrap) size
              // even under `table-layout: fixed`, so without this the
              // *column* — and with it the whole table, since nothing
              // upstream caps it — was quietly forced wider than the
              // container to fit "00:00"/"12 AM" in full. Found live: at a
              // width where the split table should comfortably fit, the
              // page itself was overflowing horizontally instead, visibly
              // squeezing everything else on the page including the totals
              // tiles above.
              className="min-w-0 overflow-hidden text-[9px] font-normal text-ellipsis whitespace-nowrap text-[var(--color-fg-muted)]"
            >
              {hourFormatter.format(new Date(2023, 0, 1, hour))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dayOrder.map((day) => (
          <tr key={day}>
            <th
              scope="row"
              className="min-w-0 overflow-hidden pr-1 text-right text-xs font-normal text-ellipsis whitespace-nowrap text-[var(--color-fg-muted)]"
            >
              {weekdayFormatter.format(addDays(REFERENCE_SUNDAY, day))}
            </th>
            {hours.map((hour) => {
              const count = matrix[day]![hour]!
              const text = `${weekdayLongFormatter.format(addDays(REFERENCE_SUNDAY, day))} ${hourFormatter.format(
                new Date(2023, 0, 1, hour),
              )}: ${cellCount(count)}`
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
  )
}

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
 *
 * Below `BELOW_HEATMAP_SPLIT_QUERY` (see its own doc comment — a wider
 * threshold than CalendarMonthGrid.tsx's, since 24 columns needs far more
 * room than that component's 7), 24 columns is too many for an hour label
 * to stay legible — confirmed live, both on a real phone and in an
 * ordinary ~990px desktop window: "12 AM"/"00:00" labels run together into
 * an unreadable smear once each column drops much below ~40px. Splitting
 * into two 12-column tables (first/second half of the day, stacked)
 * roughly doubles each column's width instead, the same fix
 * CalendarMonthGrid.tsx's own compact mode applies for essentially the
 * same reason (a full week's worth of columns doesn't fit narrow either).
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
  const isCompact = useMediaQuery(BELOW_HEATMAP_SPLIT_QUERY)

  const { matrix, max } = useMemo(() => {
    const episodeMatrix = weekHourMatrix(episodePlays, year)
    const movieMatrix = weekHourMatrix(moviePlays, year)
    const combined = episodeMatrix.map((row, day) =>
      row.map((count, hour) => count + movieMatrix[day]![hour]!),
    )
    return { matrix: combined, max: Math.max(1, ...combined.flat()) }
  }, [episodePlays, moviePlays, year])

  // Intl.DateTimeFormat construction does real locale-data resolution
  // work (hourLabelFormatter builds a throwaway one just to read
  // resolvedOptions().hour12), so these are memoized on locale alone —
  // this component re-renders on every year-selector change in StatsPage
  // even though locale itself is stable, same reasoning as the matrix/max
  // useMemo above.
  const { dayOrder, weekdayFormatter, weekdayLongFormatter, hourFormatter } = useMemo(
    () => ({
      dayOrder: weekdayDisplayOrder(locale),
      weekdayFormatter: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      weekdayLongFormatter: new Intl.DateTimeFormat(locale, { weekday: 'long' }),
      hourFormatter: hourLabelFormatter(locale),
    }),
    [locale],
  )

  if (matrix.flat().every((count) => count === 0)) {
    return <p className="text-sm text-[var(--color-fg-muted)]">{t('stats.heatmap.empty')}</p>
  }

  const cellCount = (count: number) => t('stats.heatmap.cellCount', { count })

  const sharedProps = {
    dayOrder,
    matrix,
    max,
    weekdayFormatter,
    weekdayLongFormatter,
    hourFormatter,
    cellCount,
  }

  if (isCompact) {
    // Each half's sr-only caption names its own hour range (rather than
    // an "AM"/"PM" label, which would misdescribe the 24-hour-locale case)
    // so a screen reader user navigating by table still knows which half
    // of the day each one covers.
    const rangeCaption = (hours: number[]) =>
      `${t('stats.heatmap.title')} (${hourFormatter.format(new Date(2023, 0, 1, hours[0]))}–${hourFormatter.format(new Date(2023, 0, 1, hours[hours.length - 1]))})`
    // min-w-0: this component's own root renders as a flex item of
    // StatsPage.tsx's `flex flex-col` section wrapper, which has the same
    // default `min-width: auto` behavior the tables/cells below need
    // overriding too — otherwise this div itself refuses to shrink to fit,
    // pushing the overflow up a level instead of fixing it.
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <HeatmapTable
          hours={FIRST_HALF_HOURS}
          caption={rangeCaption(FIRST_HALF_HOURS)}
          {...sharedProps}
        />
        <HeatmapTable
          hours={SECOND_HALF_HOURS}
          caption={rangeCaption(SECOND_HALF_HOURS)}
          {...sharedProps}
        />
      </div>
    )
  }

  // Same min-w-0 reasoning as the compact branch above — here it's what
  // lets `overflow-x-auto` actually engage its own internal scrollbar on a
  // width where even 24 columns don't fit, instead of the flex item
  // refusing to shrink and pushing the whole page wider instead.
  return (
    <div className="min-w-0 overflow-x-auto">
      <HeatmapTable hours={HOURS} caption={t('stats.heatmap.title')} {...sharedProps} />
    </div>
  )
}
