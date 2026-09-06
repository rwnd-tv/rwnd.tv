import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEvent } from '@rwnd/shared'
import { PosterGrid } from '../library/PosterGrid.js'
import { Button } from '../ui/Button.js'
import { CalendarEventTile } from './CalendarEventTile.js'
import { eventDayKey, parseLocalDay } from './calendar-shared.js'
import { formatCalendarDayHeading, toDateInputValue } from '../../lib/date.js'

/**
 * Day-grouped list view for the calendar page (CalendarPage.tsx) — extends
 * HistoryPage.tsx's own inline day-grouping pattern (`<section
 * aria-labelledby><h1>...<PosterGrid>`), but keyed by ISO day rather than
 * the formatted display string HistoryPage currently relies on (a small,
 * free correctness improvement: no dependency on Map insertion order
 * matching an already-sorted response).
 */
export function CalendarAgenda({
  events,
  locale,
  onLoadEarlier,
  onLoadLater,
  canLoadEarlier,
  canLoadLater,
}: {
  events: CalendarEvent[]
  locale: string
  onLoadEarlier: () => void
  onLoadLater: () => void
  canLoadEarlier: boolean
  canLoadLater: boolean
}) {
  const { t } = useTranslation()
  const todayKey = toDateInputValue(new Date())
  const todayRef = useRef<HTMLElement>(null)
  const hasScrolledRef = useRef(false)

  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const day = eventDayKey(event)
    const existing = grouped.get(day)
    if (existing) existing.push(event)
    else grouped.set(day, [event])
  }
  const days = Array.from(grouped.keys()).sort()

  // Scrolls "Today" into view once, the first time this window's data
  // arrives — not on every `events` change, or a later load-more would
  // yank the scroll position back to today instead of leaving it where the
  // user put it.
  useEffect(() => {
    if (!hasScrolledRef.current && events.length > 0) {
      todayRef.current?.scrollIntoView({ block: 'start' })
      hasScrolledRef.current = true
    }
  }, [events])

  return (
    <div className="flex flex-col gap-6">
      {canLoadEarlier && (
        <div className="flex justify-center">
          <Button variant="secondary" type="button" onClick={onLoadEarlier}>
            {t('calendar.loadEarlier')}
          </Button>
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-[var(--color-fg-muted)]">{t('calendar.empty')}</p>
      ) : (
        days.map((day) => (
          <section
            key={day}
            aria-labelledby={`calendar-day-${day}`}
            ref={day === todayKey ? todayRef : undefined}
          >
            <h1 id={`calendar-day-${day}`} className="mb-2 text-lg font-semibold">
              {formatCalendarDayHeading(parseLocalDay(day), locale, t)}
            </h1>
            <PosterGrid>
              {grouped.get(day)!.map((event) => (
                <CalendarEventTile key={event.uid} event={event} locale={locale} />
              ))}
            </PosterGrid>
          </section>
        ))
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
