import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { asc, eq, gt, sql } from 'drizzle-orm'
import { listLibraryMoviesResponseSchema, listLibraryShowsResponseSchema } from '@rwnd/shared'
import { episodes, movies, plays, seasons, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'

export const libraryRoutes = new OpenAPIHono<AppEnv>()

/**
 * Backs the TV Shows gallery (apps/web/src/routes/ShowsPage.tsx). Unlike
 * /plays, this returns the user's whole library in one response — the
 * gallery's filter/sort controls are client-side (real libraries are
 * ~500 shows, comfortably one small payload), so there's no cursor here.
 *
 * "Watched episodes" and "total episodes" come from two independent
 * aggregates (CTEs), joined together afterwards, rather than one query
 * that joins plays/episodes and seasons directly against shows: doing that
 * in one GROUP BY fans out every matching season row against every
 * matching play row for the same show, multiplying SUM(episode_count) by
 * however many plays that show has. Keeping the aggregates separate avoids
 * that entirely — see apps/api/src/test/library.test.ts's
 * "does not double-count" case, which is what this shape exists to pass.
 *
 * Season 0 (specials) is excluded from both halves of the fraction — see
 * the `case when` in `watched` and the `gt` filter in `totals` — but a
 * show watched *only* via specials still needs to appear (206 of this
 * project's own plays are against specials, across 48 shows). That's why
 * the query drives from `watched`, not `shows`: a show enters the result
 * the moment it has any play at all, and only the numerator/denominator
 * exclude season 0, not membership in the list.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows',
    summary: 'List every show the current user has watched, with watch progress',
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Shows library',
        content: { 'application/json': { schema: listLibraryShowsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const watched = db.$with('watched').as(
      db
        .select({
          showId: episodes.showId,
          // COUNT(DISTINCT ... CASE ...) rather than a WHERE clause: a
          // WHERE season_number > 0 here would drop specials-only shows
          // from this CTE (and therefore the whole result, since it drives
          // the query) instead of just excluding them from the count.
          watchedEpisodes:
            sql<number>`count(distinct case when ${episodes.seasonNumber} > 0 then ${episodes.id} end)`
              .mapWith(Number)
              .as('watched_episodes'),
          // postgres.js only auto-parses timestamptz into a JS Date for
          // typed columns — a raw aggregate like this comes back as a
          // string, so map it explicitly rather than relying on the `<Date>`
          // type parameter (which affects TS typing only, not runtime).
          lastWatchedAt: sql`max(${plays.watchedAt})`
            .mapWith((v: string) => new Date(v))
            .as('last_watched_at'),
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
        .groupBy(episodes.showId),
    )

    const totals = db.$with('totals').as(
      db
        .select({
          showId: seasons.showId,
          // SUM(integer) is `numeric` in Postgres, which the driver returns
          // as a string — .mapWith(Number) is load-bearing, not cosmetic.
          totalEpisodes: sql<number>`sum(${seasons.episodeCount})`
            .mapWith(Number)
            .as('total_episodes'),
        })
        .from(seasons)
        .where(gt(seasons.seasonNumber, 0))
        .groupBy(seasons.showId),
    )

    const rows = await db
      .with(watched, totals)
      .select({
        id: shows.id,
        title: shows.title,
        year: shows.year,
        posterPath: shows.posterPath,
        genres: shows.genres,
        watchedEpisodes: watched.watchedEpisodes,
        lastWatchedAt: watched.lastWatchedAt,
        // Absent (null) until the metadata refresher has cached this show's
        // seasons — see apps/api/src/metadata/refresh.ts. Not 0: the UI
        // needs to tell "not counted yet" apart from "counted, zero".
        totalEpisodes: totals.totalEpisodes,
      })
      .from(watched)
      .innerJoin(shows, eq(shows.id, watched.showId))
      .leftJoin(totals, eq(totals.showId, watched.showId))
      .orderBy(asc(shows.title))

    return c.json({
      shows: rows.map((row) => ({
        id: row.id,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        genres: row.genres,
        watchedEpisodes: row.watchedEpisodes,
        totalEpisodes: row.totalEpisodes ?? null,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)

/** Backs the Movies gallery (apps/web/src/routes/MoviesPage.tsx). Only one
 * aggregate is needed — there's no second table to fan out against — so
 * this doesn't need the CTE split the shows query does. */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies',
    summary: 'List every movie the current user has watched, with play count',
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Movies library',
        content: { 'application/json': { schema: listLibraryMoviesResponseSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const rows = await db
      .select({
        id: movies.id,
        title: movies.title,
        year: movies.year,
        posterPath: movies.posterPath,
        playCount: sql<number>`count(${plays.id})`.mapWith(Number).as('play_count'),
        lastWatchedAt: sql`max(${plays.watchedAt})`
          .mapWith((v: string) => new Date(v))
          .as('last_watched_at'),
      })
      .from(plays)
      .innerJoin(movies, eq(plays.movieId, movies.id))
      .where(eq(plays.userId, userId))
      .groupBy(movies.id)
      .orderBy(asc(movies.title))

    return c.json({
      movies: rows.map((row) => ({
        id: row.id,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        playCount: row.playCount,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)
