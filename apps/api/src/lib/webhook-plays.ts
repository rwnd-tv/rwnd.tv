import { plays } from '@rwnd/db'
import type { Database } from '@rwnd/db'
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
 * (`apps/api/src/routes/tokens.ts`'s webhook-link claim route) needs the
 * same key it would have gotten had the account already been claimed
 * when it first arrived, not one keyed off whenever the claim happens
 * to occur. */
function dailySourceRef(ratingKey: string, date: Date): string {
  return `${ratingKey}:${date.toISOString().slice(0, 10)}`
}

/**
 * Resolves one webhook event's movie/episode and logs it as a play for
 * `user` — the one piece of logic shared identically by a live webhook
 * delivery (`apps/api/src/routes/webhooks.ts`) and a retroactive replay
 * once a previously-unclaimed account gets linked
 * (`apps/api/src/routes/tokens.ts`'s webhook-link claim route), so the
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
