import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { eq, sql } from 'drizzle-orm'
import { accountDataCountsSchema, clearDataRequestSchema } from '@rwnd/shared'
import { droppedShows, plays, ratings, watchlistItems } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'

export const accountRoutes = new OpenAPIHono<AppEnv>()

/**
 * Row counts behind DatabasePanel.tsx's checkbox labels — see
 * accountDataCountsSchema's doc comment for exactly what each counts.
 */
accountRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/account/data-counts',
    summary: "Count the current user's own tracked data, by category",
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Counts',
        content: { 'application/json': { schema: accountDataCountsSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')
    const count = sql<number>`count(*)`.mapWith(Number)

    const [[watchHistory], [ratingsCount], [watchlistCount], [droppedCount]] = await Promise.all([
      db.select({ count }).from(plays).where(eq(plays.userId, userId)),
      db.select({ count }).from(ratings).where(eq(ratings.userId, userId)),
      db.select({ count }).from(watchlistItems).where(eq(watchlistItems.userId, userId)),
      db.select({ count }).from(droppedShows).where(eq(droppedShows.userId, userId)),
    ])

    return c.json({
      watchHistory: watchHistory!.count,
      ratings: ratingsCount!.count,
      watchlist: watchlistCount!.count,
      droppedShows: droppedCount!.count,
    })
  },
)

/**
 * Bulk-deletes the current user's own tracked data (Settings > Database —
 * see apps/web/src/components/settings/DatabasePanel.tsx). Scoped to
 * `requireAuth` only, not `requireAdmin` — every category here is
 * per-user data (each table has its own `userId` column), same tier as
 * the Profile/API-tokens settings, not an instance-wide action. The
 * frontend's confirmation dialog is the only safety net; this route
 * itself does exactly what it's asked, no soft-delete/undo.
 */
accountRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/account/clear-data',
    summary: "Delete the current user's own watch history/ratings/watchlist/dropped shows",
    middleware: [requireAuth] as const,
    request: { body: { content: { 'application/json': { schema: clearDataRequestSchema } } } },
    responses: {
      204: { description: 'Cleared' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    // One transaction so a self-hoster who checked several boxes doesn't
    // end up with only some of them actually cleared if one delete fails.
    await db.transaction(async (tx) => {
      if (body.watchHistory) await tx.delete(plays).where(eq(plays.userId, userId))
      if (body.ratings) await tx.delete(ratings).where(eq(ratings.userId, userId))
      if (body.watchlist) await tx.delete(watchlistItems).where(eq(watchlistItems.userId, userId))
      if (body.droppedShows) await tx.delete(droppedShows).where(eq(droppedShows.userId, userId))
    })

    return c.body(null, 204)
  },
)
