import type { ExternalIdBundle } from '../lib/external-match.js'

/** Everything needed to resolve and log a play, once it's known *who*
 * it belongs to — deliberately without `account` (split out onto
 * `IncomingWatchEvent` below), since this is also the shape stored in
 * `pending_webhook_events` for later replay (`packages/db/src/schema.ts`)
 * and `apps/api/src/lib/webhook-plays.ts`'s `logWebhookPlay` — neither
 * of those needs or has an opinion about which rwnd.tv user it is. */
// A flat object with a union-typed `media` (rather than an intersection
// of the shared fields with a media-shape union) deliberately — the two
// forms are semantically equivalent, but only this one structurally
// matches `pending_webhook_events.event`'s own `.$type<...>()` in
// `packages/db/src/schema.ts` closely enough for TypeScript to accept a
// stored/replayed event back through `logWebhookPlay` without a cast.
export type WatchEvent = {
  ids: ExternalIdBundle
  /** Plex's own per-media-item id on this server — stable for a given
   * item, but Plex-local (not a cross-server/cross-instance identifier,
   * unlike `ids`). Only used to build a best-effort idempotency key for
   * the play this event logs — see `apps/api/src/lib/webhook-plays.ts`. */
  ratingKey: string
  media:
    | { type: 'movie' }
    | { type: 'episode'; showTitle: string; seasonNumber: number; episodeNumber: number }
}

export type IncomingWatchEvent = WatchEvent & {
  /** Which Plex user actually watched this — a webhook is server-wide
   * (fires for every user's playback, not just whoever registered it),
   * so this is what tells apart a multi-user server's watches. `id` is
   * Plex's real global account id — *not* reliably `1` for the server
   * owner despite Plex's own docs claiming so (live-verified
   * 2026-08-24 against a real payload) — so every account, owner
   * included, needs an explicit claim. See
   * `apps/api/src/lib/webhook-accounts.ts`. */
  account: { externalId: string; name: string }
}

/** One entry of Plex's `Metadata.Guid` array — `{ id: "tmdb://603" }`,
 * `{ id: "tvdb://81189" }`, `{ id: "imdb://tt0468569" }`. Only present on
 * newer Plex agents; older ones may omit it entirely, in which case
 * `parseGuids` below returns an empty bundle and the caller reports the
 * event unmatched rather than guessing. */
interface PlexGuid {
  id?: unknown
}

interface PlexMetadata {
  type?: unknown
  title?: unknown
  ratingKey?: unknown
  grandparentTitle?: unknown
  parentIndex?: unknown
  index?: unknown
  Guid?: unknown
}

interface PlexAccount {
  id?: unknown
  title?: unknown
}

interface PlexPayload {
  event?: unknown
  Metadata?: unknown
  Account?: unknown
}

function parseAccount(account: unknown): { externalId: string; name: string } | null {
  if (typeof account !== 'object' || account === null) return null
  const acc = account as PlexAccount
  if (typeof acc.id !== 'string' && typeof acc.id !== 'number') return null
  if (typeof acc.title !== 'string') return null
  return { externalId: String(acc.id), name: acc.title }
}

function parseGuids(guids: unknown): ExternalIdBundle {
  const ids: ExternalIdBundle = {}
  if (!Array.isArray(guids)) return ids
  for (const entry of guids as PlexGuid[]) {
    const id = entry?.id
    if (typeof id !== 'string') continue
    const [scheme, value] = id.split('://')
    if (!value) continue
    if (scheme === 'tmdb') ids.tmdb = value
    else if (scheme === 'tvdb') ids.tvdb = value
    else if (scheme === 'imdb') ids.imdb = value
  }
  return ids
}

/**
 * Parses one Plex webhook delivery's JSON payload (already extracted from
 * the surrounding `multipart/form-data` request by the route — see
 * `apps/api/src/routes/webhooks.ts`) into a source-agnostic
 * `IncomingWatchEvent`, or null when there's nothing to act on: any event
 * other than `media.scrobble` (Plex's own definition of "counts as
 * watched," per its own configurable watched-percentage setting — not
 * something rwnd.tv controls or second-guesses), or a scrobble with no
 * usable external ids at all (an older Plex agent that never populated
 * `Guid`).
 *
 * `Guid` is read at the top level of `Metadata` for both movies and
 * episodes — Plex's docs don't precisely say whether an episode's own
 * `Guid` entries (when present) differ from its show's, so this doesn't
 * try to distinguish "episode id" from "show id": both would resolve to
 * the same show via `resolveShowFromExternalIds`, and the episode itself
 * is always addressed by season/episode number
 * (`parentIndex`/`index`) against that show, never by its own id.
 *
 * `Account` (who was watching — see `IncomingWatchEvent.account`'s doc
 * comment) is read as a top-level sibling of `Metadata`, not nested
 * inside it. A payload missing it entirely (or shaped unexpectedly) is
 * treated the same as any other unparseable event — null, not a guess.
 */
export function parsePlexPayload(payload: unknown): IncomingWatchEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as PlexPayload
  if (body.event !== 'media.scrobble') return null

  const account = parseAccount(body.Account)
  if (!account) return null

  const metadata = body.Metadata
  if (typeof metadata !== 'object' || metadata === null) return null
  const meta = metadata as PlexMetadata

  const ids = parseGuids(meta.Guid)
  if (!ids.tmdb && !ids.tvdb && !ids.imdb) return null

  const ratingKey = meta.ratingKey
  if (typeof ratingKey !== 'string' && typeof ratingKey !== 'number') return null

  if (meta.type === 'movie') {
    return { ids, ratingKey: String(ratingKey), account, media: { type: 'movie' } }
  }

  if (meta.type === 'episode') {
    const showTitle = meta.grandparentTitle
    const seasonNumber = meta.parentIndex
    const episodeNumber = meta.index
    if (
      typeof showTitle !== 'string' ||
      typeof seasonNumber !== 'number' ||
      typeof episodeNumber !== 'number'
    ) {
      return null
    }
    return {
      ids,
      ratingKey: String(ratingKey),
      account,
      media: { type: 'episode', showTitle, seasonNumber, episodeNumber },
    }
  }

  return null
}
