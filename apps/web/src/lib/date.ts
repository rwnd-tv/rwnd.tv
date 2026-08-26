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
 * type directly into (see WatchDateDialog.tsx). Renders whatever field
 * order and 12-/24-hour convention the locale itself uses (day-month-year,
 * 24-hour for `en-GB`; month-day-year, 12-hour + AM/PM for `en-US`) — see
 * parseDateTimeInput below for how that's read back.
 */
export function formatDateTimeInput(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const DATE_TIME_PART_TYPES = ['day', 'month', 'year', 'hour', 'minute']

/**
 * The literal AM/PM strings a 12-hour locale renders (e.g. "AM"/"PM" for
 * `en-US`) — derived from the locale itself via two reference times rather
 * than hardcoded, so this isn't tied to English wording. `null` for a
 * 24-hour locale (formatToParts emits no `dayPeriod` part at all), which
 * is how parseDateTimeInput below knows not to expect one.
 */
function dayPeriodStrings(locale: string): { am: string; pm: string } | null {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })
  const am = formatter
    .formatToParts(new Date(2020, 0, 1, 1, 0))
    .find((part) => part.type === 'dayPeriod')?.value
  const pm = formatter
    .formatToParts(new Date(2020, 0, 1, 13, 0))
    .find((part) => part.type === 'dayPeriod')?.value
  return am && pm ? { am, pm } : null
}

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
 * On a 12-hour locale, the numeric `hour` extracted below is 1-12, not
 * 0-23 (Intl's own `hour` part carries no am/pm information) — resolved
 * against whichever of dayPeriodStrings' two markers appears in the typed
 * text. Neither marker present is treated as unparseable (null) rather
 * than guessing — this is the fix for a real bug: silently assuming AM
 * meant a typed "5:30 PM" saved as 05:30 with no error.
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

  let hour = values.hour
  const periods = dayPeriodStrings(locale)
  if (periods && hour !== undefined) {
    const lower = text.toLowerCase()
    const isPM = lower.includes(periods.pm.toLowerCase())
    const isAM = lower.includes(periods.am.toLowerCase())
    if (!isPM && !isAM) return null
    if (isPM && hour !== 12) hour += 12
    if (isAM && hour === 12) hour = 0
  }

  const year = values.year < 100 ? 2000 + values.year : values.year
  const date = new Date(year, values.month - 1, values.day, hour ?? 0, values.minute ?? 0)
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

/**
 * Human-friendly label for a Dashboard tile's date caption (Continue
 * Watching/Upcoming/History rows — OnDeckRow.tsx/UpNextRow.tsx/
 * HistoryRow.tsx) — "Today"/"Yesterday"/"Tomorrow" in place of a bare
 * day/month for the immediate cases (James, 2026-08-25). `weekdayWithinDays`
 * is 0 by default (History/Continue Watching never show a date beyond
 * today, so there's nothing for it to do); Upcoming passes 7, so a date
 * more than a day out but still within the coming week renders as a
 * weekday name ("Wednesday") rather than "27 Aug", falling back to the
 * existing day/month format beyond that window.
 */
/** Whole calendar days between `date` and today (local time), negative for
 * the past — shared by formatDashboardDate/formatHistoryDate below so both
 * "how many days away is this" checks stay in sync. */
function daysFromToday(date: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / 86_400_000)
}

export function formatDashboardDate(
  date: Date,
  locale: string,
  t: (key: string) => string,
  weekdayWithinDays = 0,
): string {
  const dayDiff = daysFromToday(date)

  if (dayDiff === 0) return t('common.today')
  if (dayDiff === -1) return t('common.yesterday')
  if (dayDiff === 1) return t('common.tomorrow')
  if (weekdayWithinDays > 0 && dayDiff > 1 && dayDiff <= weekdayWithinDays) {
    return date.toLocaleDateString(locale, { weekday: 'long' })
  }
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * Same "Today"/"Yesterday" treatment as formatDashboardDate above, but for
 * a date that's always in the past (a logged watch) rather than a near-term
 * window — falls back to a full `dateStyle: 'medium'` date (year included)
 * instead of formatDashboardDate's day/month-only fallback, since a watch's
 * date can be years old (e.g. Trakt-imported history) where the year
 * matters.
 */
export function formatHistoryDate(date: Date, locale: string, t: (key: string) => string): string {
  const dayDiff = daysFromToday(date)
  if (dayDiff === 0) return t('common.today')
  if (dayDiff === -1) return t('common.yesterday')
  return date.toLocaleDateString(locale, { dateStyle: 'medium' })
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

/**
 * Inverse of toDateInputValue — the exact instant a "YYYY-MM-DD" day
 * (as picked from a native `<input type="date">`, see
 * DateRangeFilterPanel.tsx) starts/ends in the *browser's* local timezone,
 * as an ISO string ready for the API's `after`/`before` params
 * (listActivityQuerySchema). Deliberately resolved client-side against
 * `new Date(year, month, day, ...)` (which the JS Date constructor always
 * treats as local time) rather than sent as a bare date for the server to
 * interpret — the server has no per-user timezone to interpret it against,
 * and HistoryPage.tsx's own day-heading grouping already uses the
 * browser's local time (`toLocaleDateString`), so this keeps the filter
 * boundary and the headings it's filtering agreeing on what day a moment
 * near midnight actually falls on, rather than the two silently disagreeing
 * whenever the browser isn't in UTC.
 */
export function localDayStartISO(dayString: string): string {
  const [year, month, day] = dayString.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 0, 0, 0, 0).toISOString()
}

/** Inverse of toDateInputValue — see localDayStartISO's doc comment. */
export function localDayEndISO(dayString: string): string {
  const [year, month, day] = dayString.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 23, 59, 59, 999).toISOString()
}
