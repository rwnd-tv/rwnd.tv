import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  episodeImdbSchema,
  markShowWatchedRequestSchema,
  markShowWatchedResponseSchema,
  removeShowWatchesResponseSchema,
  removeWatchesRequestSchema,
  seasonDetailSchema,
  seasonWatchesSchema,
  watchedStatusSchema,
  watchesSchema,
} from '@rwnd/shared'
import { episodes, plays, ratings, seasons } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import { resolveSeasonEpisodes } from '../../lib/media.js'
import { resolveEpisodeImdbId } from '../../lib/episode-imdb.js'
import { pickRefreshTarget } from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'
import {
  getEpisodeIdByNumbers,
  getExternalId,
  getShowBySlug,
  logMissingWatches,
  watchedRangeFragments,
} from './shared.js'

export const seasonRoutes = new OpenAPIHono<AppEnv>()

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
seasonRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}',
    summary: 'Get one season of a show, with the current user’s per-episode watch status',
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
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const show = await getShowBySlug(db, slug)
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

    // Whichever configured provider actually has a recorded id for this
    // show — not necessarily the primary/first-priority one (found live:
    // a show resolved entirely via TVDB, with no `tmdb` external_ids row
    // at all, 404'd here when this was still hardcoded to the primary
    // provider — apps/api/src/import/match.ts's cross-provider fallback
    // means that's now a real, not just theoretical, case).
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Season not found' }, 404)

    // TVDB's own season/episode ids for the "view on TVDB" links —
    // deliberately independent of `target` above, which is whichever
    // provider actually has this show's season/episode *content* (TMDB,
    // usually) — this is specifically about the TVDB deep link, wanted
    // even when TVDB isn't the provider serving the page's own data. A
    // live, best-effort side lookup: only attempted when TVDB is
    // configured and this show has a recorded `tvdb` external id, and
    // never lets a failed/slow TVDB call break the rest of the page — the
    // link is just absent. When `target.provider` already *is* TVDB, this
    // ends up asking it the same question twice — a minor redundancy, not
    // worth special-casing away.
    const tvdbProvider = providers.find((p) => p.source === 'tvdb')
    let tvdbSeasonId: string | null = null
    const tvdbEpisodeIdByNumber = new Map<number, string>()
    if (tvdbProvider) {
      const tvdbExternalId = await getExternalId(db, 'show', show.id, 'tvdb')
      if (tvdbExternalId) {
        try {
          const tvdbSeason = await tvdbProvider.getSeason(tvdbExternalId, seasonNumber, user.locale)
          tvdbSeasonId = tvdbSeason.externalId
          for (const episode of tvdbSeason.episodes) {
            if (episode.externalId)
              tvdbEpisodeIdByNumber.set(episode.episodeNumber, episode.externalId)
          }
        } catch {
          // Network hiccup or no matching season on TVDB's side — leave
          // both maps empty rather than failing the whole page over a
          // supplementary link.
        }
      }
    }

    const {
      overview: seasonOverview,
      voteAverage: seasonVoteAverage,
      episodes: providerEpisodes,
    } = await target.provider.getSeason(target.externalId, seasonNumber, user.locale)

    // Scoped to the current user in the join condition (not a WHERE
    // clause) so an episode with no plays from this user still gets a row
    // — same reasoning as the droppedShows join in the gallery query
    // above.
    const watchRows = await db
      .select({
        episodeNumber: episodes.episodeNumber,
        watchedCount: sql<number>`count(${plays.id})`.mapWith(Number),
        lastWatchedAt: sql<string | null>`max(${plays.watchedAt})`,
        // Same fragment shows.ts's/movies.ts's watchedRange query uses.
        hasUnknownWatch: watchedRangeFragments.hasUnknownWatchDate,
      })
      .from(episodes)
      .leftJoin(plays, and(eq(plays.episodeId, episodes.id), eq(plays.userId, user.id)))
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
      .groupBy(episodes.episodeNumber)

    const watchedByEpisode = new Map(watchRows.map((row) => [row.episodeNumber, row]))

    // The current user's own rating for each episode of this season — see
    // libraryShowSchema's `myRating` doc comment. A separate query rather
    // than folding into watchRows above: that one's a GROUP BY aggregate
    // (count/max), and a joined non-aggregate column there would mean
    // either widening the GROUP BY or wrapping it in max(), which muddies
    // a query the "does not double-count" regression already covers.
    // Selecting from episodes (not providerEpisodes) is deliberate too — an
    // episode with no local row can't have a rating, same reasoning as
    // watchRows only ever covering resolved episodes.
    const ratingRows = await db
      .select({ episodeNumber: episodes.episodeNumber, rating: ratings.rating })
      .from(episodes)
      .innerJoin(
        ratings,
        and(
          eq(ratings.entityId, episodes.id),
          eq(ratings.entityType, 'episode'),
          eq(ratings.userId, user.id),
        ),
      )
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
    const ratingByEpisode = new Map(ratingRows.map((row) => [row.episodeNumber, row.rating]))

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
            hasUnknownWatch: watch?.hasUnknownWatch ?? false,
            voteAverage: episode.voteAverage,
            myRating: ratingByEpisode.get(episode.episodeNumber) ?? null,
            tvdbEpisodeId: tvdbEpisodeIdByNumber.get(episode.episodeNumber) ?? null,
          }
        }),
      tvdbSeasonId,
    })
  },
)

