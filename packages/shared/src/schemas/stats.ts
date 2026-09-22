import { z } from 'zod'

/**
 * GET /stats/summary's query params — stage 2 (M6): optional `after`/
 * `before` full ISO instants, same shape and same reasoning as
 * listActivityQuerySchema's own after/before (packages/shared/src/schemas/
 * activity.ts): the frontend's year selector resolves "start of year"/"end
 * of year" against the *browser's* local timezone (date.ts's
 * localDayStartISO/localDayEndISO, fed `YYYY-01-01`/`YYYY-12-31`) before
 * sending it here, since there's no per-user timezone tracked server-side
 * to do that conversion against instead. Omitted entirely for the all-time
 * view.
 */
export const statsSummaryQuerySchema = z.object({
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
})
export type StatsSummaryQuery = z.infer<typeof statsSummaryQuerySchema>

/**
 * GET /stats/summary — totals, top-10 shows/movies, top-10 genres, and a
 * ratings histogram, optionally scoped to an `after`/`before` window
 * (statsSummaryQuerySchema above).
 *
 * `firstWatchedAt`/`lastWatchedAt` are the first/last watch *within the
 * requested window*, not necessarily the account's all-time first/last —
 * scoping the totals also scopes these.
 *
 * `minutesWatched` leans on the same own-runtime -> per-show sibling
 * median -> flat default fallback ladder apps/api/src/calendar/build.ts
 * already uses for the same reason (a real fraction of episodes/movies
 * have no cached runtime at all, some permanently — see
 * apps/api/src/metadata/refresh.ts's Gate A). `estimatedMinutes` and
 * `playsWithoutRuntime` exist so the frontend can honestly caveat the
 * headline number rather than presenting a guess as exact.
 */
export const statsTotalsSchema = z.object({
  plays: z.number().int(),
  episodePlays: z.number().int(),
  moviePlays: z.number().int(),
  distinctShows: z.number().int(),
  distinctEpisodes: z.number().int(),
  distinctMovies: z.number().int(),
  minutesWatched: z.number().int(),
  estimatedMinutes: z.number().int(),
  playsWithoutRuntime: z.number().int(),
  firstWatchedAt: z.string().datetime().nullable(),
  lastWatchedAt: z.string().datetime().nullable(),
  unknownDatePlays: z.number().int(),
})
export type StatsTotals = z.infer<typeof statsTotalsSchema>

export const statsTopShowSchema = z.object({
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  plays: z.number().int(),
  episodes: z.number().int(),
  minutes: z.number().int(),
})
export type StatsTopShow = z.infer<typeof statsTopShowSchema>

export const statsTopMovieSchema = z.object({
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  plays: z.number().int(),
  minutes: z.number().int(),
})
export type StatsTopMovie = z.infer<typeof statsTopMovieSchema>

/**
 * One genre's aggregate across every watched show/movie in scope (stage 3,
 * M6) — `minutes` sums every title tagged with this genre, so a 3-genre
 * title's minutes count toward all 3 rows: genre-minutes sums exceed
 * `totals.minutesWatched` by design, not a bug. `titles` is the number of
 * distinct shows/movies contributing, shown alongside `minutes` since two
 * genres can tie (or nearly tie) on minutes for very different reasons (a
 * handful of long-running shows vs. many short ones). Genre strings are
 * unnormalized provider names (TMDB's TV and movie vocabularies differ,
 * e.g. "Sci-Fi & Fantasy" vs. "Science Fiction") — accepted as a known
 * cosmetic issue rather than built out into a normalization layer.
 */
export const statsTopGenreSchema = z.object({
  genre: z.string(),
  minutes: z.number().int(),
  titles: z.number().int(),
})
export type StatsTopGenre = z.infer<typeof statsTopGenreSchema>

/** One rating value (1-10)'s counts, split by entity type — zero-filled by
 * the handler, so `distribution` always has exactly 10 entries even for a
 * rating value nobody has used. */
export const statsRatingBucketSchema = z.object({
  rating: z.number().int().min(1).max(10),
  movie: z.number().int(),
  show: z.number().int(),
  episode: z.number().int(),
  total: z.number().int(),
})
export type StatsRatingBucket = z.infer<typeof statsRatingBucketSchema>

/**
 * Ratings histogram (stage 3, M6) — scoped by `ratedAt`, not `watchedAt`:
 * unlike every other field in statsSummarySchema, a year-scoped ratings
 * histogram is therefore *not* a subset of that year's watches (you can
 * rate a title you watched in a different year, or one you've never
 * logged a watch for at all). Worth a line of UI copy wherever this is
 * shown alongside a year selector, so the two don't read as contradictory.
 */
export const statsRatingsSchema = z.object({
  total: z.number().int(),
  average: z.number().nullable(),
  distribution: z.array(statsRatingBucketSchema).length(10),
})
export type StatsRatings = z.infer<typeof statsRatingsSchema>

export const statsSummarySchema = z.object({
  totals: statsTotalsSchema,
  topShows: z.array(statsTopShowSchema).max(10),
  topMovies: z.array(statsTopMovieSchema).max(10),
  topGenres: z.array(statsTopGenreSchema).max(10),
  ratings: statsRatingsSchema,
})
export type StatsSummary = z.infer<typeof statsSummarySchema>

/**
 * GET /stats/timeline — stage 2 (M6). Unscoped (no `after`/`before`) and
 * fetched once by the frontend rather than refetched on every year-selector
 * change: `availableYears` for that selector, and the activity-over-time
 * chart's per-month/per-year bucketing, are both derived **client-side**
 * from these arrays (apps/web/src/lib/stats-buckets.ts) so the bucketing is
 * always in the *browser's* local timezone — the same reasoning
 * statsSummaryQuerySchema's doc comment gives for why the server can't do
 * this itself.
 *
 * Arrays are every non-sentinel play's `watchedAt`, as whole **epoch
 * minutes** (not milliseconds/seconds) — minute granularity is exactly
 * sufficient for day-of-week/hour-of-day bucketing in any timezone and
 * keeps the payload far smaller than an array of ISO strings would be.
 * Ascending order, matching `plays_user_watched_at_idx`'s scan direction so
 * the query needs no extra sort. The 1900 sentinel (`UNKNOWN_WATCHED_AT`)
 * is excluded from both arrays (it isn't a real watch date) and counted
 * separately via `unknownDatePlays`, same policy as statsTotalsSchema's own
 * field of the same name — **deliberately not capped** the way the
 * calendar feed caps events: a silently truncated array would produce a
 * silently wrong chart.
 */
export const statsTimelineSchema = z.object({
  episodePlays: z.array(z.number().int()),
  moviePlays: z.array(z.number().int()),
  unknownDatePlays: z.number().int(),
})
export type StatsTimeline = z.infer<typeof statsTimelineSchema>
