import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  droppedStatusSchema,
  listLibraryShowsResponseSchema,
  markShowWatchedRequestSchema,
  markShowWatchedResponseSchema,
  removeShowWatchesResponseSchema,
  removeWatchesRequestSchema,
  resolveMediaRequestSchema,
  resolveMediaResponseSchema,
  showDetailSchema,
  showWatchesSchema,
  watchlistMembershipStatusSchema,
  uuidSchema,
} from '@rwnd/shared'
import { droppedShows, episodes, plays, ratings, seasons, shows } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import { resolveShow, resolveShowEpisodes } from '../../lib/media.js'
import {
  backfillShowEpisodeRuntimes,
  pickRefreshTarget,
  refreshOneShow,
} from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'
import { isProviderSource } from '../../lib/provider-source.js'
import { getMyWatchlistIds, getOwnedWatchlist } from '../../lib/watchlists.js'
import {
  addToWatchlist,
  getExternalId,
  getShowBySlug,
  logMissingWatches,
  removeFromWatchlist,
  watchedRangeFragments,
} from './shared.js'

export const showRoutes = new OpenAPIHono<AppEnv>()

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
showRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows',
    summary: 'List every show the current user has watched, with watch progress',
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
        // The current user's own rating, distinct from voteAverage above —
        // see libraryShowSchema's `myRating` doc comment. Scoped to userId
        // in the join condition, not a WHERE clause, for the same reason as
        // the droppedShows join just below: an unrated show still needs a
        // row, not exclusion from the list. Safe against fan-out (this join
        // can't multiply rows) only because of ratings_user_entity_idx,
        // which guarantees at most one matching row per show per user.
        myRating: ratings.rating,
      })
      .from(watched)
      .innerJoin(shows, eq(shows.id, watched.showId))
      .leftJoin(totals, eq(totals.showId, watched.showId))
      .leftJoin(
        droppedShows,
        and(eq(droppedShows.showId, watched.showId), eq(droppedShows.userId, userId)),
      )
      .leftJoin(
        ratings,
        and(
          eq(ratings.entityId, watched.showId),
          eq(ratings.entityType, 'show'),
          eq(ratings.userId, userId),
        ),
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
        myRating: row.myRating,
        dropped: row.manualDropped ?? row.traktDropped ?? false,
        watchedEpisodes: row.watchedEpisodes,
        totalEpisodes: row.totalEpisodes ?? null,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)

/**
 * Backs the Dashboard search's show results (SearchResultCard.tsx) —
 * resolving a TMDB search hit to a local show is normally a side effect of
 * logging a watch (resolveShow, called from inside resolveEpisode etc.),
 * but a show result now links straight to its own page instead of logging
 * anything, so it needs a way to get (or create) that page's slug first.
 * Idempotent: resolveShow itself already no-ops into a lookup if the show
 * was resolved before, by anyone.
 */
showRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/resolve',
    summary: 'Resolve a show search result to its local page slug',
    request: { body: { content: { 'application/json': { schema: resolveMediaRequestSchema } } } },
    responses: {
      200: {
        description: 'Resolved',
        content: { 'application/json': { schema: resolveMediaResponseSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!

    const show = await resolveShow(db, provider, body.externalId, user.locale)
    return c.json({ slug: show.slug })
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
showRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}',
    summary: "Get a show, with the current user's watch progress",
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

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Every query below depends only on `show.id`/`userId`, not on each
    // other — run them concurrently rather than as 8 sequential round
    // trips on what's one of the app's highest-traffic pages.
    const [
      tmdbExternalId,
      tvdbExternalId,
      imdbExternalId,
      droppedRow,
      ratingRow,
      myWatchlistIds,
      seasonRows,
      watchedBySeason,
      watchedRange,
    ] = await Promise.all([
      // Backs the TMDB rating badge's link to the show's TMDB page (see
      // ShowDetailPage.tsx) — null for a show resolved before TMDB was
      // the only provider, or (in principle) a future non-TMDB provider
      // match.
      getExternalId(db, 'show', show.id, 'tmdb'),
      // Backs the TVDB link on the same page — see the tmdbExternalId
      // query above for the identical convention. Independent of
      // `tmdbExternalId`: a show can have either id, both, or neither on
      // record.
      getExternalId(db, 'show', show.id, 'tvdb'),
      // Backs the IMDb link on the same page — same independent-of-the-
      // others convention as tvdbExternalId above.
      getExternalId(db, 'show', show.id, 'imdb'),
      db
        .select({
          traktDropped: droppedShows.traktDropped,
          traktDroppedAt: droppedShows.traktDroppedAt,
          manualDropped: droppedShows.manualDropped,
          manualDroppedAt: droppedShows.manualDroppedAt,
        })
        .from(droppedShows)
        .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, show.id)))
        .limit(1)
        .then((rows) => rows[0]),
      // The current user's own rating — see libraryShowSchema's
      // `myRating` doc comment for what this means and how it differs
      // from `voteAverage`. Independent of watched status: this table
      // has no relation to `plays` at all.
      db
        .select({ rating: ratings.rating })
        .from(ratings)
        .where(
          and(
            eq(ratings.userId, userId),
            eq(ratings.entityType, 'show'),
            eq(ratings.entityId, show.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      getMyWatchlistIds(db, userId, 'show', show.id),
      db
        .select()
        .from(seasons)
        .where(eq(seasons.showId, show.id))
        .orderBy(asc(seasons.seasonNumber)),
      // Real per-season counts, specials included — unlike the
      // gallery-style totals below, nothing here excludes season 0.
      db
        .select({
          seasonNumber: episodes.seasonNumber,
          watchedEpisodes: sql<number>`count(distinct ${episodes.id})`
            .mapWith(Number)
            .as('watched_episodes'),
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))
        .groupBy(episodes.seasonNumber),
      // First/most recent watch, across every season (specials
      // included) — this is "when did I watch this show", not the
      // gallery-style totals below, so nothing here excludes season 0.
      // MIN/MAX over zero matching rows still returns one row (both
      // columns null), not zero rows.
      //
      // A play dated exactly 1900-01-01 is Trakt's "I don't remember
      // when" sentinel, not a real date — the FILTER clauses exclude it
      // from both aggregates so it can't drag firstWatchedAt back to a
      // bogus 1900; `hasUnknownWatchDate` separately says whether one
      // exists at all, so the frontend can show "Watched: unknown" when
      // that's *all* there is.
      db
        .select(watchedRangeFragments)
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))
        .then((rows) => rows[0]),
    ])

    // manualDropped (when set) always wins over traktDropped — see
    // droppedShows's doc comment in packages/db/src/schema.ts.
    const dropped = droppedRow?.manualDropped ?? droppedRow?.traktDropped ?? false
    const droppedAt =
      droppedRow?.manualDropped != null ? droppedRow.manualDroppedAt : droppedRow?.traktDroppedAt

    const watchedMap = new Map(
      watchedBySeason.map((row) => [row.seasonNumber, row.watchedEpisodes]),
    )

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
      tmdbId: tmdbExternalId ?? null,
      tvdbId: tvdbExternalId ?? null,
      imdbId: imdbExternalId ?? null,
      metadataSource:
        show.metadataSource && isProviderSource(show.metadataSource) ? show.metadataSource : null,
      metadataRefreshedAt: show.metadataRefreshedAt.toISOString(),
      myRating: ratingRow?.rating ?? null,
      myWatchlistIds,
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
 * Manual "refresh metadata" button (ShowDetailPage.tsx) — re-fetches this
 * one show from the provider right now, for the case TMDB itself has
 * something wrong (a bad poster, a stale status/episode count on a show
 * the automatic sweep won't re-check for months) rather than waiting on
 * apps/api/src/metadata/refresh.ts's own schedule. Reuses that module's
 * refreshOneShow — same fetch-and-upsert as the background sweep, not a
 * separate/lesser code path. No response body: the caller already has a
 * GET /library/shows/{slug} query to invalidate and refetch instead of
 * this route re-serializing the same show a second way.
 */
showRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/refresh',
    summary: "Refresh a show's cached metadata from the provider now",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      204: { description: 'Refreshed' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const ordered = await orderedProviders(db, c.get('metadataProviders'))
    const target = await pickRefreshTarget(db, 'show', show.id, ordered)
    // No configured provider has any id for this show — same 404 as "show
    // not found" itself, since there's nothing this route can refresh it
    // from either way.
    if (!target) return c.json({ error: 'Show not found' }, 404)

    await refreshOneShow(
      db,
      target.provider,
      { id: show.id, externalId: target.externalId },
      user.locale,
    )
    // Best-effort: a fallback-provider hiccup shouldn't fail a refresh
    // that already succeeded against the primary. See
    // backfillShowEpisodeRuntimes's own doc comment for why this runs
    // here rather than waiting for the next scheduled sweep.
    try {
      await backfillShowEpisodeRuntimes(db, show.id, ordered, user.locale)
    } catch (err) {
      console.error(`Episode runtime backfill failed for show ${show.id}:`, err)
    }

    return c.body(null, 204)
  },
)

/**
 * Every one of the current user's individual watches across a whole show
 * (every season, not just one) — ShowDetailPage.tsx's own History table,
 * the show-scoped counterpart of the season plays-list route above. Same
 * join-through-episodes shape, just without the seasonNumber filter;
 * `seasonNumber` comes along in the response since the table needs to name
 * which season each row belongs to, not just which episode.
 */
showRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/plays',
    summary: "List the current user's individual watches for a whole show",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: showWatchesSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const rows = await db
      .select({
        id: plays.id,
        watchedAt: plays.watchedAt,
        source: plays.source,
        seasonNumber: episodes.seasonNumber,
        episodeNumber: episodes.episodeNumber,
        episodeTitle: episodes.title,
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({
        id: row.id,
        watchedAt: row.watchedAt.toISOString(),
        source: row.source,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        episodeTitle: row.episodeTitle,
      })),
    })
  },
)

