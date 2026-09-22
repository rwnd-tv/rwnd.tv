import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, asc, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm'
import {
  UNKNOWN_WATCHED_AT,
  statsSummaryQuerySchema,
  statsSummarySchema,
  statsTimelineSchema,
} from '@rwnd/shared'
import { episodes, movies, plays, ratings, shows } from '@rwnd/db'
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
 * `after`/`before` are pre-resolved full ISO instants (statsSummaryQuerySchema's
 * doc comment), parsed to `Date` here — plain `gte`/`lte` against
 * `plays.watchedAt` work directly with a `Date`, no raw-SQL `::timestamptz`
 * cast needed, since (unlike activity.ts's unioned CTE column) this is a
 * real typed column Drizzle already knows how to encode a bound against.
 * Same idiom as calendar/build.ts's `opts.after`/`opts.before` handling.
 */
function boundsFilter(userId: string, after: string | undefined, before: string | undefined) {
  return and(
    eq(plays.userId, userId),
    after ? gte(plays.watchedAt, new Date(after)) : undefined,
    before ? lte(plays.watchedAt, new Date(before)) : undefined,
  )
}

/**
 * Same idea as boundsFilter, against `ratings.ratedAt` instead of
 * `plays.watchedAt` — statsRatingsSchema's doc comment explains why the
 * ratings histogram is scoped by when a title was *rated*, not watched.
 */
function ratingsBoundsFilter(
  userId: string,
  after: string | undefined,
  before: string | undefined,
) {
  return and(
    eq(ratings.userId, userId),
    after ? gte(ratings.ratedAt, new Date(after)) : undefined,
    before ? lte(ratings.ratedAt, new Date(before)) : undefined,
  )
}

const RATING_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/**
 * Totals, top-10 shows/movies/genres, and a ratings histogram, optionally
 * scoped to an `after`/`before` window.
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
    request: { query: statsSummaryQuerySchema },
    responses: {
      200: {
        description: 'Stats summary',
        content: { 'application/json': { schema: statsSummarySchema } },
      },
    },
  }),
  async (c) => {
    const { after, before } = c.req.valid('query')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [showRows, movieRows, overall, ratingRows] = await Promise.all([
      db
        .select({
          id: shows.id,
          slug: shows.slug,
          title: shows.title,
          year: shows.year,
          posterPath: shows.posterPath,
          genres: shows.genres,
          plays: count,
          episodes: sql<number>`count(distinct ${episodes.id})`.mapWith(Number),
          knownMinutes: sql<number>`coalesce(sum(${episodes.runtimeMinutes}), 0)`.mapWith(Number),
          nullRuntimePlays:
            sql<number>`count(*) filter (where ${episodes.runtimeMinutes} is null)`.mapWith(Number),
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .innerJoin(shows, eq(episodes.showId, shows.id))
        .where(boundsFilter(userId, after, before))
        .groupBy(shows.id),
      db
        .select({
          id: movies.id,
          slug: movies.slug,
          title: movies.title,
          year: movies.year,
          posterPath: movies.posterPath,
          genres: movies.genres,
          plays: count,
          knownMinutes: sql<number>`coalesce(sum(${movies.runtimeMinutes}), 0)`.mapWith(Number),
          nullRuntimePlays:
            sql<number>`count(*) filter (where ${movies.runtimeMinutes} is null)`.mapWith(Number),
        })
        .from(plays)
        .innerJoin(movies, eq(plays.movieId, movies.id))
        .where(boundsFilter(userId, after, before))
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
          // convention. Never actually inside an after/before window in
          // practice (1900 predates any real year selection), but not
          // special-cased on that assumption either — boundsFilter applies
          // here exactly like the other two queries.
          unknownDatePlays:
            sql<number>`count(*) filter (where extract(year from ${plays.watchedAt}) = 1900)`.mapWith(
              Number,
            ),
        })
        .from(plays)
        .where(boundsFilter(userId, after, before))
        .then((rows) => rows[0]!),
      // Independent of `plays` entirely — ratingsBoundsFilter's doc comment
      // explains why this is scoped by ratedAt rather than watchedAt.
      db
        .select({
          rating: ratings.rating,
          movie: sql<number>`count(*) filter (where ${ratings.entityType} = 'movie')`.mapWith(
            Number,
          ),
          show: sql<number>`count(*) filter (where ${ratings.entityType} = 'show')`.mapWith(Number),
          episode: sql<number>`count(*) filter (where ${ratings.entityType} = 'episode')`.mapWith(
            Number,
          ),
          total: count,
        })
        .from(ratings)
        .where(ratingsBoundsFilter(userId, after, before))
        .groupBy(ratings.rating),
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

    // Genre aggregation (topGenres below) needs every watched title's
    // minutes, not just the top 10 — computed over the full array here,
    // sliced to 10 only for topShows/topMovies themselves.
    const genreMinutes = new Map<string, { minutes: number; titleIds: Set<string> }>()
    const addToGenres = (row: { id: string; genres: string[] }, minutes: number) => {
      for (const genre of row.genres) {
        const entry = genreMinutes.get(genre) ?? { minutes: 0, titleIds: new Set() }
        entry.minutes += minutes
        entry.titleIds.add(row.id)
        genreMinutes.set(genre, entry)
      }
    }

    const allShows = showRows.map((row) => {
      const fallback = medianByShowId.get(row.id) ?? DEFAULT_EPISODE_RUNTIME_MINUTES
      const estimated = row.nullRuntimePlays * fallback
      const minutes = row.knownMinutes + estimated
      episodePlays += row.plays
      distinctEpisodes += row.episodes
      minutesWatched += minutes
      estimatedMinutes += estimated
      playsWithoutRuntime += row.nullRuntimePlays
      addToGenres(row, minutes)
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
    const topShows = [...allShows]
      .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
      .slice(0, 10)

    let moviePlays = 0

    const allMovies = movieRows.map((row) => {
      const estimated = row.nullRuntimePlays * DEFAULT_MOVIE_RUNTIME_MINUTES
      const minutes = row.knownMinutes + estimated
      moviePlays += row.plays
      minutesWatched += minutes
      estimatedMinutes += estimated
      playsWithoutRuntime += row.nullRuntimePlays
      addToGenres(row, minutes)
      return {
        slug: row.slug,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        plays: row.plays,
        minutes,
      }
    })
    const topMovies = [...allMovies]
      .sort((a, b) => b.minutes - a.minutes || b.plays - a.plays)
      .slice(0, 10)

    const topGenres = [...genreMinutes.entries()]
      .map(([genre, { minutes, titleIds }]) => ({ genre, minutes, titles: titleIds.size }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)

    const ratingByValue = new Map(ratingRows.map((row) => [row.rating, row]))
    let ratingsTotal = 0
    let ratingsWeightedSum = 0
    const ratingsDistribution = RATING_VALUES.map((rating) => {
      const row = ratingByValue.get(rating)
      const total = row?.total ?? 0
      ratingsTotal += total
      ratingsWeightedSum += rating * total
      return {
        rating,
        movie: row?.movie ?? 0,
        show: row?.show ?? 0,
        episode: row?.episode ?? 0,
        total,
      }
    })

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
      topGenres,
      ratings: {
        total: ratingsTotal,
        average: ratingsTotal > 0 ? ratingsWeightedSum / ratingsTotal : null,
        distribution: ratingsDistribution,
      },
    })
  },
)

/**
 * GET /stats/timeline — stage 2 (M6). See statsTimelineSchema's doc comment
 * for the response shape/reasoning. Two plain queries (episode plays, movie
 * plays), not one — `plays_exactly_one_media_ref` guarantees they're
 * disjoint, and keeping them separate here is what lets the frontend stack
 * episodes vs. movies in the activity chart without re-deriving that split
 * from a mixed array. Ordered ascending by `plays_user_watched_at_idx`'s
 * own scan direction, so no extra sort work.
 */
statsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/stats/timeline',
    summary: "Every watched-at instant in the current user's history, for client-side bucketing",
    responses: {
      200: {
        description: 'Watch timeline',
        content: { 'application/json': { schema: statsTimelineSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const sentinelExcluded = ne(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT))

    const [episodeRows, movieRows, unknownDatePlays] = await Promise.all([
      db
        .select({ watchedAt: plays.watchedAt })
        .from(plays)
        .where(and(eq(plays.userId, userId), isNotNull(plays.episodeId), sentinelExcluded))
        .orderBy(asc(plays.watchedAt)),
      db
        .select({ watchedAt: plays.watchedAt })
        .from(plays)
        .where(and(eq(plays.userId, userId), isNotNull(plays.movieId), sentinelExcluded))
        .orderBy(asc(plays.watchedAt)),
      db
        .select({
          count:
            sql<number>`count(*) filter (where extract(year from ${plays.watchedAt}) = 1900)`.mapWith(
              Number,
            ),
        })
        .from(plays)
        .where(eq(plays.userId, userId))
        .then((rows) => rows[0]!.count),
    ])

    const toEpochMinutes = (rows: { watchedAt: Date }[]) =>
      rows.map((row) => Math.floor(row.watchedAt.getTime() / 60_000))

    return c.json({
      episodePlays: toEpochMinutes(episodeRows),
      moviePlays: toEpochMinutes(movieRows),
      unknownDatePlays,
    })
  },
)
