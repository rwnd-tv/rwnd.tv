// Moved to packages/shared/src/constants.ts so the api can compare against
// the exact same value (rejecting a second unknown-date watch for an
// episode that already has one) — re-exported here so existing imports
// from this file don't all need updating.
export { UNKNOWN_WATCHED_AT } from '@rwnd/shared'

/**
 * Signals "log each episode at its own release date" from the bulk
 * "Watched" button's dialog (WatchDateDialog.tsx's `allowReleaseDate`
 * mode, used by ShowDetailPage.tsx/SeasonDetailPage.tsx) — never a real
 * ISO datetime, so it can't collide with a genuine watchedAt value. The
 * mutation functions that receive this from `onConfirm` check for it and
 * call the API with `{ useReleaseDate: true }` instead of a literal
 * `watchedAt`, since a bulk action has no single date to send — see
 * markShowWatchedRequestSchema's doc comment (packages/shared/src/schemas/library.ts).
 */
export const RELEASE_DATE_WATCHED_AT = 'release-date'

/**
 * Converts a WatchDateDialog `onConfirm` value into the bulk "Watched"
 * button's request body — shared by ShowDetailPage.tsx/SeasonDetailPage.tsx
 * so the RELEASE_DATE_WATCHED_AT check isn't duplicated in both.
 */
export function markWatchedRequestBody(
  watchedAtIso: string,
): { watchedAt: string } | { useReleaseDate: true } {
  return watchedAtIso === RELEASE_DATE_WATCHED_AT
    ? { useReleaseDate: true }
    : { watchedAt: watchedAtIso }
}

/**
 * Locale-formatted "date and time" string for a free-text field a user can
 * type directly into (see WatchDateDialog.tsx). `en-GB` — the only locale
 * this app currently supports — renders day-month-year order with a
 * 24-hour clock. See parseDateTimeInput's own doc comment for the
 * 12-hour-locale gap this doesn't yet handle (relevant if a locale like
 * `en-US` is ever added).
 */
export function formatDateTimeInput(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const DATE_TIME_PART_TYPES = ['day', 'month', 'year', 'hour', 'minute']

/**
 * Best-effort reverse of formatDateTimeInput — reads the locale's own
 * field order via formatToParts (rather than hardcoding DD/MM/YYYY) so it
 * stays correct if a locale with a different order is ever added, then
 * maps whatever digit groups the user typed onto that order positionally.
 * Ignores separators entirely, so "21/08/2026, 17:12", "21-08-2026 17:12",
 * or "21.08.2026 17.12" all parse the same way. Returns null on anything
 * that doesn't resolve to a valid date — callers should leave prior state
 * untouched rather than show an error for a first version of this.
 *
 * Known gap: DATE_TIME_PART_TYPES below has no `dayPeriod`, so on a
 * 12-hour locale a typed "5:30 PM" silently parses as 05:30 — no error,
 * just the wrong time. Harmless today since en-GB (the only locale this
 * app supports) is 24-hour, but this needs fixing before any 12-hour
 * locale (e.g. en-US) is added — see docs/TODO.md.
 */
export function parseDateTimeInput(text: string, locale: string): Date | null {
  const order = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })
    .formatToParts(new Date())
    .map((part) => part.type)
    .filter((type) => DATE_TIME_PART_TYPES.includes(type))

  const numbers = text.match(/\d+/g)
  if (!numbers || numbers.length < order.length) return null

  const values: Partial<Record<(typeof DATE_TIME_PART_TYPES)[number], number>> = {}
  order.forEach((type, index) => {
    values[type] = Number(numbers[index])
  })
  if (values.day === undefined || values.month === undefined || values.year === undefined) {
    return null
  }

  const year = values.year < 100 ? 2000 + values.year : values.year
  const date = new Date(year, values.month - 1, values.day, values.hour ?? 0, values.minute ?? 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Clamps `date` into `[min, max]` — `min` is optional (no lower bound when
 * omitted, e.g. an episode with no known air date). Used to keep a
 * manually-entered watch date sane: not before the episode aired, not
 * after "now" (see WatchDateDialog.tsx). */
export function clampDate(date: Date, min: Date | null, max: Date): Date {
  if (date.getTime() > max.getTime()) return new Date(max)
  if (min && date.getTime() < min.getTime()) return new Date(min)
  return date
}

/** `YYYY-MM-DD` in local time, for a native `<input type="date">` value. */
export function toDateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** `HH:MM` in local time, for a native `<input type="time">` value. */
export function toTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
