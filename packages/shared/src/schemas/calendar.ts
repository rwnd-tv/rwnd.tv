import { z } from 'zod'

export const calendarFeedTypeSchema = z.enum(['history', 'shows', 'movies'])
export type CalendarFeedType = z.infer<typeof calendarFeedTypeSchema>

/** 'history' only — which watched-item types appear. */
export const historyFeedSettingsSchema = z.object({
  includeMovies: z.boolean(),
  includeShows: z.boolean(),
})
export type HistoryFeedSettings = z.infer<typeof historyFeedSettingsSchema>

/** 'shows' only — dropped shows excluded unless opted back in; only
 * episodes airing today or later unless opted out; only shows watched
 * in the last 30 days (or watchlisted) count as "followed" unless
 * `includeAllWatched` drops that recency window entirely. */
export const showsFeedSettingsSchema = z.object({
  includeDropped: z.boolean(),
  futureOnly: z.boolean(),
  includeAllWatched: z.boolean(),
})
export type ShowsFeedSettings = z.infer<typeof showsFeedSettingsSchema>

/** 'movies' only — same candidate rule and settings as 'shows' above,
 * minus `includeDropped`: dropping is a shows-only concept, there is no
 * droppedMovies table. A movie counts as "followed" if it's on any
 * watchlist, or was watched in the last 30 days (or ever, with
 * `includeAllWatched`); `futureOnly` limits the feed to movies releasing
 * today or later. */
export const moviesFeedSettingsSchema = z.object({
  futureOnly: z.boolean(),
  includeAllWatched: z.boolean(),
})
export type MoviesFeedSettings = z.infer<typeof moviesFeedSettingsSchema>

/**
 * Discriminated on `feedType` so only the settings that mean anything for
 * a given feed ever cross the wire — the DB row carries all four booleans
 * (see `calendarFeeds`' doc comment, packages/db/src/schema.ts) but the
 * two that don't apply to a given row's type are neither returned nor
 * accepted here.
 *
 * `token` is the raw subscription secret and is returned on *every* read,
 * not once at creation the way `createApiTokenResponseSchema`'s is
 * (./tokens.js). That divergence is deliberate: an API token grants
 * arbitrary API access and is pasted once into one config; a feed URL
 * grants read-only access to one derived view and has to be re-copyable
 * every time its owner sets up another device. "Regenerate" is the
 * invalidation mechanism here, not one-time reveal.
 *
 * No `id`: exactly one feed of each type exists per user
 * (calendar_feeds_user_type_idx), so `feedType` is already the complete
 * key every route below addresses by.
 */
export const calendarFeedSchema = z.discriminatedUnion('feedType', [
  z.object({
    feedType: z.literal('history'),
    token: z.string(),
    settings: historyFeedSettingsSchema,
    lastAccessedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    feedType: z.literal('shows'),
    token: z.string(),
    settings: showsFeedSettingsSchema,
    lastAccessedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    feedType: z.literal('movies'),
    token: z.string(),
    settings: moviesFeedSettingsSchema,
    lastAccessedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
])
export type CalendarFeed = z.infer<typeof calendarFeedSchema>

export const listCalendarFeedsResponseSchema = z.object({
  feeds: z.array(calendarFeedSchema),
})
export type ListCalendarFeedsResponse = z.infer<typeof listCalendarFeedsResponseSchema>

export const createCalendarFeedRequestSchema = z.object({
  feedType: calendarFeedTypeSchema,
})
export type CreateCalendarFeedRequest = z.infer<typeof createCalendarFeedRequestSchema>

/** All four keys optional and flat rather than a second discriminated
 * union: each route binds one body schema, and the addressed feed's own
 * type already determines which keys mean anything. A key that doesn't
 * apply to the addressed type is ignored rather than rejected — a body
 * of only-inapplicable keys is a 200 no-op, not a 400. `{ includeMovies:
 * false, includeShows: false }` is likewise allowed: a coherent "pause
 * this feed without unsubscribing on every device" state that yields a
 * valid, empty calendar. */
export const updateCalendarFeedRequestSchema = z.object({
  includeMovies: z.boolean().optional(),
  includeShows: z.boolean().optional(),
  includeDropped: z.boolean().optional(),
  futureOnly: z.boolean().optional(),
  includeAllWatched: z.boolean().optional(),
})
export type UpdateCalendarFeedRequest = z.infer<typeof updateCalendarFeedRequestSchema>
