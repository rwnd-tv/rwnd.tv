import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { CALENDAR_KIND_DOT_CLASS, calendarHref, eventDayKey } from './calendar-shared.js'
import { toDateInputValue } from '../../lib/date.js'

const GRID_CELLS = 42

/**
 * First day of the week for a locale, as Intl's own 1=Monday..7=Sunday
 * numbering. Only `en-GB` (Monday) and `en-US` (Sunday) ship today, so a
 * direct locale-name check covers both exactly; `Intl.Locale.prototype.
 * getWeekInfo()` would generalize this to any future locale, but isn't
 * consistently typed/available yet and two locales don't need it.
 */
function firstDayOfWeek(locale: string): number {
  return locale.startsWith('en-US') ? 7 : 1
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** The grid's first cell: the most recent locale-appropriate week-start
 * day on or before the 1st of `monthAnchor`'s month. */
function gridStartFor(monthAnchor: Date, locale: string): Date {
  const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)
  const firstDow = first.getDay() === 0 ? 7 : first.getDay() // JS 0=Sun..6=Sat -> 1=Mon..7=Sun
  const weekStart = firstDayOfWeek(locale)
  return addDays(first, -((firstDow - weekStart + 7) % 7))
}

/** One compact entry inside a month-grid cell — a kind-colored dot plus a
 * single truncated line, linking straight to the underlying page.
 * Deliberately no reveal control at this size: an unwatched episode's
 * title is substituted with the generic fallback outright rather than
 * offered a click-to-reveal, same as EpisodeCard.tsx's own
 * space-constrained precedent — a real reveal happens one click away, on
 * the underlying episode/movie page.
 *
 * An episode entry (watched or upcoming) shows "Show · Episode": the show
 * title alone isn't enough context in a text-only row with no poster art
 * to disambiguate which episode, unlike the Agenda's own poster-thumbnail
 * rows. */
function CalendarMonthCellEntry({ event }: { event: CalendarEvent }) {
  const { t } = useTranslation()
  const title =
    event.media.type === 'episode'
      ? `${event.media.showTitle ?? event.media.title} · ${
          event.kind === 'episode' && event.spoilerHidden
            ? t('calendar.episodeFallbackLabel', { number: event.media.episodeNumber })
            : event.media.title
        }`
      : event.media.title
  const href = calendarHref(event)
  const content = (
    <span className="flex items-center gap-1">
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${CALENDAR_KIND_DOT_CLASS[event.kind]}`}
        aria-hidden="true"
      />
      <span className="truncate">{title}</span>
    </span>
  )
  return href ? (
    <Link to={href} className="block truncate text-sm" title={title}>
      {content}
    </Link>
  ) : (
    <span className="block truncate text-sm" title={title}>
      {content}
    </span>
  )
}

/**
 * Month-grid view for the calendar page (CalendarPage.tsx) — genuinely new
 * UI territory in this codebase (no `grid-cols-7` precedent anywhere), so
 * built from scratch: a real `<table>` (this is tabular data, gets seven
 * equal columns from `table-fixed` for free, and needs no ARIA grid-role
 * gymnastics a `<div>`-based grid would), and a fixed 6x7 cell count
 * regardless of how many weeks the month actually spans (avoids a
 * page-height jump between 5- and 6-week months on navigation).
 *
 * Cells show every event for their day rather than capping at a few and
 * offering a "+N more" control. `h-32` is therefore a floor, not a fixed
 * height: a table cell's specified height is a minimum, so a busy day
 * grows its whole row. Row heights consequently vary with the busiest day
 * in that week.
 */
export function CalendarMonthGrid({
  monthAnchor,
  events,
  locale,
}: {
  monthAnchor: Date
  events: CalendarEvent[]
  locale: string
}) {
  const { t } = useTranslation()

  const gridStart = useMemo(() => gridStartFor(monthAnchor, locale), [monthAnchor, locale])
  const days = useMemo(
    () => Array.from({ length: GRID_CELLS }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  )
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    return days.slice(0, 7).map((day) => formatter.format(day))
  }, [days, locale])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = eventDayKey(event)
      const existing = map.get(key)
      if (existing) existing.push(event)
      else map.set(key, [event])
    }
    return map
  }, [events])

  const monthNumber = monthAnchor.getMonth()
  const todayKey = toDateInputValue(new Date())

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {t('calendar.title')}{' '}
          {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(monthAnchor)}
        </caption>
        <thead>
          <tr>
            {weekdayLabels.map((label, i) => (
              <th
                key={i}
                scope="col"
                className="p-2 text-sm font-medium text-[var(--color-fg-muted)]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: GRID_CELLS / 7 }, (_, row) => (
            <tr key={row}>
              {days.slice(row * 7, row * 7 + 7).map((day) => {
                const dayKey = toDateInputValue(day)
                const dayEvents = eventsByDay.get(dayKey) ?? []
                const inMonth = day.getMonth() === monthNumber
                const isToday = dayKey === todayKey

                return (
                  <td
                    key={dayKey}
                    className={`h-32 max-w-0 border border-[var(--color-border)] p-1 align-top ${
                      inMonth ? '' : 'bg-[var(--color-surface)]'
                    }`}
                  >
                    <span
                      aria-current={isToday ? 'date' : undefined}
                      className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                        inMonth ? '' : 'text-[var(--color-fg-muted)]'
                      } ${isToday ? 'font-semibold ring-1 ring-[var(--color-primary)]' : ''}`}
                    >
                      {day.getDate()}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {dayEvents.map((event) => (
                        <CalendarMonthCellEntry key={event.uid} event={event} />
                      ))}
                    </div>
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
