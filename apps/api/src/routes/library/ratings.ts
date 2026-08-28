import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { ratingStatusSchema, setRatingRequestSchema } from '@rwnd/shared'
import { episodes, movies, ratings, shows } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import { requireAuth } from '../../middleware/auth.js'
import { resolveEpisode } from '../../lib/media.js'
import { pickRefreshTarget } from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'

export const ratingRoutes = new OpenAPIHono<AppEnv>()

/**
 * Set (or replace) the current user's rating for one episode — see the
 * show-level PUT .../rating route above for the general reasoning (PUT
 * over POST, upsert semantics, independence from `plays`).
 *
 * Unlike the show/movie routes, this one has to resolve the episode first:
 * an episode has no local row until it's been watched or (now) rated —
 * resolveEpisode creates one on demand from whichever configured provider
 * actually has an external id on record for this show (pickRefreshTarget,
 * not the request-scoped primary provider — see the season detail route's
 * identical reasoning above), the same way the season/show "Watched"
 * routes do. A provider that can't find the episode is surfaced as 404,
 * not a 500 — nothing here can rate an episode it can't identify.
 */
ratingRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/rating',
    summary: "Set the current user's rating for one episode",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
      body: { content: { 'application/json': { schema: setRatingRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Rating set',
        content: { 'application/json': { schema: ratingStatusSchema } },
      },
      404: { description: 'Show or episode not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const { rating } = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Show or episode not found' }, 404)

    let episode: { id: string }
    try {
      episode = await resolveEpisode(
        db,
        target.provider,
        target.externalId,
        seasonNumber,
        episodeNumber,
        user.locale,
      )
    } catch {
      return c.json({ error: 'Show or episode not found' }, 404)
    }

    const ratedAt = new Date()
    const [row] = await db
      .insert(ratings)
      .values({ userId: user.id, entityType: 'episode', entityId: episode.id, rating, ratedAt })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.entityType, ratings.entityId],
        set: { rating, ratedAt },
      })
      .returning({ rating: ratings.rating, ratedAt: ratings.ratedAt })

    return c.json({ rating: row!.rating, ratedAt: row!.ratedAt.toISOString() })
  },
)

/**
 * Clear the current user's rating for one episode. Deliberately does NOT
 * resolve the episode from the provider — if there's no local episode row
 * there can be no rating either, so this is a plain lookup-and-no-op
 * rather than paying for a provider round trip to clear something that
 * can't exist. Asymmetric with the PUT above on purpose.
 */
ratingRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/rating',
    summary: "Clear the current user's rating for one episode",
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
        description: 'Rating cleared',
        content: { 'application/json': { schema: ratingStatusSchema } },
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
    if (!episodeRow) return c.json({ rating: null, ratedAt: null })

    await db
      .delete(ratings)
      .where(
        and(
          eq(ratings.userId, userId),
          eq(ratings.entityType, 'episode'),
          eq(ratings.entityId, episodeRow.id),
        ),
      )

    return c.json({ rating: null, ratedAt: null })
  },
)

/**
 * Set (or replace) the current user's rating for a show
 * (apps/web/src/routes/ShowDetailPage.tsx's RatingPicker) — PUT, not POST,
 * since a rating is a single value-carrying sub-resource unique per
 * (user, show): re-sending the same body is a no-op, which PUT promises
 * and POST doesn't. Upserts on ratings_user_entity_idx, same as Trakt
 * import's processRatingItem (apps/api/src/import/trakt.ts) — unlike that
 * import path, this always re-stamps ratedAt on a write, since a manual
 * "I rated this again" is exactly when the user last said so, not
 * something to guard against re-processing.
 *
 * Deliberately never touches `plays` — rating and watched status are fully
 * independent (docs/TODO.md's ratings design pass). Don't "helpfully" wire
 * this into the watched flow.
 */
ratingRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/library/shows/{slug}/rating',
    summary: "Set the current user's rating for a show",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: setRatingRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Rating set',
        content: { 'application/json': { schema: ratingStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const { rating } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const ratedAt = new Date()
    const [row] = await db
      .insert(ratings)
      .values({ userId, entityType: 'show', entityId: show.id, rating, ratedAt })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.entityType, ratings.entityId],
        set: { rating, ratedAt },
      })
      .returning({ rating: ratings.rating, ratedAt: ratings.ratedAt })

    return c.json({ rating: row!.rating, ratedAt: row!.ratedAt.toISOString() })
  },
)

/**
 * Clear the current user's rating for a show. A no-op (nothing to delete)
 * if the show was never rated — same convention as DELETE .../dropped
 * above.
 */
ratingRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/rating',
    summary: "Clear the current user's rating for a show",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Rating cleared',
        content: { 'application/json': { schema: ratingStatusSchema } },
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

    await db
      .delete(ratings)
      .where(
        and(
          eq(ratings.userId, userId),
          eq(ratings.entityType, 'show'),
          eq(ratings.entityId, show.id),
        ),
      )

    return c.json({ rating: null, ratedAt: null })
  },
)

/**
 * Set (or replace) the current user's rating for a movie — movie
 * counterpart of PUT /library/shows/{slug}/rating above. Same reasoning
 * throughout (PUT semantics, upsert on ratings_user_entity_idx, no
 * interaction with `plays`).
 */
ratingRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/library/movies/{slug}/rating',
    summary: "Set the current user's rating for a movie",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: setRatingRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Rating set',
        content: { 'application/json': { schema: ratingStatusSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const { rating } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [movie] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, slug))
      .limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    const ratedAt = new Date()
    const [row] = await db
      .insert(ratings)
      .values({ userId, entityType: 'movie', entityId: movie.id, rating, ratedAt })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.entityType, ratings.entityId],
        set: { rating, ratedAt },
      })
      .returning({ rating: ratings.rating, ratedAt: ratings.ratedAt })

    return c.json({ rating: row!.rating, ratedAt: row!.ratedAt.toISOString() })
  },
)

/**
 * Clear the current user's rating for a movie — see DELETE
 * /library/shows/{slug}/rating above for the same "harmless no-op"
 * convention.
 */
ratingRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/movies/{slug}/rating',
    summary: "Clear the current user's rating for a movie",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Rating cleared',
        content: { 'application/json': { schema: ratingStatusSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [movie] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, slug))
      .limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    await db
      .delete(ratings)
      .where(
        and(
          eq(ratings.userId, userId),
          eq(ratings.entityType, 'movie'),
          eq(ratings.entityId, movie.id),
        ),
      )

    return c.json({ rating: null, ratedAt: null })
  },
)
