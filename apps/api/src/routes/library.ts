import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import {
  droppedStatusSchema,
  listLibraryMoviesResponseSchema,
  listLibraryShowsResponseSchema,
  showDetailSchema,
} from '@rwnd/shared'
import { droppedShows, episodes, externalIds, movies, plays, seasons, shows } from '@rwnd/db'
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
        status: shows.status,
        genres: shows.genres,
        voteAverage: shows.voteAverage,
        // Null when this user has no droppedShows row at all for this show
        // (never dropped) — joined (not a subquery) and scoped to userId in
        // the join condition itself, not a WHERE clause, so a show this
        // user hasn't dropped still gets a row instead of being excluded.
        // manualDropped (when set) always wins over traktDropped — see
        // droppedShows's doc comment in packages/db/src/schema.ts.
        traktDropped: droppedShows.traktDropped,
        manualDropped: droppedShows.manualDropped,
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
      .leftJoin(
        droppedShows,
        and(eq(droppedShows.showId, watched.showId), eq(droppedShows.userId, userId)),
      )
      .orderBy(asc(shows.title))

    return c.json({
      shows: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        status: row.status,
        genres: row.genres,
        voteAverage: row.voteAverage,
        dropped: row.manualDropped ?? row.traktDropped ?? false,
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

    // Backs the TMDB rating badge's link to the show's TMDB page (see
    // ShowDetailPage.tsx) — null for a show resolved before TMDB was the
    // only provider, or (in principle) a future non-TMDB provider match.
    const [tmdbExternalId] = await db
      .select({ externalId: externalIds.externalId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, 'show'),
          eq(externalIds.entityId, show.id),
          eq(externalIds.source, 'tmdb'),
        ),
      )
      .limit(1)

    const [droppedRow] = await db
      .select({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })
      .from(droppedShows)
      .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, show.id)))
      .limit(1)
    // manualDropped (when set) always wins over traktDropped — see
    // droppedShows's doc comment in packages/db/src/schema.ts.
    const dropped = droppedRow?.manualDropped ?? droppedRow?.traktDropped ?? false
    const droppedAt =
      droppedRow?.manualDropped != null ? droppedRow.manualDroppedAt : droppedRow?.traktDroppedAt

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
      voteAverage: show.voteAverage,
      tmdbId: tmdbExternalId?.externalId ?? null,
      dropped,
      droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null,
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

/**
 * Manual drop/undrop toggle (apps/web/src/routes/ShowDetailPage.tsx) — the
 * in-app counterpart to importing Trakt's own "Dropped" list
 * (apps/api/src/import/trakt.ts). Returns just `droppedStatusSchema`
 * (dropped + droppedAt), not the full show detail: the frontend patches
 * those two fields into its already-cached ShowDetail rather than
 * refetching, so this route doesn't need to rebuild seasons/watched counts
 * just to toggle a boolean.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/dropped',
    summary: 'Mark a show as dropped for the current user',
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show marked as dropped',
        content: { 'application/json': { schema: droppedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // manualDropped is only an *override* — if Trakt's own state for this
    // show is already "dropped", there's nothing to override, so it's left
    // (or cleared back to) null rather than pinned to true forever. See
    // droppedShows's doc comment in packages/db/src/schema.ts.
    const manualDroppedAt = new Date()
    const [row] = await db
      .insert(droppedShows)
      .values({
        userId,
        showId: show.id,
        traktDropped: null,
        traktDroppedAt: null,
        manualDropped: true,
        manualDroppedAt,
      })
      .onConflictDoUpdate({
        target: [droppedShows.userId, droppedShows.showId],
        set: {
          manualDropped: sql`case when ${droppedShows.traktDropped} = true then null else true end`,
          manualDroppedAt: sql`case when ${droppedShows.traktDropped} = true then null else ${manualDroppedAt.toISOString()}::timestamptz end`,
        },
      })
      .returning({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })

    const dropped = row!.manualDropped ?? row!.traktDropped ?? false
    const droppedAt = row!.manualDropped != null ? row!.manualDroppedAt : row!.traktDroppedAt
    return c.json({ dropped, droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null })
  },
)

libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/dropped',
    summary: 'Un-drop a show for the current user',
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show no longer marked as dropped',
        content: { 'application/json': { schema: droppedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // A no-op (0 rows affected) if the show was never dropped in the first
    // place — nothing to undo, no row worth creating. Otherwise, same
    // override-vs-clear logic as the drop route above: manualDropped only
    // needs to record `false` while Trakt still disagrees (still thinks
    // this show is dropped); once Trakt agrees it isn't, the override
    // clears back to null rather than staying pinned to false forever.
    const manualDroppedAt = new Date()
    const [row] = await db
      .update(droppedShows)
      .set({
        manualDropped: sql`case when ${droppedShows.traktDropped} = true then false else null end`,
        manualDroppedAt: sql`case when ${droppedShows.traktDropped} = true then ${manualDroppedAt.toISOString()}::timestamptz else null end`,
      })
      .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, show.id)))
      .returning({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })

    if (!row) return c.json({ dropped: false, droppedAt: null })

    const dropped = row.manualDropped ?? row.traktDropped ?? false
    const droppedAt = row.manualDropped != null ? row.manualDroppedAt : row.traktDroppedAt
    return c.json({ dropped, droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null })
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
