import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { type SQL, and, desc, eq, lt } from 'drizzle-orm'
import {
  UNKNOWN_WATCHED_AT,
  createPlayRequestSchema,
  listPlaysQuerySchema,
  listPlaysResponseSchema,
  playSchema,
  updatePlayRequestSchema,
  uuidSchema,
} from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { episodes, movies, plays, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { episodeDisplayTitle, resolveEpisode, resolveMovie } from '../lib/media.js'
import { type ConflictingPlay, isOrigin, reconcilePlayDuplicates } from '../lib/plays.js'

export const playRoutes = new OpenAPIHono<AppEnv>()

/** Shared by GET /plays and PATCH /plays/{id} — both join the same four
 * tables and need the same movie-or-episode media shape back out. */
function toPlayResponse(row: {
  play: typeof plays.$inferSelect
  movie: typeof movies.$inferSelect | null
  episode: typeof episodes.$inferSelect | null
  show: typeof shows.$inferSelect | null
}) {
  return {
    id: row.play.id,
    watchedAt: row.play.watchedAt.toISOString(),
    source: row.play.source,
    createdAt: row.play.createdAt.toISOString(),
    media: row.movie
      ? {
          type: 'movie' as const,
          title: row.movie.title,
          posterPath: row.movie.posterPath,
          movieSlug: row.movie.slug,
        }
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
  }
}

/**
 * Two unknown-date watches of the same movie/episode are indistinguishable
 * from each other (same rounding-error-prone sentinel timestamp, see the
 * tie-break fix DELETE /library/shows/.../plays needed in
 * apps/api/src/routes/library/shows.ts), so a second one adds nothing — reject
 * rather than silently create a duplicate the user can't tell apart from
 * the first. Shared by both the movie and episode branches of POST /plays
 * below. Only applies going forward through this route; doesn't touch
 * existing data (a Trakt import can legitimately leave a title with
 * several genuinely separate unknown-date plays already).
 */
async function hasExistingUnknownDateWatch(
  db: Database,
  userId: string,
  mediaCondition: SQL,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: plays.id })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        mediaCondition,
        eq(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT)),
      ),
    )
    .limit(1)
  return Boolean(existing)
}

/** When `reconcilePlayDuplicates` declines to insert a manual watch
 * because an origin webhook already covers it (see plays.ts's own doc
 * comment), the origin play that "won" is what actually gets shown back
 * to the user instead of a newly-created row — logging a watch that
 * turns out to already be recorded automatically is still success from
 * the user's point of view, not an error. Picks the most recently
 * watched origin conflict if more than one somehow exists. */
async function findSurvivingOriginPlay(
  db: Database,
  conflicts: ConflictingPlay[],
): Promise<typeof plays.$inferSelect | null> {
  const [winner] = conflicts
    .filter((c) => isOrigin(c.source))
    .sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime())
  if (!winner) return null
  const [row] = await db.select().from(plays).where(eq(plays.id, winner.id)).limit(1)
  return row ?? null
}

/**
 * The latest `watchedAt` a movie/episode watch can legitimately claim
 * right now — mirrors the frontend's own bound exactly
 * (`WatchDateDialog.tsx`'s `maxDate`, `now + runtime`). "Now watching"
 * logs a *predicted finish time* up front, before the watch has actually
 * finished, not a start time (see plays_watchedat_semantics memory) — a
 * flat "no later than now" cutoff rejected every legitimate use of that
 * mode for anything with a known runtime (live-confirmed 2026-09-11: a
 * 57-minute episode's "now watching" submission was flatly 400'd).
 * Unknown runtime falls back to 0, same as the frontend's own `?? 0`.
 */
function maxWatchedAt(runtimeMinutes: number | null): Date {
  return new Date(Date.now() + (runtimeMinutes ?? 0) * 60_000)
}

playRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/plays',
    summary: "List the current user's watch history, newest first",
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
      plays: page.map(toPlayResponse),
      nextCursor: hasMore ? (page[page.length - 1]?.play.watchedAt.toISOString() ?? null) : null,
    })
  },
)

playRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/plays',
    summary: 'Log a watch',
    request: { body: { content: { 'application/json': { schema: createPlayRequestSchema } } } },
    responses: {
      201: { description: 'Play logged', content: { 'application/json': { schema: playSchema } } },
      400: {
        description:
          'watchedAt is in the future, the episode has not aired yet, or the movie/episode already has an unknown-date watch logged',
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!
    const watchedAt = body.watchedAt ? new Date(body.watchedAt) : new Date()

    if (body.movie) {
      const movie = await resolveMovie(db, provider, body.movie.externalId, user.locale)

      // Never guess a watch into the future — the client already clamps
      // its own date pickers to maxWatchedAt (WatchDateDialog.tsx), but
      // this is the real backstop: nothing here trusts that a client did
      // its job. The 1900-01-01 "unknown date" sentinel
      // (UNKNOWN_WATCHED_AT) is always safely in the past, so it's
      // unaffected. See maxWatchedAt's own doc comment for why the bound
      // isn't just "now".
      if (watchedAt.getTime() > maxWatchedAt(movie.runtimeMinutes).getTime()) {
        console.error(
          `POST /plays: rejected watchedAt ${watchedAt.toISOString()} for movie "${movie.title}" (runtime ${movie.runtimeMinutes ?? 'unknown'}min, now ${new Date().toISOString()})`,
        )
        return c.json({ error: 'watchedAt cannot be in the future' }, 400)
      }

      // Same duplicate-unknown-date guard the episode branch below enforces
      // — see hasExistingUnknownDateWatch's doc comment. The movie page's
      // "+" (log an additional watch) button offers the same "Unknown
      // date" option WatchDateDialog offers everywhere, so it needs the
      // same protection an episode already has.
      if (
        watchedAt.toISOString() === UNKNOWN_WATCHED_AT &&
        (await hasExistingUnknownDateWatch(db, user.id, eq(plays.movieId, movie.id)))
      ) {
        return c.json({ error: 'This movie already has an unknown-date watch logged' }, 400)
      }

      const { inserted, conflicts } = await reconcilePlayDuplicates(
        db,
        user.id,
        { movieId: movie.id },
        watchedAt,
        'manual',
      )
      const play = inserted ?? (await findSurvivingOriginPlay(db, conflicts))
      if (!play) throw new Error('Failed to log play')
      return c.json(
        {
          id: play.id,
          watchedAt: play.watchedAt.toISOString(),
          source: play.source,
          createdAt: play.createdAt.toISOString(),
          media: {
            type: 'movie' as const,
            title: movie.title,
            posterPath: movie.posterPath,
            movieSlug: movie.slug,
          },
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
    // logMissingWatches (apps/api/src/routes/library/shared.ts) — an episode with
    // no known or future firstAired can't have been watched yet, no matter
    // what watchedAt is requested.
    if (episode.firstAired === null || new Date(episode.firstAired) > new Date()) {
      return c.json({ error: 'This episode has not aired yet' }, 400)
    }

    // See the movie branch's identical check above, and maxWatchedAt's
    // own doc comment for why the bound isn't just "now".
    if (watchedAt.getTime() > maxWatchedAt(episode.runtimeMinutes).getTime()) {
      console.error(
        `POST /plays: rejected watchedAt ${watchedAt.toISOString()} for episode "${episode.title}" S${episode.seasonNumber}E${episode.episodeNumber} (runtime ${episode.runtimeMinutes ?? 'unknown'}min, now ${new Date().toISOString()})`,
      )
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    // See hasExistingUnknownDateWatch's doc comment above.
    if (
      watchedAt.toISOString() === UNKNOWN_WATCHED_AT &&
      (await hasExistingUnknownDateWatch(db, user.id, eq(plays.episodeId, episode.id)))
    ) {
      return c.json({ error: 'This episode already has an unknown-date watch logged' }, 400)
    }

    const { inserted, conflicts } = await reconcilePlayDuplicates(
      db,
      user.id,
      { episodeId: episode.id },
      watchedAt,
      'manual',
    )
    const play = inserted ?? (await findSurvivingOriginPlay(db, conflicts))
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
    request: { params: z.object({ id: uuidSchema }) },
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

playRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/plays/{id}',
    summary: "Edit a logged play's watched date/time",
    request: {
      params: z.object({ id: uuidSchema }),
      body: { content: { 'application/json': { schema: updatePlayRequestSchema } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: playSchema } } },
      400: { description: 'watchedAt cannot be in the future' },
      404: { description: 'Play not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { watchedAt: watchedAtRaw } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')
    const watchedAt = new Date(watchedAtRaw)

    // Same "never guess a watch into the future" backstop as POST /plays,
    // and the same runtime-aware bound (maxWatchedAt's doc comment) — an
    // "Other date" edit is clamped client-side to the same now+runtime
    // ceiling "now watching" itself computes, so the server has to know
    // this play's own movie/episode runtime before it can validate it.
    const [existing] = await db
      .select({
        movieRuntimeMinutes: movies.runtimeMinutes,
        episodeRuntimeMinutes: episodes.runtimeMinutes,
      })
      .from(plays)
      .leftJoin(movies, eq(plays.movieId, movies.id))
      .leftJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.id, id), eq(plays.userId, userId)))
      .limit(1)
    if (!existing) return c.json({ error: 'Play not found' }, 404)

    const runtimeMinutes = existing.movieRuntimeMinutes ?? existing.episodeRuntimeMinutes
    if (watchedAt.getTime() > maxWatchedAt(runtimeMinutes).getTime()) {
      console.error(
        `PATCH /plays/${id}: rejected watchedAt ${watchedAt.toISOString()} (runtime ${runtimeMinutes ?? 'unknown'}min, now ${new Date().toISOString()})`,
      )
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    // Always flips source to 'manual' — an edited timestamp no longer
    // reflects what Plex's scrobble or an import actually reported (see
    // updatePlayRequestSchema's doc comment, packages/shared/src/schemas/plays.ts).
    const [updated] = await db
      .update(plays)
      .set({ watchedAt, source: 'manual' })
      .where(and(eq(plays.id, id), eq(plays.userId, userId)))
      .returning({ id: plays.id })
    if (!updated) return c.json({ error: 'Play not found' }, 404)

    // Scoped by userId too, not just id, even though the preceding UPDATE
    // already 404'd unless this row was the caller's own (id is the PK,
    // so this can only ever re-select the row just proven to belong to
    // them) — defense in depth against the pattern being copy-pasted
    // somewhere it would matter (M3 security review, F-21).
    const [row] = await db
      .select({ play: plays, movie: movies, episode: episodes, show: shows })
      .from(plays)
      .leftJoin(movies, eq(plays.movieId, movies.id))
      .leftJoin(episodes, eq(plays.episodeId, episodes.id))
      .leftJoin(shows, eq(episodes.showId, shows.id))
      .where(and(eq(plays.id, id), eq(plays.userId, userId)))
      .limit(1)

    return c.json(toPlayResponse(row!))
  },
)
