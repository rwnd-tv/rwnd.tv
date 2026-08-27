import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  createWatchlistRequestSchema,
  listWatchlistsResponseSchema,
  updateWatchlistRequestSchema,
  watchlistDetailSchema,
  watchlistSummarySchema,
  type WatchlistSummary,
} from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { episodes, movies, shows, watchlistItems, watchlists } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { ensureDefaultWatchlist, getOwnedWatchlist } from '../lib/watchlists.js'

export const watchlistRoutes = new OpenAPIHono<AppEnv>()

type EntityType = 'movie' | 'show' | 'episode'

/**
 * The item that would become a watchlist's cover art if nothing's pinned —
 * "most recently added", plus the list's own item count (needed alongside
 * it anyway, both from one grouped pass over `watchlist_items`). The
 * `array_agg(... order by ...)[1]` trick stands in for `DISTINCT ON`, which
 * has no precedent elsewhere in this codebase's query builder usage — see
 * `getRecentlyWatchedCandidates` (apps/api/src/routes/library.ts) for the
 * same "aggregate CTE, cast with sql<T>" style this follows.
 */
async function resolveLatestItemPerList(db: Database, userId: string) {
  const rows = await db
    .select({
      watchlistId: watchlistItems.watchlistId,
      entityType: sql<EntityType>`(array_agg(${watchlistItems.entityType} order by ${watchlistItems.listedAt} desc))[1]`,
      entityId: sql<string>`(array_agg(${watchlistItems.entityId} order by ${watchlistItems.listedAt} desc))[1]`,
      itemCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .groupBy(watchlistItems.watchlistId)
  return new Map(rows.map((row) => [row.watchlistId, row]))
}

/** Batch-resolves posterPath for a set of (entityType, entityId) pairs —
 * one query per type rather than a per-row lookup, since a Watchlists index
 * page has at most a handful of lists. An `episode` entry (only reachable
 * via Trakt import — see watchlistItemMediaSchema's doc comment on why the
 * UI itself never creates one) falls back to its *show's* poster, same
 * convention as the Activity feed's `showViaEpisode` join
 * (apps/api/src/routes/activity.ts). */
async function resolvePosterPaths(
  db: Database,
  entities: { entityType: EntityType | null; entityId: string | null }[],
): Promise<Map<string, string | null>> {
  const idsOf = (type: EntityType) => [
    ...new Set(
      entities
        .filter((e) => e.entityType === type)
        .map((e) => e.entityId)
        .filter((id): id is string => id !== null),
    ),
  ]
  const movieIds = idsOf('movie')
  const showIds = idsOf('show')
  const episodeIds = idsOf('episode')

  const map = new Map<string, string | null>()
  if (movieIds.length > 0) {
    const rows = await db
      .select({ id: movies.id, posterPath: movies.posterPath })
      .from(movies)
      .where(inArray(movies.id, movieIds))
    for (const row of rows) map.set(`movie:${row.id}`, row.posterPath)
  }
  if (showIds.length > 0) {
    const rows = await db
      .select({ id: shows.id, posterPath: shows.posterPath })
      .from(shows)
      .where(inArray(shows.id, showIds))
    for (const row of rows) map.set(`show:${row.id}`, row.posterPath)
  }
  if (episodeIds.length > 0) {
    const rows = await db
      .select({ id: episodes.id, posterPath: shows.posterPath })
      .from(episodes)
      .innerJoin(shows, eq(episodes.showId, shows.id))
      .where(inArray(episodes.id, episodeIds))
    for (const row of rows) map.set(`episode:${row.id}`, row.posterPath)
  }
  return map
}

/**
 * Shared by GET /watchlists (every list) and PATCH /watchlists/{id} (just
 * the one that changed, so its response reflects a cover-art change) —
 * resolves item counts and cover posters for a batch of watchlist rows in a
 * fixed number of queries regardless of list count.
 */
async function buildWatchlistSummaries(
  db: Database,
  userId: string,
  listRows: { id: string; name: string; isDefault: boolean; coverItemId: string | null }[],
): Promise<WatchlistSummary[]> {
  if (listRows.length === 0) return []

  const latestByList = await resolveLatestItemPerList(db, userId)
  const coverItemIds = listRows
    .map((row) => row.coverItemId)
    .filter((id): id is string => id !== null)
  const pinnedItems =
    coverItemIds.length > 0
      ? await db
          .select({
            id: watchlistItems.id,
            entityType: watchlistItems.entityType,
            entityId: watchlistItems.entityId,
          })
          .from(watchlistItems)
          .where(inArray(watchlistItems.id, coverItemIds))
      : []
  const pinnedById = new Map(pinnedItems.map((item) => [item.id, item]))

  const effective = listRows.map((row) => {
    const pinned = row.coverItemId ? pinnedById.get(row.coverItemId) : undefined
    const latest = latestByList.get(row.id)
    const chosen = pinned ?? latest
    return {
      ...row,
      itemCount: latest?.itemCount ?? 0,
      entityType: (chosen?.entityType ?? null) as EntityType | null,
      entityId: chosen?.entityId ?? null,
    }
  })

  const posterByEntity = await resolvePosterPaths(db, effective)

  return effective.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    itemCount: row.itemCount,
    coverPosterPath:
      row.entityType && row.entityId
        ? (posterByEntity.get(`${row.entityType}:${row.entityId}`) ?? null)
        : null,
  }))
}

watchlistRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/watchlists',
    summary: "List the current user's watchlists",
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Watchlists',
        content: { 'application/json': { schema: listWatchlistsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    // Belt-and-braces: registration is the normal path that creates
    // Default (routes/setup.ts, routes/auth.ts), but this guards against
    // any account that predates it or was created some other way — the
    // Watchlists index should never render with no Default tile at all.
    await ensureDefaultWatchlist(db, userId)

    // Default first, then in creation order — matches the plain-list-of-
    // tiles layout the Watchlists index renders (no separate sort control).
    const listRows = await db
      .select({
        id: watchlists.id,
        name: watchlists.name,
        isDefault: watchlists.isDefault,
        coverItemId: watchlists.coverItemId,
      })
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(desc(watchlists.isDefault), asc(watchlists.createdAt))

    const summaries = await buildWatchlistSummaries(db, userId, listRows)
    return c.json({ watchlists: summaries })
  },
)

watchlistRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/watchlists',
    summary: 'Create a new watchlist',
    middleware: [requireAuth] as const,
    request: {
      body: { content: { 'application/json': { schema: createWatchlistRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Watchlist created',
        content: { 'application/json': { schema: watchlistSummarySchema } },
      },
      409: { description: 'A watchlist with this name already exists' },
    },
  }),
  async (c) => {
    const { name } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [dup] = await db
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(and(eq(watchlists.userId, userId), eq(watchlists.name, name)))
      .limit(1)
    if (dup) return c.json({ error: 'A watchlist with this name already exists' }, 409)

    const [created] = await db.insert(watchlists).values({ userId, name }).returning()
    if (!created) throw new Error('Failed to create watchlist')

    return c.json(
      {
        id: created.id,
        name: created.name,
        isDefault: created.isDefault,
        itemCount: 0,
        coverPosterPath: null,
      },
      201,
    )
  },
)

watchlistRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/watchlists/{id}',
    summary: 'Rename a watchlist or set its pinned cover, both optional in one request',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: updateWatchlistRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Watchlist updated',
        content: { 'application/json': { schema: watchlistSummarySchema } },
      },
      400: { description: 'The Default watchlist cannot be renamed' },
      404: { description: 'Watchlist, or the item to pin as cover, not found' },
      409: { description: 'A watchlist with this name already exists' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { name, coverItemId } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const existing = await getOwnedWatchlist(db, userId, id)
    if (!existing) return c.json({ error: 'Watchlist not found' }, 404)
    if (name !== undefined && existing.isDefault) {
      return c.json({ error: 'The Default watchlist cannot be renamed' }, 400)
    }

    if (name !== undefined && name !== existing.name) {
      const [dup] = await db
        .select({ id: watchlists.id })
        .from(watchlists)
        .where(and(eq(watchlists.userId, userId), eq(watchlists.name, name)))
        .limit(1)
      if (dup) return c.json({ error: 'A watchlist with this name already exists' }, 409)
    }

    // Must be one of this list's own items — otherwise a user could pin
    // another list's (or, since ids are opaque uuids, in principle another
    // user's) item as their cover art.
    if (coverItemId) {
      const [item] = await db
        .select({ id: watchlistItems.id })
        .from(watchlistItems)
        .where(and(eq(watchlistItems.id, coverItemId), eq(watchlistItems.watchlistId, id)))
        .limit(1)
      if (!item) return c.json({ error: 'Item not found on this watchlist' }, 404)
    }

    const [updated] = await db
      .update(watchlists)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(coverItemId !== undefined ? { coverItemId } : {}),
      })
      .where(eq(watchlists.id, id))
      .returning({
        id: watchlists.id,
        name: watchlists.name,
        isDefault: watchlists.isDefault,
        coverItemId: watchlists.coverItemId,
      })
    if (!updated) throw new Error('Failed to update watchlist')

    const [summary] = await buildWatchlistSummaries(db, userId, [updated])
    return c.json(summary!)
  },
)

watchlistRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/watchlists/{id}',
    summary: 'Delete a watchlist',
    middleware: [requireAuth] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Watchlist deleted' },
      400: { description: 'The Default watchlist cannot be deleted' },
      404: { description: 'Watchlist not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const existing = await getOwnedWatchlist(db, userId, id)
    if (!existing) return c.json({ error: 'Watchlist not found' }, 404)
    if (existing.isDefault) return c.json({ error: 'The Default watchlist cannot be deleted' }, 400)

    // watchlist_items.watchlist_id ON DELETE CASCADE handles the list's own
    // items; watchlists.cover_item_id ON DELETE SET NULL (on any *other*
    // list that happened to pin one of this list's items — not possible
    // today since PATCH only accepts an item already on the same list, but
    // the FK doesn't assume that stays true) can't dangle either.
    await db.delete(watchlists).where(eq(watchlists.id, id))
    return c.body(null, 204)
  },
)

watchlistRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/watchlists/{id}',
    summary: "One watchlist's shows and movies",
    middleware: [requireAuth] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Watchlist detail',
        content: { 'application/json': { schema: watchlistDetailSchema } },
      },
      404: { description: 'Watchlist not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const existing = await getOwnedWatchlist(db, userId, id)
    if (!existing) return c.json({ error: 'Watchlist not found' }, 404)

    // Movie/show items only — an episode-level entry (the schema allows
    // one, see watchlistItemMediaSchema's doc comment) is left out of the
    // gallery entirely rather than represented with no page to link to.
    const movieItems = await db
      .select({
        itemId: watchlistItems.id,
        slug: movies.slug,
        title: movies.title,
        year: movies.year,
        posterPath: movies.posterPath,
        listedAt: watchlistItems.listedAt,
      })
      .from(watchlistItems)
      .innerJoin(movies, eq(watchlistItems.entityId, movies.id))
      .where(and(eq(watchlistItems.watchlistId, id), eq(watchlistItems.entityType, 'movie')))
    const showItems = await db
      .select({
        itemId: watchlistItems.id,
        slug: shows.slug,
        title: shows.title,
        year: shows.year,
        posterPath: shows.posterPath,
        listedAt: watchlistItems.listedAt,
      })
      .from(watchlistItems)
      .innerJoin(shows, eq(watchlistItems.entityId, shows.id))
      .where(and(eq(watchlistItems.watchlistId, id), eq(watchlistItems.entityType, 'show')))

    const items = [
      ...movieItems.map((item) => ({ ...item, type: 'movie' as const })),
      ...showItems.map((item) => ({ ...item, type: 'show' as const })),
    ].sort((a, b) => b.listedAt.getTime() - a.listedAt.getTime())

    return c.json({
      id: existing.id,
      name: existing.name,
      isDefault: existing.isDefault,
      coverItemId: existing.coverItemId,
      items: items.map((item) => ({
        itemId: item.itemId,
        type: item.type,
        slug: item.slug,
        title: item.title,
        year: item.year,
        posterPath: item.posterPath,
        listedAt: item.listedAt.toISOString(),
      })),
    })
  },
)
