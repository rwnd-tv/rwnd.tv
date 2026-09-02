import { lt } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { pendingWebhookEvents } from '@rwnd/db'

/**
 * `pending_webhook_events` held no retention policy before this (M3
 * security review, F-08) — an account seen on a webhook but never linked
 * in Settings would accumulate events indefinitely. 90 days is generous
 * relative to how quickly a real self-hoster actually links a new Plex
 * account (see docs/TODO_ARCHIVE.md's multi-user Plex attribution entry):
 * long enough that someone who's just slow to open Settings doesn't lose
 * anything, short enough that an account nobody ever intends to link
 * doesn't grow this table forever.
 */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export async function pruneStalePendingWebhookEvents(db: Database): Promise<number> {
  const deleted = await db
    .delete(pendingWebhookEvents)
    .where(lt(pendingWebhookEvents.createdAt, new Date(Date.now() - RETENTION_MS)))
    .returning({ id: pendingWebhookEvents.id })
  return deleted.length
}

/**
 * Starts the recurring sweep: one pass immediately, then every 24h after
 * — same shape as apps/api/src/metadata/refresh.ts's
 * scheduleMetadataRefresh, and deliberately not inside createApp() for
 * the same reason (testApp() calls createApp() in every test; this must
 * not fire there).
 */
export function scheduleWebhookRetention(db: Database): void {
  const DAY_MS = 24 * 60 * 60 * 1000
  const run = () =>
    pruneStalePendingWebhookEvents(db)
      .then((count) => {
        if (count > 0) console.log(`Webhook retention: pruned ${count} stale pending event(s).`)
      })
      .catch((err: unknown) => console.error('Webhook retention sweep failed:', err))
  void run()
  setInterval(() => void run(), DAY_MS)
}
