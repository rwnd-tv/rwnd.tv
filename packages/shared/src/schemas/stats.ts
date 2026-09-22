import { z } from 'zod'

/**
 * GET /stats/summary — stage 1 (M6): totals and top-10 shows/movies only,
 * all-time (no `after`/`before` scoping yet — that's stage 2, once the
 * timeline endpoint and the frontend's local-timezone year selector exist
 * to feed it pre-resolved instants the same way listActivityQuerySchema's
 * after/before already do). `topGenres`/`ratings` are stage 3.
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

export const statsSummarySchema = z.object({
  totals: statsTotalsSchema,
  topShows: z.array(statsTopShowSchema).max(10),
  topMovies: z.array(statsTopMovieSchema).max(10),
})
export type StatsSummary = z.infer<typeof statsSummarySchema>
