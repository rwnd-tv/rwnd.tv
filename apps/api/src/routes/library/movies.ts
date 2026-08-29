import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  listLibraryMoviesResponseSchema,
  movieDetailSchema,
  removeWatchesRequestSchema,
  resolveMediaRequestSchema,
  resolveMediaResponseSchema,
  watchedStatusSchema,
  watchesSchema,
  watchlistMembershipStatusSchema,
  uuidSchema,
} from '@rwnd/shared'
import { movies, plays, ratings } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import { resolveMovie } from '../../lib/media.js'
import { pickRefreshTarget, refreshOneMovie } from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'
import { isProviderSource } from '../../lib/provider-source.js'
import { getMyWatchlistIds, getOwnedWatchlist } from '../../lib/watchlists.js'
import {
  addToWatchlist,
  getExternalId,
  getMovieBySlug,
  removeFromWatchlist,
  watchedRangeFragments,
} from './shared.js'

export const movieRoutes = new OpenAPIHono<AppEnv>()

/**
 * Movie counterpart of POST /library/shows/resolve above — same reasoning:
 * backs the Dashboard search's movie results, which now link straight to
 * their own page (SearchResultCard.tsx) instead of logging a watch inline.
 * Idempotent, same as resolveShow.
 */
movieRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/movies/resolve',
    summary: 'Resolve a movie search result to its local page slug',
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

    const movie = await resolveMovie(db, provider, body.externalId, user.locale)
    return c.json({ slug: movie.slug })
  },
)

/** Backs the Movies gallery (apps/web/src/routes/MoviesPage.tsx). Only one
 * aggregate is needed — there's no second table to fan out against — so
 * this doesn't need the CTE split the shows query does. */
movieRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies',
    summary: 'List every movie the current user has watched, with play count',
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
        slug: movies.slug,
        title: movies.title,
        year: movies.year,
        posterPath: movies.posterPath,
        genres: movies.genres,
        voteAverage: movies.voteAverage,
        // See the shows gallery query's identical join above for the
        // fan-out reasoning (safe only because of ratings_user_entity_idx —
        // must stay in the GROUP BY below since it's a plain column
        // alongside the aggregates, not itself aggregated).
        myRating: ratings.rating,
        playCount: sql<number>`count(${plays.id})`.mapWith(Number).as('play_count'),
        lastWatchedAt: sql`max(${plays.watchedAt})`
          .mapWith((v: string) => new Date(v))
          .as('last_watched_at'),
      })
      .from(plays)
      .innerJoin(movies, eq(plays.movieId, movies.id))
      .leftJoin(
        ratings,
        and(
          eq(ratings.entityId, movies.id),
          eq(ratings.entityType, 'movie'),
          eq(ratings.userId, userId),
        ),
      )
      .where(eq(plays.userId, userId))
      .groupBy(movies.id, ratings.rating)
      .orderBy(asc(movies.title))

    return c.json({
      movies: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        genres: row.genres,
        voteAverage: row.voteAverage,
        myRating: row.myRating,
        playCount: row.playCount,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)

/**
 * Backs the per-movie page (apps/web/src/routes/MovieDetailPage.tsx),
 * linked to from the movies gallery, Dashboard search, and History. Same
 * "not scoped to this user's watches" reasoning as GET /library/shows/
 * {slug} above — the movie itself is shared metadata, any authenticated
 * user can look up any movie that exists locally, only the watch fields
 * below are scoped to the current user.
 */
movieRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies/{slug}',
    summary: "Get a movie, with the current user's watch status",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Movie detail',
        content: { 'application/json': { schema: movieDetailSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    // Every query below depends only on `movie.id`/`userId`, not on each
    // other — run them concurrently rather than as 6 sequential round
    // trips on what's one of the app's highest-traffic pages.
    const [tmdbExternalId, tvdbExternalId, watchedRange, ratingRow, myWatchlistIds] =
      await Promise.all([
        // Backs the TMDB rating badge's link to the movie's TMDB page —
        // same convention as the show route's tmdbExternalId lookup above.
        getExternalId(db, 'movie', movie.id, 'tmdb'),
        // Backs the TVDB link — same convention as the show route's own
        // tvdbExternalId query.
        getExternalId(db, 'movie', movie.id, 'tvdb'),
        // Same 1900-01-01 Trakt-sentinel exclusion as the show route's
        // watchedRange query above — see that query's doc comment.
        db
          .select({ watchedCount: sql<number>`count(*)`.mapWith(Number), ...watchedRangeFragments })
          .from(plays)
          .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))
          .then((rows) => rows[0]),
        // See the show detail route's identical lookup above.
        db
          .select({ rating: ratings.rating })
          .from(ratings)
          .where(
            and(
              eq(ratings.userId, userId),
              eq(ratings.entityType, 'movie'),
              eq(ratings.entityId, movie.id),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),
        getMyWatchlistIds(db, userId, 'movie', movie.id),
      ])

    return c.json({
      id: movie.id,
      slug: movie.slug,
      title: movie.title,
      year: movie.year,
      runtimeMinutes: movie.runtimeMinutes,
      overview: movie.overview,
      posterPath: movie.posterPath,
      genres: movie.genres,
      voteAverage: movie.voteAverage,
      tmdbId: tmdbExternalId ?? null,
      tvdbId: tvdbExternalId ?? null,
      metadataSource:
        movie.metadataSource && isProviderSource(movie.metadataSource)
          ? movie.metadataSource
          : null,
      metadataRefreshedAt: movie.metadataRefreshedAt.toISOString(),
      myRating: ratingRow?.rating ?? null,
      myWatchlistIds,
      watched: (watchedRange?.watchedCount ?? 0) > 0,
      watchedCount: watchedRange?.watchedCount ?? 0,
      firstWatchedAt: watchedRange?.firstWatchedAt
        ? new Date(watchedRange.firstWatchedAt).toISOString()
        : null,
      lastWatchedAt: watchedRange?.lastWatchedAt
        ? new Date(watchedRange.lastWatchedAt).toISOString()
        : null,
      hasUnknownWatchDate: watchedRange?.hasUnknownWatchDate ?? false,
    })
  },
)

