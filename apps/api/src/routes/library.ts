import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  droppedStatusSchema,
  episodeWatchedStatusSchema,
  episodeWatchesSchema,
  listLibraryMoviesResponseSchema,
  listLibraryShowsResponseSchema,
  markShowWatchedRequestSchema,
  markShowWatchedResponseSchema,
  removeEpisodeWatchesRequestSchema,
  removeShowWatchesResponseSchema,
  seasonDetailSchema,
  showDetailSchema,
} from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { droppedShows, episodes, externalIds, movies, plays, seasons, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveSeasonEpisodes, resolveShowEpisodes, type ResolvedEpisode } from '../lib/media.js'

/**
 * Shared by the show- and season-level "Watched" button routes below.
 * `resolvedEpisodes` is every episode in scope (already resolved to local
 * rows) — this excludes ones that haven't aired yet (unknown or future
 * `firstAired` — never guess a watch for an episode that isn't out) and,
 * unless `body.additional` is set, ones the user has already watched too
 * (the default "fill in what's missing" mode). `additional` skips that
 * second filter — every aired episode gets a new play regardless of
 * current watched state, which is what the "log an additional watch"
 * button (ShowDetailPage.tsx/SeasonDetailPage.tsx) needs for a rewatch.
 * Either way, the new plays land at the same `watchedAt`, or (when
 * `useReleaseDate` is set) each at its own episode's release date.
 * Returns how many plays were actually logged.
 */
async function logMissingWatches(
  db: Database,
  userId: string,
  resolvedEpisodes: ResolvedEpisode[],
  body: { watchedAt?: string; useReleaseDate?: true; additional?: true },
): Promise<number> {
  if (resolvedEpisodes.length === 0) return 0

  const episodeIds = resolvedEpisodes.map((e) => e.id)
  const alreadyWatched = body.additional
    ? new Set<string>()
    : new Set(
        (
          await db
            .select({ episodeId: plays.episodeId })
            .from(plays)
            .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        ).map((row) => row.episodeId),
      )

  const now = new Date()
  const targets = resolvedEpisodes.filter(
    (e): e is ResolvedEpisode & { firstAired: string } =>
      !alreadyWatched.has(e.id) && e.firstAired !== null && new Date(e.firstAired) <= now,
  )

  const values = targets.map((e) => ({
    userId,
    episodeId: e.id,
    watchedAt: body.useReleaseDate ? new Date(e.firstAired) : new Date(body.watchedAt!),
    source: 'manual' as const,
  }))

  if (values.length > 0) await db.insert(plays).values(values)
  return values.length
}

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
    // Null until every regular season has an aired-episode count cached —
    // see showDetailSchema's doc comment on `airedEpisodes` and the
    // metadata refresher (apps/api/src/metadata/refresh.ts), which is what
    // actually computes it. Only summed once complete, same as
    // totalEpisodes' own null-until-cached convention, so the button never
    // reads "fully watched" off a partial count.
    const airedEpisodes =
      regularSeasons.length > 0 && regularSeasons.every((s) => s.airedEpisodeCount !== null)
        ? regularSeasons.reduce((sum, season) => sum + (season.airedEpisodeCount ?? 0), 0)
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
      airedEpisodes,
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
 * Backs the season detail page (apps/web/src/routes/SeasonDetailPage.tsx),
 * linked to from a season card on the show page. Episode metadata (title,
 * overview, still image, runtime, air date) is fetched live from the
 * provider on every request rather than cached locally — unlike the show
 * itself, there's no local table of every episode a show has, only ones
 * the current user has actually logged a play against (see
 * apps/api/src/lib/media.ts's resolveEpisode), so there's nothing cached
 * to serve instead of asking the provider.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}',
    summary: 'Get one season of a show, with the current user’s per-episode watch status',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
    },
    responses: {
      200: {
        description: 'Season detail',
        content: { 'application/json': { schema: seasonDetailSchema } },
      },
      404: { description: 'Show or season not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')
    const provider = c.get('metadataProvider')

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Only reachable via a season card already rendered from show.seasons
    // (see ShowDetailPage.tsx), so a season not yet cached here shouldn't
    // normally happen — treated as 404 rather than falling through to a
    // provider call for a season number nobody linked to.
    const [seasonRow] = await db
      .select()
      .from(seasons)
      .where(and(eq(seasons.showId, show.id), eq(seasons.seasonNumber, seasonNumber)))
      .limit(1)
    if (!seasonRow) return c.json({ error: 'Season not found' }, 404)

    // Same join already used for the TMDB rating badge's link — see the
    // show-detail route above.
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
    if (!tmdbExternalId) return c.json({ error: 'Season not found' }, 404)

    const {
      overview: seasonOverview,
      voteAverage: seasonVoteAverage,
      episodes: providerEpisodes,
    } = await provider.getSeason(tmdbExternalId.externalId, seasonNumber, user.locale)

    // Scoped to the current user in the join condition (not a WHERE
    // clause) so an episode with no plays from this user still gets a row
    // — same reasoning as the droppedShows join in the gallery query
    // above.
    const watchRows = await db
      .select({
        episodeNumber: episodes.episodeNumber,
        watchedCount: sql<number>`count(${plays.id})`.mapWith(Number),
        lastWatchedAt: sql<string | null>`max(${plays.watchedAt})`,
      })
      .from(episodes)
      .leftJoin(plays, and(eq(plays.episodeId, episodes.id), eq(plays.userId, user.id)))
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
      .groupBy(episodes.episodeNumber)

    const watchedByEpisode = new Map(watchRows.map((row) => [row.episodeNumber, row]))

    return c.json({
      seasonNumber: seasonRow.seasonNumber,
      name: seasonRow.name,
      // Live from the provider, not cached locally — same reasoning as the
      // episode list itself (see this route's doc comment above).
      overview: seasonOverview,
      // Also live from the provider on every request, same reasoning as
      // `overview` — see showDetailSchema's `voteAverage` doc comment for
      // the zero-votes convention (season responses carry no vote_count to
      // disambiguate, so a genuine 0 and "unrated" are indistinguishable —
      // treated as unrated).
      voteAverage: seasonVoteAverage,
      posterPath: seasonRow.posterPath,
      airDate: seasonRow.airDate,
      episodes: providerEpisodes
        .slice()
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((episode) => {
          // Absent entirely (not just zero) when the episode has never been
          // logged locally at all — resolveEpisode only ever creates a row
          // on the first watch.
          const watch = watchedByEpisode.get(episode.episodeNumber)
          const watchedCount = watch?.watchedCount ?? 0
          return {
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            stillPath: episode.stillPath,
            runtimeMinutes: episode.runtimeMinutes,
            firstAired: episode.firstAired,
            watched: watchedCount > 0,
            watchedCount,
            lastWatchedAt: watch?.lastWatchedAt
              ? new Date(watch.lastWatchedAt).toISOString()
              : null,
          }
        }),
    })
  },
)

