import type { CalendarEvent } from '@rwnd/shared'
import { toDateInputValue } from '../../lib/date.js'

/** One color per event kind — the Month grid's per-day dots
 * (CalendarMonthGrid.tsx) and the page-level History/TV Shows/Movies
 * filter toggles (CalendarPage.tsx) both key off this, so a dot always
 * means the same kind wherever it appears. */
export const CALENDAR_KIND_DOT_CLASS: Record<CalendarEvent['kind'], string> = {
  watch: 'bg-[var(--color-fg-muted)]',
  episode: 'bg-[var(--color-primary)]',
  release: 'bg-[var(--color-success)]',
}

/** Parses a bare 'YYYY-MM-DD' day from parts, not `new Date(str)` directly
 * — same reasoning as date.ts's formatReleaseDate/localDayStartISO: the
 * latter parses as UTC midnight, a day early for anyone west of UTC. */
export function parseLocalDay(day: string): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return new Date(year!, month! - 1, dayOfMonth)
}

/** Which calendar day (local, 'YYYY-MM-DD') an event's tile groups under —
 * a `watch` event groups by the local day of `endsAt` (the canonical
 * `plays.watchedAt`; a late-night watch's derived start could fall on the
 * previous day, but it's still logged as watched *today*), an `episode`/
 * `release` event by its own bare `date` verbatim (never re-parsed through
 * `new Date`, for the same reason as parseLocalDay above). */
export function eventDayKey(event: CalendarEvent): string {
  return event.kind === 'watch' ? toDateInputValue(new Date(event.endsAt)) : event.date
}

/** Where a calendar event links to — mirrors ActivityTile.tsx's own
 * activityHref: a movie (watched or upcoming release) links to the movie
 * page, an episode (watched or upcoming) to its own episode page when
 * season/episode are known, else the show page. */
export function calendarHref(event: CalendarEvent): string | undefined {
  const { media } = event
  if (media.type === 'movie') return media.movieSlug ? `/movies/${media.movieSlug}` : undefined
  if (!media.showSlug) return undefined
  if (media.seasonNumber !== undefined && media.episodeNumber !== undefined) {
    return `/shows/${media.showSlug}/season/${media.seasonNumber}/episode/${media.episodeNumber}`
  }
  return `/shows/${media.showSlug}`
}
