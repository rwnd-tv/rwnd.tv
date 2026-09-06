import { z } from 'zod'
import { playMediaSummarySchema } from './plays.js'

/**
 * The in-app calendar page's merged timeline (`GET /calendar-events`,
 * apps/web/src/routes/CalendarPage.tsx) — distinct from `calendar.ts`'s
 * feed CRUD types next door, which are about the webcal/iCal subscription
 * feeds' token/settings, not the event data itself. `watch` events are
 * always in the past (derived from `plays.watchedAt`); `episode`/`release`
 * are always `futureOnly` (see apps/api/src/calendar/build.ts's
 * buildCalendarTimeline) — that split is what makes the merged timeline
 * read as "watched so far, then what's coming," not a symmetric window.
 */
export const CALENDAR_EVENT_KINDS = ['watch', 'episode', 'release'] as const
export const calendarEventKindSchema = z.enum(CALENDAR_EVENT_KINDS)
export type CalendarEventKind = z.infer<typeof calendarEventKindSchema>

const calendarEventBaseSchema = z.object({
  /** The same UID the .ics feed emits for this event
   * ('play-<uuid>@rwnd.tv', 'episode-<uuid>@rwnd.tv', 'movie-<uuid>@rwnd.tv',
   * see apps/api/src/calendar/build.ts) — stable across refetches, so it
   * doubles as the React list key. */
  uid: z.string(),
  /** Reused wholesale from GET /activity-feed's own media shape
   * (playMediaSummarySchema) so the frontend can share one
   * PosterTile-based rendering path (apps/web/src/components/calendar/
   * CalendarEventTile.tsx) with ActivityTile.tsx. For an `episode` event,
   * `media.title` is the real episode title (or a bare "S{s} E{e}"
   * fallback only when no title is cached yet) — not spoiler-redacted at
   * this layer; see `spoilerHidden` below for how the frontend guards it. */
  media: playMediaSummarySchema,
  /** The raw synopsis, with no link appended and no spoiler omission —
   * unlike the .ics feed's `description`, which withholds a spoiler-
   * guarded overview outright (iCalendar has no reveal mechanism). This
   * endpoint always sends the real value; `spoilerHidden` tells the
   * frontend to blur/substitute it client-side instead
   * (apps/web/src/components/library/SpoilerGuard.tsx and
   * EpisodeCard.tsx's own text-substitution precedent). */
  overview: z.string().nullable(),
  watched: z.boolean(),
  /** `user.spoilerProtectionEnabled && !watched`, computed server-side —
   * always false for `watch` events (already watched by construction). */
  spoilerHidden: z.boolean(),
})

export const calendarEventSchema = z.discriminatedUnion('kind', [
  calendarEventBaseSchema.extend({
    kind: z.literal('watch'),
    /** `endsAt` is the recorded `plays.watchedAt` (playback *finished*,
     * not started); `startsAt` is derived from runtime and clamped
     * against the previous play — see build.ts's buildHistoryEvents. */
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  calendarEventBaseSchema.extend({
    kind: z.literal('episode'),
    /** A bare 'YYYY-MM-DD' calendar day, same convention as
     * `episodes.firstAired` — no time-of-day to build a real instant
     * from. */
    date: z.string(),
  }),
  calendarEventBaseSchema.extend({
    kind: z.literal('release'),
    /** A bare 'YYYY-MM-DD' calendar day, the user's region-resolved
     * release date (see apps/api/src/lib/release-date.ts), same
     * convention as `movies.releaseDate`. */
    date: z.string(),
  }),
])
export type CalendarEvent = z.infer<typeof calendarEventSchema>

/**
 * Inclusive instant bounds, resolved against the *browser's* local day
 * boundaries before being sent — same convention as
 * `listActivityQuerySchema`'s `after`/`before`
 * (apps/web/src/lib/date.ts's `localDayStartISO`/`localDayEndISO`).
 * Required, not defaulted: both the Agenda and Month views always know
 * exactly which window they're showing.
 */
export const listCalendarEventsQuerySchema = z.object({
  after: z.string().datetime(),
  before: z.string().datetime(),
})
export type ListCalendarEventsQuery = z.infer<typeof listCalendarEventsQuerySchema>

export const listCalendarEventsResponseSchema = z.object({
  events: z.array(calendarEventSchema),
})
export type ListCalendarEventsResponse = z.infer<typeof listCalendarEventsResponseSchema>