/**
 * Every one of the current user's individual watches for one episode,
 * newest first — backs the "are you sure?" confirmation shown before the
 * DELETE route below, which lets the user tick which of these to remove
 * (UnwatchConfirmDialog.tsx). Fetched on demand only when that
 * confirmation dialog opens, not part of the season list response above —
 * see episodeWatchesSchema's doc comment.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "List the current user's individual watches for one episode",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
    },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: episodeWatchesSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // No local episode row at all means it's never been logged — nothing
    // to list, same "harmless empty result" precedent as the DELETE route
    // below's no-op.
    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
          eq(episodes.episodeNumber, episodeNumber),
        ),
      )
      .limit(1)
    if (!episodeRow) return c.json({ watches: [] })

    // Tie-broken by id, not just watchedAt — two rewatches can share the
    // exact same timestamp (e.g. Trakt's 1900-01-01 "unknown date"
    // sentinel is common across several plays), and ORDER BY watchedAt
    // alone gives Postgres no guarantee of returning ties in the same
    // relative order on a later call. UnwatchConfirmDialog.tsx relies on
    // this list being stable across repeated fetches of the same data —
    // an unstable order looks like "the list changed" to it.
    const rows = await db
      .select({ id: plays.id, watchedAt: plays.watchedAt })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({ id: row.id, watchedAt: row.watchedAt.toISOString() })),
    })
  },
)

/**
 * Un-watch an episode (apps/web/src/routes/SeasonDetailPage.tsx) — clears
 * the current user's logged plays named in the request body, not
 * necessarily every one of them (UnwatchConfirmDialog.tsx lets the user
 * tick individual watches; "remove all" is just every id ticked, not a
 * separate mode). `ids` is scoped to this episode/user in the WHERE clause
 * below regardless of what the caller sends — a stray id for a different
 * episode or another user's play can't be deleted through this route.
 * Individual watch events for a rewatched episode otherwise stay
 * manageable on the History page instead of here.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "Remove some or all of the current user's watches for one episode",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
      body: { content: { 'application/json': { schema: removeEpisodeWatchesRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Episode watch status',
        content: { 'application/json': { schema: episodeWatchedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // A no-op if this episode was never logged locally at all — nothing to
    // clear, same "harmless no-op" precedent as undropping a never-dropped
    // show above.
    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
          eq(episodes.episodeNumber, episodeNumber),
        ),
      )
      .limit(1)

    if (episodeRow) {
      await db
        .delete(plays)
        .where(
          and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id), inArray(plays.id, ids)),
        )
    }

    const remaining = episodeRow
      ? await db
          .select({ watchedAt: plays.watchedAt })
          .from(plays)
          .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id)))
          .orderBy(desc(plays.watchedAt), asc(plays.id))
      : []

    return c.json({
      watched: remaining.length > 0,
      watchedCount: remaining.length,
      lastWatchedAt: remaining[0] ? remaining[0].watchedAt.toISOString() : null,
    })
  },
)

/**
 * The season page's "Watched" button (apps/web/src/routes/SeasonDetailPage.tsx)
 * — the season-scoped equivalent of the show page's own "Watched" button
 * above. Logs one new play for every episode of this one season (specials
 * included, unlike the show-level route — a season *is* the unit here, so
 * there's no "exclude specials" question) that isn't already watched — see
 * logMissingWatches's doc comment for the watchedAt/useReleaseDate choice.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: 'Log a new watch for every episode of one season',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
      body: { content: { 'application/json': { schema: markShowWatchedRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Watches logged',
        content: { 'application/json': { schema: markShowWatchedResponseSchema } },
      },
      400: { description: 'watchedAt is in the future' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const body = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const provider = c.get('metadataProvider')

    // Same backstop as POST /plays — a client-picked "Other date" is
    // already clamped to "now" (WatchDateDialog.tsx), but nothing here
    // trusts that a client did its job.
    if (body.watchedAt && new Date(body.watchedAt).getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

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
    if (!tmdbExternalId) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveSeasonEpisodes(
      db,
      provider,
      tmdbExternalId.externalId,
      seasonNumber,
      user.locale,
    )

    const count = await logMissingWatches(db, user.id, resolvedEpisodes, body)
    return c.json({ count }, 201)
  },
)

/**
 * Clicking the season page's "Watched" button again once it's already
 * showing every episode of the season watched opens a "remove all
 * watches?" confirmation instead — the season-scoped equivalent of the
 * show page's own remove-all-watches route above. Only ever touches
 * locally-known episode rows, same reasoning as that route.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: "Remove every one of the current user's watches for one season",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
    },
    responses: {
      200: {
        description: 'Watches removed',
        content: { 'application/json': { schema: removeShowWatchesResponseSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
    const episodeIds = episodeRows.map((row) => row.id)

    let count = 0
    if (episodeIds.length > 0) {
      const removed = await db
        .delete(plays)
        .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        .returning({ id: plays.id })
      count = removed.length
    }

    return c.json({ count })
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

/**
 * The show page's "Watched" button (apps/web/src/routes/ShowDetailPage.tsx)
 * — the show-level equivalent of marking one episode watched from the
 * season grid. Logs one new play for every non-special episode that isn't
 * already watched — see logMissingWatches's doc comment for the
 * watchedAt/useReleaseDate choice. Episodes not yet resolved locally are
 * created from the provider first — see resolveShowEpisodes's doc comment
 * (apps/api/src/lib/media.ts) for why that's one call per season rather
 * than per episode.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/watched',
    summary: 'Log a new watch for every non-special episode of a show',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: markShowWatchedRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Watches logged',
        content: { 'application/json': { schema: markShowWatchedResponseSchema } },
      },
      400: { description: 'watchedAt is in the future' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const body = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const provider = c.get('metadataProvider')

    // Same backstop as POST /plays — a client-picked "Other date" is
    // already clamped to "now" (WatchDateDialog.tsx), but nothing here
    // trusts that a client did its job.
    if (body.watchedAt && new Date(body.watchedAt).getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Same reasoning as the season detail route above: without a tmdb id
    // there's no provider to resolve episodes from.
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
    if (!tmdbExternalId) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveShowEpisodes(
      db,
      provider,
      tmdbExternalId.externalId,
      user.locale,
    )

    const count = await logMissingWatches(db, user.id, resolvedEpisodes, body)
    return c.json({ count }, 201)
  },
)

/**
 * Clicking the "Watched" button again once it's already showing every
 * non-special episode watched (see ShowDetailPage.tsx) opens a "remove all
 * watches?" confirmation instead of the watch-date dialog — this is what it
 * calls. Removes every play the current user has logged against a
 * non-special episode of the show. Only ever touches locally-known episode
 * rows (a play can't reference an episode that doesn't have one), so unlike
 * the POST route above there's nothing to resolve from the provider.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/watched',
    summary: "Remove every one of the current user's watches for a show (specials excluded)",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Watches removed',
        content: { 'application/json': { schema: removeShowWatchesResponseSchema } },
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

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), gt(episodes.seasonNumber, 0)))
    const episodeIds = episodeRows.map((row) => row.id)

    let count = 0
    if (episodeIds.length > 0) {
      const removed = await db
        .delete(plays)
        .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        .returning({ id: plays.id })
      count = removed.length
    }

    return c.json({ count })
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
