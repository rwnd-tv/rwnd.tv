import { eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { calendarFeeds, users } from '@rwnd/db'
import type { CalendarFeed } from '@rwnd/shared'
import { generateSecret, hashSecret } from './tokens.js'
import { encryptSecret, decryptSecret } from './crypto.js'

// Distinct from API tokens' `rwnd_` prefix so a leaked string is
// identifiable at a glance and can never be confused for one.
const CALENDAR_TOKEN_PREFIX = 'rwndcal_'

export function generateCalendarToken(encryptionKey: string): {
  token: string
  hash: string
  encrypted: string
} {
  const token = CALENDAR_TOKEN_PREFIX + generateSecret(32)
  return { token, hash: hashSecret(token), encrypted: encryptSecret(token, encryptionKey) }
}

/** Row -> wire shape, decrypting the token for re-display — see
 * `calendarFeeds`' doc comment (packages/db/src/schema.ts) for why this
 * one secret is recoverable rather than only hash-checkable. Only the
 * settings that apply to the row's own `feedType` are included. An
 * exhaustive switch, not a ternary — with three feed types a binary
 * ternary would silently mis-serialize the odd one out; this way a
 * fourth type is a compile error instead. */
export function serializeCalendarFeed(
  row: typeof calendarFeeds.$inferSelect,
  encryptionKey: string,
): CalendarFeed {
  const shared = {
    token: decryptSecret(row.tokenEncrypted, encryptionKey),
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
  switch (row.feedType) {
    case 'history':
      return {
        feedType: 'history',
        ...shared,
        settings: { includeMovies: row.includeMovies, includeShows: row.includeShows },
      }
    case 'shows':
      return {
        feedType: 'shows',
        ...shared,
        settings: {
          includeDropped: row.includeDropped,
          futureOnly: row.futureOnly,
          includeAllWatched: row.includeAllWatched,
        },
      }
    case 'movies':
      return {
        feedType: 'movies',
        ...shared,
        settings: { futureOnly: row.futureOnly, includeAllWatched: row.includeAllWatched },
      }
  }
}

export interface ResolvedCalendarFeed {
  feed: typeof calendarFeeds.$inferSelect
  user: typeof users.$inferSelect
}

// A feed is polled on a schedule (Apple as often as every 5 minutes,
// Google roughly daily), not per user action, so per-fetch precision on
// `lastAccessedAt` buys nothing — it only backs a "Last synced" hint.
// Throttled the same way `resolveSession` throttles its own
// `lastUsedAt`, just far wider: it keeps the write rate independent of
// how many devices are subscribed. (`resolveApiToken` writes
// unconditionally on every hit; at webhook volumes that's fine, but
// isn't a pattern worth copying onto a feed a device might poll every
// few minutes.)
const LAST_ACCESSED_THROTTLE_MS = 15 * 60 * 1000

/**
 * Resolves a calendar subscription token to the feed *and its owner* —
 * deliberately unlike `resolveApiToken` (lib/api-tokens.ts) sitting
 * beside it, which resolves only to a token id because a webhook token
 * can legitimately serve several media-server users. A calendar feed is
 * exactly one person's by construction, and the event builder
 * (apps/api/src/calendar/build.ts) needs both `user.timezone` and the
 * feed's own settings, so this joins `users` the way `resolveSession`
 * does.
 */
export async function resolveCalendarFeed(
  db: Database,
  token: string,
): Promise<ResolvedCalendarFeed | null> {
  const [row] = await db
    .select({ feed: calendarFeeds, user: users })
    .from(calendarFeeds)
    .innerJoin(users, eq(calendarFeeds.userId, users.id))
    .where(eq(calendarFeeds.tokenHash, hashSecret(token)))
    .limit(1)
  if (!row) return null

  const lastAccessedAt = row.feed.lastAccessedAt?.getTime() ?? 0
  if (Date.now() - lastAccessedAt > LAST_ACCESSED_THROTTLE_MS) {
    await db
      .update(calendarFeeds)
      .set({ lastAccessedAt: new Date() })
      .where(eq(calendarFeeds.id, row.feed.id))
  }
  return row
}
