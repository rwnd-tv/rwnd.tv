import type { ExternalIdBundle } from '../lib/external-match.js'
import type { IncomingWatchEvent } from './types.js'
import { asBoolean, asNumber, asString } from './coerce.js'

interface JellyfinPayload {
  NotificationType?: unknown
  ItemType?: unknown
  ItemId?: unknown
  Name?: unknown
  SeriesName?: unknown
  SeasonNumber?: unknown
  EpisodeNumber?: unknown
  PlayedToCompletion?: unknown
  UserId?: unknown
  NotificationUsername?: unknown
  Provider_tmdb?: unknown
  Provider_tvdb?: unknown
  Provider_imdb?: unknown
}

function parseProviderIds(body: JellyfinPayload): ExternalIdBundle {
  const ids: ExternalIdBundle = {}
  const tmdb = asString(body.Provider_tmdb)
  const tvdb = asString(body.Provider_tvdb)
  const imdb = asString(body.Provider_imdb)
  if (tmdb) ids.tmdb = tmdb
  if (tvdb) ids.tvdb = tvdb
  if (imdb) ids.imdb = imdb
  return ids
}

/**
 * Parses one delivery from the `jellyfin-plugin-webhook` plugin's Generic
 * destination into a source-agnostic `IncomingWatchEvent`, or null when
 * there's nothing to act on. Verified against a real Jellyfin 12.0.0
 * server (2026-09-11) with the destination's own "Send All Properties
 * (ignores template)" option enabled — that option posts the plugin's
 * full native-typed data object as JSON with no template involved, which
 * is what this parser is built against and what `docs/self-hosting.md`
 * recommends as the primary setup path.
 *
 * If a self-hoster's plugin version lacks that option, the fallback is a
 * hand-written Handlebars template producing the same field names as
 * plain strings (see `docs/self-hosting.md`'s Jellyfin section for the
 * exact template) — quoting every value deliberately, since an unquoted
 * missing variable renders as an empty string (invalid JSON) and an
 * unquoted `.NET` bool renders as `True`/`False` (also invalid JSON).
 * `asString`/`asNumber`/`asBoolean` (`./coerce.ts`) tolerate either shape.
 *
 * Loggable event: `NotificationType === 'PlaybackStop'` with
 * `PlayedToCompletion` true — the direct analogue of Plex's
 * `media.scrobble`, letting the server's own resume/played threshold
 * decide "watched" rather than rwnd.tv second-guessing it. Confirmed live
 * that `PlaybackStop` fires with `PlayedToCompletion: false` on an early
 * stop and `true` at natural end of playback.
 *
 * `ItemType` maps directly to this app's own two media kinds ('Movie' /
 * 'Episode'); anything else (Series, Season, Audio, ...) returns null.
 * Ids come from `Provider_tmdb`/`Provider_tvdb`/`Provider_imdb` — present
 * only for whichever providers are actually configured on that Jellyfin
 * instance (a movie may carry only `Provider_tmdb`+`Provider_imdb`, a
 * show only `Provider_tvdb`+`Provider_imdb`, confirmed live), so null is
 * only returned when none of the three are present at all.
 */
export function parseJellyfinPayload(payload: unknown): IncomingWatchEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as JellyfinPayload

  if (asString(body.NotificationType) !== 'PlaybackStop') return null
  if (asBoolean(body.PlayedToCompletion) !== true) return null

  const userId = asString(body.UserId)
  const userName = asString(body.NotificationUsername)
  if (!userId || !userName) return null

  const ratingKey = asString(body.ItemId)
  if (!ratingKey) return null

  const ids = parseProviderIds(body)
  if (!ids.tmdb && !ids.tvdb && !ids.imdb) return null

  const account = { externalId: userId, name: userName }
  const itemType = asString(body.ItemType)

  if (itemType === 'Movie') {
    return { ids, ratingKey, account, media: { type: 'movie' } }
  }

  if (itemType === 'Episode') {
    const showTitle = asString(body.SeriesName)
    const seasonNumber = asNumber(body.SeasonNumber)
    const episodeNumber = asNumber(body.EpisodeNumber)
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