/**
 * Remove some of the current user's watches across a whole show
 * (ShowDetailPage.tsx's History table lets you tick watches spanning
 * several seasons at once) — same "ids scoped regardless of what the
 * caller sends" safety as the season-scoped DELETE route above, just
 * scoped to every episode of the show (specials included, same reasoning
 * as showWatchesSchema's own doc comment) instead of one season.
 */
showRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/plays',
    summary: "Remove some of the current user's watches for a whole show",
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: removeWatchesRequestSchema } } },
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
    const { slug } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.showId, show.id))
    const episodeIds = episodeRows.map((row) => row.id)

    let count = 0
    if (episodeIds.length > 0) {
      const removed = await db
        .delete(plays)
        .where(
          and(
            eq(plays.userId, userId),
            inArray(plays.episodeId, episodeIds),
            inArray(plays.id, ids),
          ),
        )
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
showRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/dropped',
    summary: 'Mark a show as dropped for the current user',
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

    const show = await getShowBySlug(db, slug)
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

showRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/dropped',
    summary: 'Un-drop a show for the current user',
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

    const show = await getShowBySlug(db, slug)
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
 * Add a show to one of the current user's watchlists — the one-click
 * Default-list toggle and the custom-lists dialog on ShowDetailPage.tsx
 * both call this, just with a different `watchlistId` (see
 * apps/web/src/lib/use-watchlist-actions.ts). PUT, not POST: re-sending the
 * same (show, watchlist) pair is a no-op, not a second entry — upserts via
 * `onConflictDoNothing` on watchlist_items_watchlist_entity_idx rather than
 * `onConflictDoUpdate` like the rating routes above, since there's no field
 * to update on a repeat add (`listedAt` deliberately keeps the original
 * add time, not the most recent one).
 */
showRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/library/shows/{slug}/watchlists/{watchlistId}',
    summary: "Add a show to one of the current user's watchlists",
    request: { params: z.object({ slug: z.string(), watchlistId: uuidSchema }) },
    responses: {
      200: {
        description: 'Added to the watchlist',
        content: { 'application/json': { schema: watchlistMembershipStatusSchema } },
      },
      404: { description: 'Show or watchlist not found' },
    },
  }),
  async (c) => {
    const { slug, watchlistId } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const list = await getOwnedWatchlist(db, userId, watchlistId)
    if (!list) return c.json({ error: 'Watchlist not found' }, 404)

    await addToWatchlist(db, userId, watchlistId, 'show', show.id)

    return c.json({ myWatchlistIds: await getMyWatchlistIds(db, userId, 'show', show.id) })
  },
)

/** Remove a show from one of the current user's watchlists — a no-op
 * (nothing to delete) if it wasn't on it, same convention as DELETE
 * .../rating above. */
showRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/watchlists/{watchlistId}',
    summary: "Remove a show from one of the current user's watchlists",
    request: { params: z.object({ slug: z.string(), watchlistId: uuidSchema }) },
    responses: {
      200: {
        description: 'Removed from the watchlist',
        content: { 'application/json': { schema: watchlistMembershipStatusSchema } },
      },
      404: { description: 'Show or watchlist not found' },
    },
  }),
  async (c) => {
    const { slug, watchlistId } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const list = await getOwnedWatchlist(db, userId, watchlistId)
    if (!list) return c.json({ error: 'Watchlist not found' }, 404)

    await removeFromWatchlist(db, watchlistId, 'show', show.id)

    return c.json({ myWatchlistIds: await getMyWatchlistIds(db, userId, 'show', show.id) })
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
showRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/watched',
    summary: 'Log a new watch for every non-special episode of a show',
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
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    // Same backstop as POST /plays — a client-picked "Other date" is
    // already clamped to "now" (WatchDateDialog.tsx), but nothing here
    // trusts that a client did its job.
    if (body.watchedAt && new Date(body.watchedAt).getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Same "any configured provider, not just the primary" reasoning as
    // the season detail route above — without an id from *some* provider
    // there's nothing to resolve episodes from.
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveShowEpisodes(
      db,
      target.provider,
      target.externalId,
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
showRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/watched',
    summary: "Remove every one of the current user's watches for a show (specials excluded)",
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

    const show = await getShowBySlug(db, slug)
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