/**
 * One episode's IMDb id, for the episode detail page's "View on IMDb"
 * link — deliberately its own route rather than a field on the season
 * detail route above. TMDB's season endpoint carries no per-episode
 * external ids (see TmdbProvider.getSeason's own comment), so getting an
 * episode's IMDb id costs one dedicated provider call; folding that into
 * the season response would mean up to ~25 provider calls on a single
 * season page view. Fetched by EpisodeDetailPage.tsx as its own,
 * non-blocking query instead. Always 200 once the show/season/episode
 * exist — a provider failure or missing id is `{ imdbId: null }`, not a
 * 5xx, same "supplementary link, never break the page" convention as the
 * season route's own TVDB lookup above.
 */
seasonRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/imdb',
    summary: 'Get one episode’s IMDb id, fetching and caching it if not already known',
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
    },
    responses: {
      200: {
        description: 'IMDb id, or null if none is known',
        content: { 'application/json': { schema: episodeImdbSchema } },
      },
      404: { description: 'Show, season or episode not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const [seasonRow] = await db
      .select({ episodeCount: seasons.episodeCount })
      .from(seasons)
      .where(and(eq(seasons.showId, show.id), eq(seasons.seasonNumber, seasonNumber)))
      .limit(1)
    if (!seasonRow) return c.json({ error: 'Season not found' }, 404)

    // Cheap, purely local guard against an out-of-range episode number —
    // without it, every bogus number is a live provider 404 on every
    // request, forever (no local row means no negative cache to stop it).
    if (episodeNumber > seasonRow.episodeCount) {
      return c.json({ error: 'Episode not found' }, 404)
    }

    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ imdbId: null })

    const [episodeRow] = await db
      .select({ id: episodes.id, imdbCheckedAt: episodes.imdbCheckedAt })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
          eq(episodes.episodeNumber, episodeNumber),
        ),
      )
      .limit(1)

    const imdbId = await resolveEpisodeImdbId(
      db,
      target.provider,
      target.externalId,
      {
        id: episodeRow?.id ?? null,
        seasonNumber,
        episodeNumber,
        imdbCheckedAt: episodeRow?.imdbCheckedAt ?? null,
      },
      user.locale,
    )
    return c.json({ imdbId })
  },
)

/**
 * Every one of the current user's individual watches for one episode,
 * newest first — backs the "are you sure?" confirmation shown before the
 * DELETE route below, which lets the user tick which of these to remove
 * (UnwatchConfirmDialog.tsx). Fetched on demand only when that
 * confirmation dialog opens, not part of the season list response above —
 * see watchesSchema's doc comment.
 */
seasonRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "List the current user's individual watches for one episode",
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
        content: { 'application/json': { schema: watchesSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // No local episode row at all means it's never been logged — nothing
    // to list, same "harmless empty result" precedent as the DELETE route
    // below's no-op.
    const episodeId = await getEpisodeIdByNumbers(db, show.id, seasonNumber, episodeNumber)
    if (!episodeId) return c.json({ watches: [] })

    // Tie-broken by id, not just watchedAt — two rewatches can share the
    // exact same timestamp (e.g. Trakt's 1900-01-01 "unknown date"
    // sentinel is common across several plays), and ORDER BY watchedAt
    // alone gives Postgres no guarantee of returning ties in the same
    // relative order on a later call. UnwatchConfirmDialog.tsx relies on
    // this list being stable across repeated fetches of the same data —
    // an unstable order looks like "the list changed" to it.
    const rows = await db
      .select({ id: plays.id, watchedAt: plays.watchedAt, source: plays.source })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeId)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({
        id: row.id,
        watchedAt: row.watchedAt.toISOString(),
        source: row.source,
      })),
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
seasonRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "Remove some or all of the current user's watches for one episode",
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
      body: { content: { 'application/json': { schema: removeWatchesRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Episode watch status',
        content: { 'application/json': { schema: watchedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // A no-op if this episode was never logged locally at all — nothing to
    // clear, same "harmless no-op" precedent as undropping a never-dropped
    // show above.
    const episodeId = await getEpisodeIdByNumbers(db, show.id, seasonNumber, episodeNumber)

    if (episodeId) {
      await db
        .delete(plays)
        .where(
          and(eq(plays.userId, userId), eq(plays.episodeId, episodeId), inArray(plays.id, ids)),
        )
    }

    const remaining = episodeId
      ? await db
          .select({ watchedAt: plays.watchedAt })
          .from(plays)
          .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeId)))
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
 * Every one of the current user's individual watches across a whole season
 * (SeasonDetailPage.tsx's own History table) — the season-scoped
 * counterpart of the per-episode plays-list route above. Joins through
 * `episodes` (rather than filtering by a single episode id) so one query
 * covers every episode of the season at once; `episodeTitle` comes along
 * for the ride since the History table needs to name which episode each
 * row belongs to.
 */
seasonRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/plays',
    summary: "List the current user's individual watches for one season",
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
    },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: seasonWatchesSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const rows = await db
      .select({
        id: plays.id,
        watchedAt: plays.watchedAt,
        source: plays.source,
        episodeNumber: episodes.episodeNumber,
        episodeTitle: episodes.title,
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(
        and(
          eq(plays.userId, userId),
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
        ),
      )
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({
        id: row.id,
        watchedAt: row.watchedAt.toISOString(),
        source: row.source,
        episodeNumber: row.episodeNumber,
        episodeTitle: row.episodeTitle,
      })),
    })
  },
)

/**
 * Remove some of the current user's watches across a whole season
 * (SeasonDetailPage.tsx's History table lets you tick watches spanning
 * several episodes at once, unlike the per-episode UnwatchConfirmDialog
 * flow) — same "ids scoped regardless of what the caller sends" safety as
 * the per-episode DELETE route above, just scoped to every episode of the
 * season instead of one.
 */
seasonRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/plays',
    summary: "Remove some of the current user's watches for one season",
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
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
    const { slug, seasonNumber } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const show = await getShowBySlug(db, slug)
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
 * The season page's "Watched" button (apps/web/src/routes/SeasonDetailPage.tsx)
 * — the season-scoped equivalent of the show page's own "Watched" button
 * above. Logs one new play for every episode of this one season (specials
 * included, unlike the show-level route — a season *is* the unit here, so
 * there's no "exclude specials" question) that isn't already watched — see
 * logMissingWatches's doc comment for the watchedAt/useReleaseDate choice.
 */
seasonRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: 'Log a new watch for every episode of one season',
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
    // the season detail route above.
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveSeasonEpisodes(
      db,
      target.provider,
      target.externalId,
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
seasonRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: "Remove every one of the current user's watches for one season",
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

    const show = await getShowBySlug(db, slug)
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
