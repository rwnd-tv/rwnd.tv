/**
 * Minimal RFC 5545 (iCalendar) writer — no dependency pulled in for this,
 * same reasoning as csv.ts: the escaping/folding rules are a handful of
 * lines each way, and this only ever needs to *write* a feed, never
 * parse one. Shared by every calendar feed type (apps/api/src/calendar/
 * build.ts), so the format has one home.
 *
 * Two event shapes: all-day (`DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE`,
 * a bare calendar day) for the TV Shows feed, where `episodes.firstAired`
 * has no time-of-day to build a real instant from; timed (`DTSTART`/
 * `DTEND` as UTC instants) for the History feed, where `plays.watchedAt`
 * is a precise timestamp. Emitted as plain UTC rather than with a `TZID`:
 * `users.timezone` is never actually set by the app today (see
 * calendar/build.ts), so a `VTIMEZONE` block would add DST-rule machinery
 * for a value that's `'UTC'` on every account in practice — the
 * subscribing client localises the instant on its own.
 */

interface IcsEventBase {
  /** Fully-formed, including the `@rwnd.tv` domain part. Stable across
   * every refresh — that's what makes a subscribing client update an
   * event in place instead of creating a duplicate. */
  uid: string
  summary: string
  /** Episode/movie synopsis. Omitted entirely (no empty `DESCRIPTION:`
   * line) rather than passed as `''` when there's nothing to show —
   * absent because there's no cached overview yet, or withheld by the
   * caller's own spoiler check (apps/api/src/calendar/build.ts). */
  description?: string
  /** DTSTAMP. Derived from the source row (e.g. its own createdAt), not
   * `new Date()` — that's what makes buildIcs produce a byte-identical
   * file across repeated calls against unchanged data. */
  stamp: Date
}

export interface IcsAllDayEvent extends IcsEventBase {
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string
}

export interface IcsTimedEvent extends IcsEventBase {
  start: Date
  end: Date
}

export type IcsEvent = IcsAllDayEvent | IcsTimedEvent

export interface IcsCalendar {
  /** X-WR-CALNAME, e.g. 'rwnd.tv — TV Shows'. Non-standard but
   * universally honoured, and the only way to name a subscribed
   * calendar in Google/Apple/Outlook. */
  name: string
  events: IcsEvent[]
}

const MAX_OCTETS = 75

/** RFC 5545 §3.3.11 TEXT escaping. Backslash first, or every escape
 * below gets double-escaped. `:` is deliberately NOT escaped — it's
 * only escaped in some other value types, and escaping it here breaks
 * Apple Calendar. */
function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // TEXT forbids control characters other than HTAB; a provider-sourced
      // title could in principle carry one, and a stricter client will
      // reject the whole file over it rather than just that value.
      // eslint-disable-next-line no-control-regex -- deliberately matching control characters to strip them
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  )
}

/** RFC 5545 §3.1 line folding: a content line over 75 *octets* (not
 * characters) must be split across multiple physical lines, each
 * continuation starting with a single space. A naive character-slice
 * both overshoots for non-ASCII and can split a UTF-8 continuation byte
 * or a surrogate pair — a show title with an accent, an em dash, or CJK
 * text hits this immediately. Folding (or later unfolding) never needs
 * to be escape-aware: it may legally land mid-escape-sequence (`\` on
 * one line, `,` on the next), and unfolding restores the exact octet
 * sequence before any escape processing happens. */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= MAX_OCTETS) return line

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let start = 0
  // The first line gets the full budget; each continuation line's
  // leading space counts toward its own 75, leaving 74 of payload.
  let budget = MAX_OCTETS
  while (start < bytes.length) {
    let end = Math.min(start + budget, bytes.length)
    // Never cut mid-codepoint: back off any UTF-8 continuation byte
    // (0b10xxxxxx) so each chunk decodes cleanly on its own.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    chunks.push(decoder.decode(bytes.subarray(start, end)))
    start = end
    budget = MAX_OCTETS - 1
  }
  return chunks.join('\r\n ')
}

function contentLine(name: string, value: string): string {
  return foldLine(`${name}:${value}`)
}

/** `YYYYMMDD` for a `VALUE=DATE` property. */
function formatDate(date: string): string {
  return date.replace(/-/g, '')
}

/** DTEND for a single all-day event is exclusive per RFC 5545 — it must
 * be the day *after* the event, or Google/Apple render a zero-length or
 * missing event. `Date.UTC` arithmetic on the parsed YYYY-MM-DD is
 * DST-immune (a bare date has no wall-clock component to shift). */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1))
  return next.toISOString().slice(0, 10)
}

/** DTSTAMP, in the UTC `YYYYMMDDTHHMMSSZ` form RFC 5545 requires. */
function formatStamp(stamp: Date): string {
  return stamp
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function buildEvent(event: IcsEvent): string[] {
  const dateLines =
    'date' in event
      ? [
          `DTSTART;VALUE=DATE:${formatDate(event.date)}`,
          `DTEND;VALUE=DATE:${formatDate(nextDay(event.date))}`,
        ]
      : [`DTSTART:${formatStamp(event.start)}`, `DTEND:${formatStamp(event.end)}`]

  return [
    'BEGIN:VEVENT',
    contentLine('UID', event.uid),
    contentLine('DTSTAMP', formatStamp(event.stamp)),
    ...dateLines,
    contentLine('SUMMARY', escapeText(event.summary)),
    ...(event.description ? [contentLine('DESCRIPTION', escapeText(event.description))] : []),
    // Informational only — must not mark the subscriber busy in a
    // free/busy view.
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ]
}

/**
 * Builds a complete VCALENDAR document. `METHOD:PUBLISH` and
 * `X-WR-CALNAME` are read-only-subscription conventions (the former in
 * particular is what makes Outlook treat this as a subscription rather
 * than an invitation). No `VTIMEZONE`/`X-WR-TIMEZONE`: an all-day
 * `VALUE=DATE` event is floating by definition, and a timed event is
 * always emitted as a UTC instant (see this file's top-of-file comment),
 * which needs no timezone definition either. No `SEQUENCE`: it only
 * matters for iTIP REQUEST/CANCEL flows, not a `METHOD:PUBLISH` feed a
 * client re-reads in full on every poll.
 */
export function buildIcs(calendar: IcsCalendar): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//rwnd.tv//rwnd.tv Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    contentLine('X-WR-CALNAME', escapeText(calendar.name)),
    ...calendar.events.flatMap(buildEvent),
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
