import { and, eq } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { watchlistItems, watchlists } from '@rwnd/db'

/** The one list every user always has — see `watchlists`' doc comment in
 * packages/db/src/schema.ts for why it exists and what can never change
 * about it. This is the real, permanent name shown in the UI, not a
 * placeholder — migration 0022 seeds this exact string for every
 * pre-existing user, and it must stay in sync with that. */
export const DEFAULT_WATCHLIST_NAME = 'Default'

/**
 * Returns the id of `userId`'s Default watchlist, creating it first if this
 * is the first time anything's asked for it. Called from registration
 * (routes/setup.ts, routes/auth.ts) so the common case never hits the
 * lazy-create path, but every writer that needs a target list (the
 * importers, backup restore) calls this too rather than assuming
 * registration already ran it — defensive against a user who registered
 * before this feature existed and never got backfilled any other way.
 * Race-safe isn't a concern here: every call site is scoped to one user
 * acting on their own account, never two concurrent requests creating the
 * same user's Default at once.
 */
export async function ensureDefaultWatchlist(db: Database | Tx, userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, true)))
    .limit(1)
  if (existing) return existing.id

  const [created] = await db
    .insert(watchlists)
    .values({ userId, name: DEFAULT_WATCHLIST_NAME, isDefault: true })
    .returning({ id: watchlists.id })
  if (!created) throw new Error('Failed to create default watchlist')
  return created.id
}

/**
 * A watchlist row, scoped to the requesting user — undefined if it doesn't
 * exist or belongs to someone else, which every caller treats as a 404
 * rather than distinguishing the two (same "don't leak whether another
 * user's id exists" reasoning as every other per-user lookup in this app).
 * Shared by routes/watchlists.ts's own PATCH/DELETE and
 * routes/library.ts's per-title membership routes, both of which need to
 * resolve and validate a `watchlistId` path/body value before writing.
 */
export async function getOwnedWatchlist(db: Database | Tx, userId: string, watchlistId: string) {
  const [row] = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)))
    .limit(1)
  return row
}

/**
 * Every one of the current user's watchlists a given show/movie is
 * currently on — backs `myWatchlistIds` on the show/movie detail routes
 * (showDetailSchema/movieDetailSchema, apps/api/src/routes/library.ts).
 * Scoped by `userId` via a join rather than trusting `watchlistItems.userId`
 * alone, since the two are always written together anyway (see
 * watchlistItems' doc comment in packages/db/src/schema.ts) — this just
 * follows the FK relationship a query over `watchlists` would use.
 */
export async function getMyWatchlistIds(
  db: Database | Tx,
  userId: string,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
): Promise<string[]> {
  const rows = await db
    .select({ watchlistId: watchlistItems.watchlistId })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.entityType, entityType),
        eq(watchlistItems.entityId, entityId),
      ),
    )
  return rows.map((row) => row.watchlistId)
}
