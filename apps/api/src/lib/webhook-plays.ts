import { and, eq } from 'drizzle-orm'
import { pendingWebhookEvents } from '@rwnd/db'
import type { Database, webhookAccountLinks } from '@rwnd/db'
import type { WebhookSource } from '@rwnd/shared'
import type { MetadataProvider } from '../providers/types.js'
import type { UserRecord } from '../types.js'
import type { WatchEvent } from '../webhooks/types.js'
import {
  resolveEpisodeSoft,
  resolveMovieFromExternalIds,
  resolveShowFromExternalIds,
} from './external-match.js'
import { reconcilePlayDuplicates } from './plays.js'

/**
 * Resolves one webhook event's movie/episode and logs it as a play for
 * `user` — the one piece of logic shared identically by a live webhook
 * delivery (`apps/api/src/routes/webhooks.ts`) and a retroactive replay
 * once a previously-unlinked account gets linked
 * (`apps/api/src/routes/tokens.ts`'s webhook-link link route), so the
 * two paths can never drift apart. A title/episode none of the
 * configured providers recognize is logged server-side only
 * (`console.error`, matching the metadata refresher's own per-item
 * failure convention) and otherwise silently skipped — no persisted
 * activity log for that case. Retry-of-the-same-delivery collapsing (none
 * of these sources hand over a stable per-delivery event id) is handled
 * inside `reconcilePlayDuplicates` itself, not by a `sourceRef` here — see
 * its own doc comment.
 */
export async function logWebhookPlay(
  db: Database,
  providers: MetadataProvider[],
  user: UserRecord,
  event: WatchEvent,
  watchedAt: Date,
  source: WebhookSource,
): Promise<void> {
  if (event.media.type === 'movie') {
    const movie = await resolveMovieFromExternalIds(db, providers, event.ids, user.locale)
    if (!movie) {
      console.error(`${source} webhook: no configured provider matched a movie`, event.ids)
      return
    }
    await reconcilePlayDuplicates(db, user.id, { movieId: movie.id }, watchedAt, source)
    return
  }

  const show = await resolveShowFromExternalIds(db, providers, event.ids, user.locale)
  if (!show) {
    console.error(
      `${source} webhook: no configured provider matched show "${event.media.showTitle}"`,
      event.ids,
    )
    return
  }
  const episode = await resolveEpisodeSoft(
    db,
    show,
    event.media.seasonNumber,
    event.media.episodeNumber,
    user.locale,
  )
  if (!episode) {
    console.error(
      `${source} webhook: "${show.title}" S${event.media.seasonNumber}E${event.media.episodeNumber} not found via ${show.provider.source.toUpperCase()}`,
    )
    return
  }
  await reconcilePlayDuplicates(db, user.id, { episodeId: episode.id }, watchedAt, source)
}

/**
 * Replays every `pendingWebhookEvents` row stashed for one link while it
 * was unlinked, now that it's been linked by `user` — shared by every
 * way a link can get linked (self-link and link-code redemption, both
 * `apps/api/src/routes/tokens.ts` / `webhook-links.ts`). One-shot:
 * whatever happens, the pending rows are gone afterward, same as a live
 * delivery only ever gets one attempt. One event's unexpected failure (a
 * provider bug, a transient network error — `logWebhookPlay`'s own "no
 * configured provider recognizes this title" case already returns
 * normally rather than throwing) must not stop the rest of this batch
 * from replaying, or block the unconditional delete below — otherwise a
 * single bad event wedges every *other* pending event for this account
 * behind it indefinitely, never actually one-shot.
 */
export async function replayPendingWebhookEvents(
  db: Database,
  providers: MetadataProvider[],
  user: UserRecord,
  link: Pick<typeof webhookAccountLinks.$inferSelect, 'tokenId' | 'source' | 'externalAccountId'>,
): Promise<void> {
  const where = and(
    eq(pendingWebhookEvents.tokenId, link.tokenId),
    eq(pendingWebhookEvents.source, link.source),
    eq(pendingWebhookEvents.externalAccountId, link.externalAccountId),
  )
  const pending = await db.select().from(pendingWebhookEvents).where(where)
  if (pending.length === 0) return

  for (const p of pending) {
    try {
      await logWebhookPlay(db, providers, user, p.event, p.watchedAt, p.source)
    } catch (err) {
      console.error(`Failed to replay pending webhook event ${p.id} on link:`, err)
    }
  }
  await db.delete(pendingWebhookEvents).where(where)
}
