import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { eq, sql } from 'drizzle-orm'
import { statsSummarySchema } from '@rwnd/shared'
import { episodes, movies, plays, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { watchedRangeFragments } from './library/shared.js'
import {
  medianRuntimeByShow,
  DEFAULT_EPISODE_RUNTIME_MINUTES,
  DEFAULT_MOVIE_RUNTIME_MINUTES,
} from '../lib/runtime.js'

export const statsRoutes = new OpenAPIHono<AppEnv>()

const count = sql<number>`count(*)`.mapWith(Number)

/**
 * Stage 1 (M6) of the stats feature: totals and top-10 shows/movies,
 * all-time only. No `after`/`before` scoping yet (stage 2) and no
 * `topGenres`/`ratings` (stage 3) — see docs/TODO.md and the M6 plan for
 * why those are staged separately rather than built all at once.
 *
 * Two per-title aggregates (all watched shows, all watched movies —
 * unlimited, not just top-10) drive everything below, rather than one
 * query per stat: totals/top-lists are derived from these rows in the
 * handler, which makes the numbers self-consistent by construction (the
 * `plays_exactly_one_media_ref` CHECK guarantees every play resolves to
 * exactly one title) and avoids any query joining two per-user tables
 * (the fan-out class of bug routes/library/shows.ts's own comment warns
 * about — see its two-CTE precedent).
 */
statsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/stats/summary',
    summary: "Aggregate stats over the current user's watch history",
    responses: {
      200: {
        description: 'Stats summary',
        content: { 'application/json': { schema: statsSummarySchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [showRows, movieRows, overall] = await Promise.all([
      db
        .select({
          id: shows.id,
          slug: shows.slug,
          title: shows.title,
          year: shows.year,
          posterPath: shows.posterPath,
          plays: count,
          episodes: sql<number>`count(distinct ${episodes.id})`.mapWith(Number),
          knownMinutes: sql<number>`coalesce(sum(${episodes.runtimeMinutes}), 0)`.mapWith(Number),
          nullRuntimePlays:
            sql<number>`count(*) filter (where ${episodes.runtimeMinutes} is null)`.mapWith(Number),
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .innerJoin(shows, eq(episodes.showId, shows.id))
        .where(eq(plays.userId, userId))
        .groupBy(shows.id),
      db
        .select({
          id: movies.id,
          slug: movies.slug,
          title: movies.title,
          year: movies.year,
          posterPath: movies.posterPath,
          plays: count,
          knownMinutes: sql<number>`coalesce(sum(${movies.runtimeMinutes}), 0)`.mapWith(Number),
          nullRuntimePlays:
            sql<number>`count(*) filter (where ${movies.runtimeMinutes} is null)`.mapWith(Number),
        })
        .from(plays)
        .innerJoin(movies, eq(plays.movieId, movies.id))
        .where(eq(plays.userId, userId))
        .groupBy(movies.id),
      db
        .select({
          plays: count,
          firstWatchedAt: watchedRangeFragments.firstWatchedAt,
          lastWatchedAt: watchedRangeFragments.lastWatchedAt,
          // Same sentinel (Trakt's 1900-01-01 "I don't remember when"
          // backfill value) watchedRangeFragments excludes from the two
          // fragments above — counted separately here rather than hidden,
          // matching hasUnknownWatchDate's "say so, don't just drop it"
          // convention.
          unknownDatePlays:
            sql<number>`count(*) filter (where extract(year from ${plays.watchedAt}) = 1900)`.mapWith(
              Number,
            ),
        })
        .from(plays)
        .where(eq(plays.userId, userId))
        .then((rows) => rows[0]!),
    ])

    const showIdsNeedingMedian = showRows
      .filter((row) => row.nullRuntimePlays > 0)
      .map((row) => row.id)
    const medianByShowId = await medianRuntimeByShow(db, showIdsNeedingMedian)

    let episodePlays = 0
    let distinctEpisodes = 0
    let minutesWatched = 0
    let estimatedMinutes = 0
    let playsWithoutRuntime = 0

    const topShows = showRows
      .map((row) => {
        const fallback = medianByShowId.get(row.id) ?? DEFAULT_EPISODE_RUNTIME_MINUTES
        const estimated = row.nullRuntimePlays * fallback
        const minutes = row.knownMinutes + estimated
        episodePlays += row.plays
        distinctEpisodes += row.episodes
        minutesWatched += minutes
        estimatedMinutes += estimated
        playsWithoutRuntime += row.nullRuntimePlays
        return {
          slug: row.slug,
          title: row.title,
          year: row.year,
          posterPath: row.posterPath,
          plays: row.plays,
          episodes: row.episodes,
          minutes,
        }
      })
      .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
      .slice(0, 10)

    let moviePlays = 0

    const topMovies = movieRows
      .map((row) => {
        const estimated = row.nullRuntimePlays * DEFAULT_MOVIE_RUNTIME_MINUTES
        const minutes = row.knownMinutes + estimated
        moviePlays += row.plays
        minutesWatched += minutes
        estimatedMinutes += estimated
        playsWithoutRuntime += row.nullRuntimePlays
        return {
          slug: row.slug,
          title: row.title,
          year: row.year,
          posterPath: row.posterPath,
          plays: row.plays,
          minutes,
        }
      })
      .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
      .slice(0, 10)

    return c.json({
      totals: {
        plays: overall.plays,
        episodePlays,
        moviePlays,
        distinctShows: showRows.length,
        distinctEpisodes,
        distinctMovies: movieRows.length,
        minutesWatched,
        estimatedMinutes,
        playsWithoutRuntime,
        firstWatchedAt: overall.firstWatchedAt
          ? new Date(overall.firstWatchedAt).toISOString()
          : null,
        lastWatchedAt: overall.lastWatchedAt ? new Date(overall.lastWatchedAt).toISOString() : null,
        unknownDatePlays: overall.unknownDatePlays,
      },
      topShows,
      topMovies,
    })
  },
)
