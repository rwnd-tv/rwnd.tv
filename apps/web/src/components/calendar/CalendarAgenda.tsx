import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CalendarEvent } from '@rwnd/shared'
import { Button } from '../ui/Button.js'
import {
  CALENDAR_KIND_DOT_CLASS,
  calendarHref,
  eventDayKey,
  parseLocalDay,
} from './calendar-shared.js'
import { formatCalendarDayHeading, toDateInputValue } from '../../lib/date.js'

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * One event row: kind dot, a small poster thumbnail, the title, and a
 * right-aligned meta column (episode code, watch time, or "Releases").
 *
 * Owns its own spoiler-reveal state for the same reason CalendarEventTile
 * does — an `episode` event's own title needs a per-row click-to-reveal
 * that only this component can hold. Same substitution as EpisodeCard.tsx
 * and CalendarEventTile rather than SpoilerGuard.tsx's blur: a generic
 * "Episode N" label swapped in, plus a small reveal button. The show
 * title, the episode code and the thumbnail are never guarded, only the
 * episode's own title.
 *
 * The thumbnail is a 2:3 box like PosterTile.tsx's, at w-8 rather than a
 * grid cell's full width, and falls back to the title's first character on
 * the same surface colour when the provider has no artwork.
 */
function CalendarAgendaRow({ event, locale }: { event: CalendarEvent; locale: string }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const hidden = event.spoilerHidden && !revealed

  const primary =
    event.media.type === 'episode'
      ? (event.media.showTitle ?? event.media.title)
      : event.media.title

  const secondary =
    event.media.type === 'episode'
      ? hidden
        ? t('calendar.episodeFallbackLabel', { number: event.media.episodeNumber })
        : event.media.title
      : undefined

  const episodeCode =
    event.media.seasonNumber !== undefined && event.media.episodeNumber !== undefined
      ? t('calendar.episodeCode', {
          season: event.media.seasonNumber,
          episode: event.media.episodeNumber,
        })
      : undefined

  let meta: string
  if (event.kind === 'watch') {
    const time = new Date(event.endsAt).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    meta = episodeCode ? `${episodeCode} · ${time}` : time
  } else if (event.kind === 'episode') {
    meta = episodeCode ?? ''
  } else {
    meta = t('calendar.release')
  }

  const href = calendarHref(event)
  const body = (
    <>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${CALENDAR_KIND_DOT_CLASS[event.kind]}`}
        aria-hidden="true"
      />
      <span className="h-12 w-8 shrink-0 overflow-hidden rounded bg-[var(--color-surface)]">
        {event.media.posterPath ? (
          <img
            src={event.media.posterPath}
            // Decorative: the title sits right beside it as visible text,
            // same reasoning as PosterTile.tsx's own alt="".
            alt=""
            loading="lazy"
            decoding="async"
            width={342}
            height={513}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full items-center justify-center text-sm font-semibold text-[var(--color-fg-muted)]"
          >
            {primary.charAt(0)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{primary}</span>
        {secondary !== undefined && (
          <span className="text-[var(--color-fg-muted)]"> · {secondary}</span>
        )}
      </span>
      {meta !== '' && <span className="shrink-0 text-xs text-[var(--color-fg-muted)]">{meta}</span>}
    </>
  )

  return (
    <li className="flex items-center gap-2">
      {href ? (
        <Link
          to={href}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)]"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">{body}</span>
      )}
      {hidden && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          title={t('spoiler.reveal')}
          aria-label={t('spoiler.reveal')}
          className="shrink-0 pr-2 text-[var(--color-fg-muted)] hover:text-[var(--color-primary)]"
        >
          <EyeIcon />
        </button>
      )}
    </li>
  )
}

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
                    <CalendarAgendaRow key={event.uid} event={event} locale={locale} />
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
