import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, desc, eq, lt } from 'drizzle-orm'
import {
  createPlayRequestSchema,
  listPlaysQuerySchema,
  listPlaysResponseSchema,
  playSchema,
} from '@rwnd/shared'
import { episodes, movies, plays, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { episodeDisplayTitle, resolveEpisode, resolveMovie } from '../lib/media.js'

export const playRoutes = new OpenAPIHono<AppEnv>()

playRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/plays',
    summary: "List the current user's watch history, newest first",
    middleware: [requireAuth] as const,
    request: { query: listPlaysQuerySchema },
    responses: {
      200: {
        description: 'Plays',
        content: { 'application/json': { schema: listPlaysResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { cursor, limit } = c.req.valid('query')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const rows = await db
      .select({ play: plays, movie: movies, episode: episodes, show: shows })
      .from(plays)
      .leftJoin(movies, eq(plays.movieId, movies.id))
      .leftJoin(episodes, eq(plays.episodeId, episodes.id))
      .leftJoin(shows, eq(episodes.showId, shows.id))
      .where(
        and(eq(plays.userId, userId), cursor ? lt(plays.watchedAt, new Date(cursor)) : undefined),
      )
      .orderBy(desc(plays.watchedAt))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return c.json({
      plays: page.map((row) => ({
        id: row.play.id,
        watchedAt: row.play.watchedAt.toISOString(),
        source: row.play.source,
        createdAt: row.play.createdAt.toISOString(),
        media: row.movie
          ? { type: 'movie' as const, title: row.movie.title, posterPath: row.movie.posterPath }
          : {
              type: 'episode' as const,
              title: episodeDisplayTitle(
                row.episode?.title ?? null,
                row.episode?.seasonNumber,
                row.episode?.episodeNumber,
              ),
              posterPath: row.show?.posterPath ?? null,
              showSlug: row.show?.slug,
              showTitle: row.show?.title,
              seasonNumber: row.episode?.seasonNumber,
              episodeNumber: row.episode?.episodeNumber,
            },
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.play.watchedAt.toISOString() ?? null) : null,
    })
  },
)

playRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/plays',
    summary: 'Log a watch',
    middleware: [requireAuth] as const,
    request: { body: { content: { 'application/json': { schema: createPlayRequestSchema } } } },
    responses: {
      201: { description: 'Play logged', content: { 'application/json': { schema: playSchema } } },
      400: { description: 'watchedAt is in the future, or the episode has not aired yet' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!
    const watchedAt = body.watchedAt ? new Date(body.watchedAt) : new Date()

    // Never guess a watch into the future — the client already clamps its
    // own date pickers to "now" (WatchDateDialog.tsx), but this is the
    // real backstop: nothing here trusts that a client did its job. The
    // 1900-01-01 "unknown date" sentinel (UNKNOWN_WATCHED_AT) is always
    // safely in the past, so it's unaffected.
    if (watchedAt.getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    if (body.movie) {
      const movie = await resolveMovie(db, provider, body.movie.externalId, user.locale)
      const [play] = await db
        .insert(plays)
        .values({ userId: user.id, movieId: movie.id, watchedAt, source: 'manual' })
        .returning()
      if (!play) throw new Error('Failed to log play')
      return c.json(
        {
          id: play.id,
          watchedAt: play.watchedAt.toISOString(),
          source: play.source,
          createdAt: play.createdAt.toISOString(),
          media: { type: 'movie' as const, title: movie.title, posterPath: movie.posterPath },
        },
        201,
      )
    }

    const ep = body.episode!
    const episode = await resolveEpisode(
      db,
      provider,
      ep.showExternalId,
      ep.seasonNumber,
      ep.episodeNumber,
      user.locale,
    )

    // Same "no unaired episode" rule as the bulk "Watched" button's
    // logMissingWatches (apps/api/src/routes/library.ts) — an episode with
    // no known or future firstAired can't have been watched yet, no matter
    // what watchedAt is requested.
    if (episode.firstAired === null || new Date(episode.firstAired) > new Date()) {
      return c.json({ error: 'This episode has not aired yet' }, 400)
    }

    const [play] = await db
      .insert(plays)
      .values({ userId: user.id, episodeId: episode.id, watchedAt, source: 'manual' })
      .returning()
    if (!play) throw new Error('Failed to log play')
    return c.json(
      {
        id: play.id,
        watchedAt: play.watchedAt.toISOString(),
        source: play.source,
        createdAt: play.createdAt.toISOString(),
        media: {
          type: 'episode' as const,
          title: episodeDisplayTitle(episode.title, episode.seasonNumber, episode.episodeNumber),
          posterPath: episode.posterPath,
          showSlug: episode.showSlug,
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        },
      },
      201,
    )
  },
)

playRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/plays/{id}',
    summary: 'Remove a logged play',
    middleware: [requireAuth] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Removed' },
      404: { description: 'Play not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await c
      .get('db')
      .delete(plays)
      .where(and(eq(plays.id, id), eq(plays.userId, c.get('user')!.id)))
      .returning({ id: plays.id })
    if (result.length === 0) return c.json({ error: 'Play not found' }, 404)
    return c.body(null, 204)
  },
)