/**
 * Manual "refresh metadata" button (MovieDetailPage.tsx) — movie
 * counterpart of POST /library/shows/{slug}/refresh above. Same reasoning
 * and same "no response body, refetch the detail route instead" shape.
 */
movieRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/movies/{slug}/refresh',
    summary: "Refresh a movie's cached metadata from the provider now",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      204: { description: 'Refreshed' },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    const ordered = await orderedProviders(db, c.get('metadataProviders'))
    const target = await pickRefreshTarget(db, 'movie', movie.id, ordered)
    // Same reasoning as the show refresh route above.
    if (!target) return c.json({ error: 'Movie not found' }, 404)

    await refreshOneMovie(
      db,
      target.provider,
      { id: movie.id, externalId: target.externalId },
      user.locale,
    )
    return c.body(null, 204)
  },
)

/**
 * Every one of the current user's individual watches for one movie, newest
 * first — movie counterpart of the episode plays-list route above. Same
 * "fetched on demand only when the unwatch confirmation dialog opens"
 * reasoning — see watchesSchema's doc comment.
 */
movieRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies/{slug}/plays',
    summary: "List the current user's individual watches for one movie",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: watchesSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    // Same tie-break-by-id reasoning as the episode plays-list route above
    // — UnwatchConfirmDialog.tsx relies on this list being stable across
    // repeated fetches of the same data.
    const rows = await db
      .select({ id: plays.id, watchedAt: plays.watchedAt, source: plays.source })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))
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
 * Un-watch a movie (MovieDetailPage.tsx) — movie counterpart of the episode
 * plays DELETE route above. Same "scoped to this movie/user regardless of
 * what the caller sends" safety and same UnwatchConfirmDialog.tsx ticking
 * behaviour.
 */
movieRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/movies/{slug}/plays',
    summary: "Remove some or all of the current user's watches for one movie",
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: removeWatchesRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Movie watch status',
        content: { 'application/json': { schema: watchedStatusSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    await db
      .delete(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id), inArray(plays.id, ids)))

    const remaining = await db
      .select({ watchedAt: plays.watchedAt })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watched: remaining.length > 0,
      watchedCount: remaining.length,
      lastWatchedAt: remaining[0] ? remaining[0].watchedAt.toISOString() : null,
    })
  },
)

/** Add a movie to one of the current user's watchlists — movie counterpart
 * of PUT /library/shows/{slug}/watchlists/{watchlistId} above. Same
 * reasoning throughout. */
movieRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/library/movies/{slug}/watchlists/{watchlistId}',
    summary: "Add a movie to one of the current user's watchlists",
    request: { params: z.object({ slug: z.string(), watchlistId: uuidSchema }) },
    responses: {
      200: {
        description: 'Added to the watchlist',
        content: { 'application/json': { schema: watchlistMembershipStatusSchema } },
      },
      404: { description: 'Movie or watchlist not found' },
    },
  }),
  async (c) => {
    const { slug, watchlistId } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    const list = await getOwnedWatchlist(db, userId, watchlistId)
    if (!list) return c.json({ error: 'Watchlist not found' }, 404)

    await addToWatchlist(db, userId, watchlistId, 'movie', movie.id)

    return c.json({ myWatchlistIds: await getMyWatchlistIds(db, userId, 'movie', movie.id) })
  },
)

/** Remove a movie from one of the current user's watchlists — movie
 * counterpart of DELETE /library/shows/{slug}/watchlists/{watchlistId}
 * above. Same reasoning throughout. */
movieRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/movies/{slug}/watchlists/{watchlistId}',
    summary: "Remove a movie from one of the current user's watchlists",
    request: { params: z.object({ slug: z.string(), watchlistId: uuidSchema }) },
    responses: {
      200: {
        description: 'Removed from the watchlist',
        content: { 'application/json': { schema: watchlistMembershipStatusSchema } },
      },
      404: { description: 'Movie or watchlist not found' },
    },
  }),
  async (c) => {
    const { slug, watchlistId } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const movie = await getMovieBySlug(db, slug)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    const list = await getOwnedWatchlist(db, userId, watchlistId)
    if (!list) return c.json({ error: 'Watchlist not found' }, 404)

    await removeFromWatchlist(db, watchlistId, 'movie', movie.id)

    return c.json({ myWatchlistIds: await getMyWatchlistIds(db, userId, 'movie', movie.id) })
  },
)
