import type { ExternalIdBundle } from '../lib/external-match.js'
import type { IncomingWatchEvent } from './types.js'
import { asBoolean, asNumber, asString } from './coerce.js'

interface EmbyItem {
  Type?: unknown
  Id?: unknown
  SeriesName?: unknown
  ParentIndexNumber?: unknown
  IndexNumber?: unknown
  ProviderIds?: unknown
}

interface EmbyUser {
  Id?: unknown
  Name?: unknown
}

interface EmbyPlaybackInfo {
  PlayedToCompletion?: unknown
}

interface EmbyPayload {
  Event?: unknown
  User?: unknown
  Item?: unknown
  PlaybackInfo?: unknown
}

/** Emby's `Item.ProviderIds` key casing is genuinely inconsistent between
 * content types — live-verified 2026-09-11 against a real Emby 4.10.0.40
 * server: a movie produced `{"Tmdb":"...","Imdb":"...","Tvdb":"..."}`
 * (capitalized-first), an episode of the same request produced
 * `{"Tvdb":"...","EIDR":"...","IMDB":"...","Official Website":"..."}`
 * (all-caps `IMDB`, no `Tmdb` at all, plus unrelated keys to ignore).
 * Lowercasing every key before matching is load-bearing, not defensive
 * caution. */
function parseProviderIds(raw: unknown): ExternalIdBundle {
  const ids: ExternalIdBundle = {}
  if (typeof raw !== 'object' || raw === null) return ids
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = asString(value)
    if (!id) continue
    switch (key.toLowerCase()) {
      case 'tmdb':
        ids.tmdb = id
        break
      case 'tvdb':
        ids.tvdb = id
        break
      case 'imdb':
        ids.imdb = id
        break
    }
  }
  return ids
}

/**
 * Parses one delivery from Emby's built-in "Webhooks" notification agent
 * (Settings → Notifications, not Premiere-gated — found live-testing this
 * 2026-09-11 against a real Emby 4.10.0.40 server) into a source-agnostic
 * `IncomingWatchEvent`, or null when there's nothing to act on.
 *
 * The transport is `multipart/form-data` with a single part named `data`
 * holding the JSON body, *regardless* of the notification's own "Request
 * content type" dropdown — selecting "application/json" did not change
 * the wire format in live testing (confirmed via a real capture, not
 * assumed). The route (`apps/api/src/routes/webhooks.ts`) reads this the
 * same way it reads Plex's multipart `payload` field, just under Emby's
 * own field name.
 *
 * Loggable event: `Event === 'playback.stop'` with
 * `PlaybackInfo.PlayedToCompletion` true — confirmed both fields and that
 * nesting live. `system.webhooktest` (the plugin's own test button) has
 * a smaller, different shape with no `Item`/`PlaybackInfo` at all — it
 * simply falls through the `Item`/`User` checks below and returns null,
 * which is the correct behavior (200, nothing logged) and doubles as the
 * self-hoster's confirmation the URL works.
 *
 * `Item.Type` maps directly to this app's own two media kinds ('Movie' /
 * 'Episode'); anything else returns null. Ids come from
 * `Item.ProviderIds` — see `parseProviderIds`'s doc comment for why every
 * key is lowercased before matching.
 */
export function parseEmbyPayload(payload: unknown): IncomingWatchEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as EmbyPayload
  if (asString(body.Event) !== 'playback.stop') return null

  const playbackInfo = body.PlaybackInfo
  const playedToCompletion =
    typeof playbackInfo === 'object' && playbackInfo !== null
      ? asBoolean((playbackInfo as EmbyPlaybackInfo).PlayedToCompletion)
      : undefined
  if (playedToCompletion === undefined) {
    // A genuine shape mismatch (not just "stopped early," which is
    // `false`, not absent) — worth a diagnostic naming only the top-level
    // keys actually seen, never values, so a self-hoster's report of
    // "watches aren't logging" is debuggable from container logs alone.
    console.error(
      'emby webhook: playback.stop with no PlaybackInfo.PlayedToCompletion field — top-level keys:',
      Object.keys(body),
    )
    return null
  }
  if (!playedToCompletion) return null

  if (typeof body.User !== 'object' || body.User === null) return null
  const user = body.User as EmbyUser
  const userId = asString(user.Id)
  const userName = asString(user.Name)
  if (!userId || !userName) return null

  if (typeof body.Item !== 'object' || body.Item === null) return null
  const item = body.Item as EmbyItem

  const ratingKey = asString(item.Id)
  if (!ratingKey) return null

  const ids = parseProviderIds(item.ProviderIds)
  if (!ids.tmdb && !ids.tvdb && !ids.imdb) return null

  const account = { externalId: userId, name: userName }
  const itemType = asString(item.Type)

  if (itemType === 'Movie') {
    return { ids, ratingKey, account, media: { type: 'movie' } }
  }

  if (itemType === 'Episode') {
    const showTitle = asString(item.SeriesName)
    const seasonNumber = asNumber(item.ParentIndexNumber)
    const episodeNumber = asNumber(item.IndexNumber)
    if (!showTitle || seasonNumber === undefined || episodeNumber === undefined) {
      return null
    }
    return {
      ids,
      ratingKey,
      account,
      media: { type: 'episode', showTitle, seasonNumber, episodeNumber },
    }
  }

  return null
}
