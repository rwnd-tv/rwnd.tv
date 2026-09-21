import { useTranslation } from 'react-i18next'
import type { CalendarEvent } from '@rwnd/shared'
import { Button } from '../ui/Button.js'
import { CalendarEventRow } from './CalendarEventRow.js'
import { eventDayKey } from './calendar-shared.js'
import { formatCalendarDayHeading, toDateInputValue, parseLocalDay } from '../../lib/date.js'

/**
 * Forward-looking, day-grouped list view for the calendar page
 * (CalendarPage.tsx): a left date gutter (weekday over day number, with a
 * month label whenever the month changes) against a dense list of event
 * rows, rather than the poster grid this used to render.
 *
 * Deliberately starts at today and never shows a past day — HistoryPage.tsx
 * is where looking backwards belongs, and this page's own value is what is
 * still to come. Days with nothing on them are skipped entirely rather than
 * rendered empty, so the list stays dense however sparse the window is.
 *
 * One consequence worth knowing: `watch` events are by definition in the
 * past, so beyond anything already logged *today* they no longer appear
 * here at all. The History filter toggle therefore does very little in this
 * view, while still mattering in Month.
 */
export function CalendarAgenda({
  events,
  locale,
  onLoadLater,
  canLoadLater,
}: {
  events: CalendarEvent[]
  locale: string
  onLoadLater: () => void
  canLoadLater: boolean
}) {
  const { t } = useTranslation()
  const todayKey = toDateInputValue(new Date())

  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const day = eventDayKey(event)
    // Forward-looking: a day earlier than today never renders, even when
    // the fetched window still reaches back (the Month view shares that
    // same query).
    if (day < todayKey) continue
    const existing = grouped.get(day)
    if (existing) existing.push(event)
    else grouped.set(day, [event])
  }
  const days = Array.from(grouped.keys()).sort()

  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })

  return (
    <div className="flex flex-col gap-6">
      {days.length === 0 ? (
        <p className="text-[var(--color-fg-muted)]">{t('calendar.empty')}</p>
      ) : (
        <div className="flex flex-col">
          {days.map((day, i) => {
            const date = parseLocalDay(day)
            const previous = i > 0 ? parseLocalDay(days[i - 1]!) : undefined
            // Only labelled when the month actually changes, so a run of
            // days inside one month stays uncluttered but a list spanning
            // several never leaves a bare day number ambiguous.
            const showMonth = previous === undefined || previous.getMonth() !== date.getMonth()
            const isToday = day === todayKey

            return (
              <section
                key={day}
                aria-labelledby={`calendar-day-${day}`}
                className="flex gap-4 border-t border-[var(--color-border)] py-3 first:border-t-0"
              >
                {/* The gutter is abbreviated by design, so the accessible
                    name carries the full date instead. */}
                <h2 id={`calendar-day-${day}`} className="sr-only">
                  {formatCalendarDayHeading(date, locale, t)}
                </h2>
                <div className="w-12 shrink-0 text-center">
                  <div className="text-xs font-medium text-[var(--color-fg-muted)] uppercase">
                    {weekdayFormatter.format(date)}
                  </div>
                  <div
                    className={
                      isToday
                        ? 'mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-lg font-semibold text-white'
                        : 'mt-0.5 text-lg font-semibold'
                    }
                  >
                    {date.getDate()}
                  </div>
                  {showMonth && (
                    <div className="mt-0.5 text-xs text-[var(--color-fg-muted)] uppercase">
                      {monthFormatter.format(date)}
                    </div>
                  )}
                </div>
                <ul className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  {grouped.get(day)!.map((event) => (
                    <CalendarEventRow key={event.uid} event={event} locale={locale} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {canLoadLater && (
        <div className="flex justify-center">
          <Button variant="secondary" type="button" onClick={onLoadLater}>
            {t('calendar.loadLater')}
          </Button>
        </div>
      )}
    </div>
  )
}
