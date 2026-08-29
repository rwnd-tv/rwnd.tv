import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { accountDataCountsSchema, clearDataRequestSchema } from '@rwnd/shared'
import { droppedShows, plays, ratings, watchlistItems, watchlists } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { buildExportFiles } from '../export/build.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'

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
 * see apps/web/src/components/settings/DatabasePanel.tsx). Not
 * `requireAdmin`-gated — every category here is per-user data (each table
 * has its own `userId` column), same tier as the Profile/API-tokens
 * settings, not an instance-wide action. The
 * frontend's confirmation dialog is the only safety net; this route
 * itself does exactly what it's asked, no soft-delete/undo.
 */
accountRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/account/clear-data',
    summary: "Delete the current user's own watch history/ratings/watchlist/dropped shows",
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
      if (body.watchlist) {
        // Deletes every custom list too (James, 2026-08-27), not just their
        // items — ON DELETE CASCADE takes the items with it. The Default
        // list itself is never deleted (see watchlists' doc comment,
        // packages/db/src/schema.ts), only emptied.
        await tx
          .delete(watchlists)
          .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, false)))
        const defaultWatchlistId = await ensureDefaultWatchlist(tx, userId)
        await tx.delete(watchlistItems).where(eq(watchlistItems.watchlistId, defaultWatchlistId))
      }
      if (body.droppedShows) await tx.delete(droppedShows).where(eq(droppedShows.userId, userId))
    })

    return c.body(null, 204)
  },
)

/**
 * The open-format full data export (Settings > Database — see
 * DatabasePanel.tsx). Plain route, not `.openapi()` — same reasoning as
 * `apps/api/src/routes/auth.ts`'s avatar GET: a raw binary (zip) response
 * doesn't fit the typed-JSON convention every other route here uses. See
 * apps/api/src/export/build.ts's doc comment for why this is a separate,
 * flatter CSV shape from the JSON Backup feature rather than reusing it.
 */
accountRoutes.get('/account/export', async (c) => {
  const userId = c.get('user')!.id
  const db = c.get('db')

  const files = await buildExportFiles(db, userId)
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
  )

  const date = new Date().toISOString().slice(0, 10)
  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment; filename="rwnd-tv-export-${date}.zip"`)
  return c.body(zipped)
})
