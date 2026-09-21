import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { CALENDAR_EVENT_KINDS } from '@rwnd/shared'
import { CalendarEventRow } from './CalendarEventRow.js'
import { CALENDAR_KIND_DOT_CLASS, calendarHref, eventDayKey } from './calendar-shared.js'
import { formatCalendarDayHeading, parseLocalDay, toDateInputValue } from '../../lib/date.js'
import { BELOW_SM_QUERY, useMediaQuery } from '../../lib/use-media-query.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'

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

/** One compact entry inside a wide-mode month-grid cell — a kind-colored dot
 * plus a single truncated line, linking straight to the underlying page.
 * Deliberately no reveal control at this size: an unwatched episode's
 * title is substituted with the generic fallback outright rather than
 * offered a click-to-reveal, same as EpisodeCard.tsx's own
 * space-constrained precedent — a real reveal happens one click away, on
 * the underlying episode/movie page (or, below `sm`, one tap away via the
 * day sheet, which reuses CalendarEventRow's own reveal button instead).
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

/** Below `sm`, a day cell shows the day number plus one dot per distinct
 * event kind present (bounded at 3 by CALENDAR_EVENT_KINDS, so there's no
 * overflow case to design for) and the event total as a small numeral once
 * there's more than one — enough to say "something's here, and roughly how
 * much" without the per-title truncation that makes the wide grid
 * unreadable at this width. Purely decorative: the real information is the
 * enclosing button's accessible name. */
function CompactDayDots({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null
  const kindsPresent = CALENDAR_EVENT_KINDS.filter((kind) => events.some((e) => e.kind === kind))
  return (
    <span aria-hidden="true" className="flex items-center gap-0.5">
      {kindsPresent.map((kind) => (
        <span key={kind} className={`h-1.5 w-1.5 rounded-full ${CALENDAR_KIND_DOT_CLASS[kind]}`} />
      ))}
      {events.length > 1 && (
        <span className="text-[10px] leading-none text-[var(--color-fg-muted)]">
          {events.length}
        </span>
      )}
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
 * Wide mode (`sm` and up) shows every event for its day rather than capping
 * at a few and offering a "+N more" control — `h-32` is a floor, not a
 * fixed height, so a busy day grows its whole row.
 *
 * Below `sm`, a full event title has nowhere to go (a 375px viewport gives
 * each of the 7 columns roughly 49px), so the cell switches to a compact
 * day-number-plus-dots rendering and taps open that day's events in a
 * sheet instead — a genuinely different rendering chosen in JS via
 * useMediaQuery, not a CSS toggle: compact mode needs the whole cell to be
 * one `<button>` (wide mode needs per-event `<Link>`s, and `pointer-events`
 * inherits, so both could never safely live in the DOM at once).
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
  const isCompact = useMediaQuery(BELOW_SM_QUERY)
  const [openDay, setOpenDay] = useState<string | null>(null)

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
  const openDayEvents = openDay ? (eventsByDay.get(openDay) ?? []) : []

  return (
    <>
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

                const dayNumber = (
                  <span
                    aria-current={isToday ? 'date' : undefined}
                    className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                      inMonth ? '' : 'text-[var(--color-fg-muted)]'
                    } ${isToday ? 'font-semibold ring-1 ring-[var(--color-primary)]' : ''}`}
                  >
                    {day.getDate()}
                  </span>
                )

                return (
                  <td
                    key={dayKey}
                    className={`${isCompact ? 'h-14' : 'h-32'} max-w-0 border border-[var(--color-border)] p-1 align-top ${
                      inMonth ? '' : 'bg-[var(--color-surface)]'
                    }`}
                  >
                    {isCompact ? (
                      dayEvents.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setOpenDay(dayKey)}
                          aria-label={t('calendar.dayEvents', {
                            date: formatCalendarDayHeading(day, locale, t),
                            count: dayEvents.length,
                          })}
                          className="flex h-full w-full flex-col items-center gap-0.5 rounded"
                        >
                          {dayNumber}
                          <CompactDayDots events={dayEvents} />
                        </button>
                      ) : (
                        dayNumber
                      )
                    ) : (
                      <>
                        {dayNumber}
                        <div className="flex flex-col gap-0.5">
                          {dayEvents.map((event) => (
                            <CalendarMonthCellEntry key={event.uid} event={event} />
                          ))}
                        </div>
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Only ever open in compact mode — rotating to a wide viewport flips
          `isCompact` false, Dialog's own effect calls close(), and the
          resulting native 'close' event clears openDay below. No need to
          reset on month change either: a native modal makes the rest of
          the page (including the month navigator) inert while open. */}
      <Dialog
        open={isCompact && openDay !== null}
        onClose={() => setOpenDay(null)}
        title={openDay ? formatCalendarDayHeading(parseLocalDay(openDay), locale, t) : ''}
      >
        <ul className="flex flex-col gap-0.5">
          {openDayEvents.map((event) => (
            <CalendarEventRow key={event.uid} event={event} locale={locale} />
          ))}
        </ul>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" type="button" onClick={() => setOpenDay(null)}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
