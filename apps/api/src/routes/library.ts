import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import {
  listLibraryMoviesResponseSchema,
  listLibraryShowsResponseSchema,
  showDetailSchema,
} from '@rwnd/shared'
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
        slug: shows.slug,
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
        slug: row.slug,
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

/**
 * Backs the per-show page (apps/web/src/routes/ShowDetailPage.tsx), linked
 * to from the shows gallery and History. Not scoped to "shows this user has
 * watched" the way /library/shows is — the show itself is shared metadata,
 * not per-user data, so any authenticated user can look up any show that
 * exists locally; only the per-season/total watched counts are scoped to
 * the current user (and default to 0 for a show they haven't touched).
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}',
    summary: "Get a show, with the current user's watch progress",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show detail',
        content: { 'application/json': { schema: showDetailSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const seasonRows = await db
      .select()
      .from(seasons)
      .where(eq(seasons.showId, show.id))
      .orderBy(asc(seasons.seasonNumber))

    // Real per-season counts, specials included — unlike the gallery-style
    // totals below, nothing here excludes season 0.
    const watchedBySeason = await db
      .select({
        seasonNumber: episodes.seasonNumber,
        watchedEpisodes: sql<number>`count(distinct ${episodes.id})`
          .mapWith(Number)
          .as('watched_episodes'),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))
      .groupBy(episodes.seasonNumber)
    const watchedMap = new Map(
      watchedBySeason.map((row) => [row.seasonNumber, row.watchedEpisodes]),
    )

    // First/most recent watch, across every season (specials included) —
    // this is "when did I watch this show", not the gallery-style totals
    // below, so nothing here excludes season 0. MIN/MAX over zero matching
    // rows still returns one row (both columns null), not zero rows.
    //
    // A play dated exactly 1900-01-01 is Trakt's "I don't remember when"
    // sentinel, not a real date — the FILTER clauses exclude it from both
    // aggregates so it can't drag firstWatchedAt back to a bogus 1900;
    // `hasUnknownWatchDate` separately says whether one exists at all, so
    // the frontend can show "Watched: unknown" when that's *all* there is.
    const [watchedRange] = await db
      .select({
        firstWatchedAt: sql<
          string | null
        >`min(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        lastWatchedAt: sql<
          string | null
        >`max(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        hasUnknownWatchDate: sql<boolean>`coalesce(bool_or(extract(year from ${plays.watchedAt}) = 1900), false)`,
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))

    // Header summary mirrors /library/shows' convention exactly (season 0
    // excluded from both halves, null total when no regular season is
    // cached yet) so it reads consistently with the gallery card the user
    // likely just clicked through from.
    const regularSeasons = seasonRows.filter((season) => season.seasonNumber > 0)
    const totalEpisodes =
      regularSeasons.length > 0
        ? regularSeasons.reduce((sum, season) => sum + season.episodeCount, 0)
        : null
    const watchedEpisodes = [...watchedMap.entries()]
      .filter(([seasonNumber]) => seasonNumber > 0)
      .reduce((sum, [, count]) => sum + count, 0)

    return c.json({
      id: show.id,
      slug: show.slug,
      title: show.title,
      year: show.year,
      overview: show.overview,
      posterPath: show.posterPath,
      status: show.status,
      genres: show.genres,
      watchedEpisodes,
      totalEpisodes,
      firstWatchedAt: watchedRange?.firstWatchedAt
        ? new Date(watchedRange.firstWatchedAt).toISOString()
        : null,
      lastWatchedAt: watchedRange?.lastWatchedAt
        ? new Date(watchedRange.lastWatchedAt).toISOString()
        : null,
      hasUnknownWatchDate: watchedRange?.hasUnknownWatchDate ?? false,
      seasons: seasonRows.map((season) => ({
        seasonNumber: season.seasonNumber,
        name: season.name,
        episodeCount: season.episodeCount,
        posterPath: season.posterPath,
        airDate: season.airDate,
        watchedEpisodes: watchedMap.get(season.seasonNumber) ?? 0,
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
