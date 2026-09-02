import { and, eq } from 'drizzle-orm'
import { pendingWebhookEvents, plays } from '@rwnd/db'
import type { Database, webhookAccountLinks } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import type { UserRecord } from '../types.js'
import type { WatchEvent } from '../webhooks/plex.js'
import {
  resolveEpisodeSoft,
  resolveMovieFromExternalIds,
  resolveShowFromExternalIds,
} from './external-match.js'
import { hasCrossSourceDuplicate } from './plays.js'

/** `${ratingKey}:${date}` — Plex hands over no stable per-delivery event
 * id, so this is a deliberate, imperfect compromise: it collapses
 * same-day webhook retries (the real risk — Plex re-sending because the
 * first attempt didn't get a fast 2xx) while still letting a genuine
 * rewatch the next day log again. A true same-day rewatch would be
 * missed by this, a low-stakes edge case next to the alternative of
 * unbounded duplicate plays from retries. `date` is the event's own
 * `watchedAt`, not necessarily "today" — a retroactively-replayed event
 * (`apps/api/src/routes/tokens.ts`'s webhook-link link route) needs the
 * same key it would have gotten had the account already been linked
 * when it first arrived, not one keyed off whenever the link happens
 * to occur. */
function dailySourceRef(ratingKey: string, date: Date): string {
  return `${ratingKey}:${date.toISOString().slice(0, 10)}`
}

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
 * activity log for that case.
 */
export async function logWebhookPlay(
  db: Database,
  providers: MetadataProvider[],
  user: UserRecord,
  event: WatchEvent,
  watchedAt: Date,
): Promise<void> {
  const sourceRef = dailySourceRef(event.ratingKey, watchedAt)

  if (event.media.type === 'movie') {
    const movie = await resolveMovieFromExternalIds(db, providers, event.ids, user.locale)
    if (!movie) {
      console.error(`Plex webhook: no configured provider matched a movie`, event.ids)
      return
    }
    if (await hasCrossSourceDuplicate(db, user.id, { movieId: movie.id }, watchedAt, 'plex')) {
      return
    }
    await db
      .insert(plays)
      .values({ userId: user.id, movieId: movie.id, watchedAt, source: 'plex', sourceRef })
      .onConflictDoNothing()
    return
  }

  const show = await resolveShowFromExternalIds(db, providers, event.ids, user.locale)
  if (!show) {
    console.error(
      `Plex webhook: no configured provider matched show "${event.media.showTitle}"`,
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
      `Plex webhook: "${show.title}" S${event.media.seasonNumber}E${event.media.episodeNumber} not found via ${show.provider.source.toUpperCase()}`,
    )
    return
  }
  if (await hasCrossSourceDuplicate(db, user.id, { episodeId: episode.id }, watchedAt, 'plex')) {
    return
  }
  await db
    .insert(plays)
    .values({ userId: user.id, episodeId: episode.id, watchedAt, source: 'plex', sourceRef })
    .onConflictDoNothing()
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
      await logWebhookPlay(db, providers, user, p.event, p.watchedAt)
    } catch (err) {
      console.error(`Failed to replay pending webhook event ${p.id} on link:`, err)
    }
  }
  await db.delete(pendingWebhookEvents).where(where)
}
