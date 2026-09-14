import type { ExternalIdBundle } from '../lib/external-match.js'
import type { IncomingWatchEvent } from './types.js'
import { asNumber, asString } from './coerce.js'

interface TautulliPayload {
  action?: unknown
  media_type?: unknown
  show_name?: unknown
  season_num?: unknown
  episode_num?: unknown
  imdb_id?: unknown
  themoviedb_id?: unknown
  thetvdb_id?: unknown
  rating_key?: unknown
  user_id?: unknown
  user?: unknown
  username?: unknown
  server_machine_id?: unknown
}

/** Tautulli's own `{token}` substitution never fails outright: an unknown
 * token name, or one that isn't populated for the current trigger/media
 * type, renders as the literal text `{token_name}` (confirmed against
 * Tautulli's own source, `CustomFormatter(default='{{{0}}}')`) — whereas
 * a *recognized* token with genuinely nothing to substitute (e.g.
 * `{show_name}` on a movie) comes back as `""`, which `asString` already
 * treats as absent. Only the literal-token case needs stripping here;
 * `""` needs no special handling. Deliberately an *exact* match against
 * this one token's own literal form, not a broader "looks like `{...}`"
 * pattern — a genuinely typo'd token name (which Tautulli also renders
 * literally, just spelled differently) falls through unstripped, so it
 * stays visible in the diagnostics below instead of being silently
 * swallowed as if it were just unavailable. */
function stripUnsubstituted(value: string | undefined, token: string): string | undefined {
  return value === `{${token}}` ? undefined : value
}

function parseIds(body: TautulliPayload): ExternalIdBundle {
  const ids: ExternalIdBundle = {}
  const tmdb = stripUnsubstituted(asString(body.themoviedb_id), 'themoviedb_id')
  const tvdb = stripUnsubstituted(asString(body.thetvdb_id), 'thetvdb_id')
  const imdb = stripUnsubstituted(asString(body.imdb_id), 'imdb_id')
  if (tmdb) ids.tmdb = tmdb
  if (tvdb) ids.tvdb = tvdb
  if (imdb) ids.imdb = imdb
  return ids
}

/**
 * Parses one delivery from a Tautulli "Webhook" notification agent
 * configured with the JSON template documented in `docs/self-hosting.md`'s
 * Tautulli section, into a source-agnostic `IncomingWatchEvent`, or null
 * when there's nothing to act on.
 *
 * Unlike Plex/Jellyfin/Emby, Tautulli's webhook body has no fixed shape at
 * all — the self-hoster pastes a JSON template with `{token}`
 * substitutions, so this parser is only as good as the documented
 * template actually configured. Verified against real deliveries captured
 * from a throwaway Tautulli instance pointed read-only at a real Plex
 * server, 2026-09-14 (see `docs/TODO_ARCHIVE.md`): a movie and a TV
 * episode, each played past a (temporarily lowered, for the capture)
 * watched threshold.
 *
 * Loggable event: `action === 'watched'` — Tautulli's own "Watched"
 * notification trigger, which fires once per session, at whichever comes
 * first between the configured watched-percentage threshold or a credits
 * marker (Settings → General → Monitoring). Deliberately not an
 * `on_stop`-style completion signal the way Plex/Jellyfin/Emby use:
 * Tautulli's own advanced "Allow Playback Stop Notifications Exceeding
 * Watched Percent" setting can silently suppress a stop notification for
 * exactly the completed plays this cares about, while "Watched" has no
 * such trap. `docs/self-hosting.md` tells the self-hoster to enable only
 * this one trigger.
 *
 * Every value in the documented template arrives as a JSON *string* —
 * Tautulli parses the template as JSON, substitutes into each string
 * leaf, then re-serializes, so the template has to quote every token to
 * stay valid JSON (see `coerce.ts`, written for this exact problem on the
 * Jellyfin side first). `season_num`/`episode_num` go through `asNumber`
 * for that reason, and `0` (a real TV special) is a valid result —
 * checked against `undefined`, never falsiness.
 */
export function parseTautulliPayload(payload: unknown): IncomingWatchEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as TautulliPayload

  const action = stripUnsubstituted(asString(body.action), 'action')
  if (action !== 'watched') {
    // A user's own trigger/body mismatch (e.g. the template pasted into
    // "Playback Start" instead of "Watched") is otherwise a completely
    // silent no-op — worth naming the action actually seen, since it's a
    // small fixed vocabulary (play/stop/pause/resume/watched/...), not
    // user-supplied free text.
    if (action !== undefined) {
      console.error(`tautulli webhook: ignoring event with action "${action}"`)
    }
    return null
  }

  const userId = stripUnsubstituted(asString(body.user_id), 'user_id')
  // `{user}` is Tautulli's friendly-name token and can be genuinely blank
  // (asString already treats "" as absent) — `{username}` as a fallback
  // so a self-hoster who hasn't set a friendly name still gets an
  // identifiable name in Settings' "Detected accounts" list.
  const userName =
    stripUnsubstituted(asString(body.user), 'user') ??
    stripUnsubstituted(asString(body.username), 'username')
  if (!userId || !userName) return null

  const ratingKey = stripUnsubstituted(asString(body.rating_key), 'rating_key')
  if (!ratingKey) return null

  const serverId = stripUnsubstituted(asString(body.server_machine_id), 'server_machine_id') ?? null

  const ids = parseIds(body)
  if (!ids.tmdb && !ids.tvdb && !ids.imdb) {
    // The expected out-of-box state, not an anomaly: Tautulli's own
    // TMDB/TVmaze lookups are off by default, and a modern Plex agent's
    // GUID doesn't always carry an external id on its own — see
    // docs/self-hosting.md's Tautulli section for the settings that fix
    // this. Otherwise a completely silent drop.
    console.error('tautulli webhook: watched event with no usable external ids')
    return null
  }

  const account = { externalId: userId, name: userName }
  const mediaType = stripUnsubstituted(asString(body.media_type), 'media_type')

  if (mediaType === 'movie') {
    return { ids, ratingKey, serverId, account, media: { type: 'movie' } }
  }

  if (mediaType === 'episode') {
    const showTitle = stripUnsubstituted(asString(body.show_name), 'show_name')
    const seasonNumber = asNumber(stripUnsubstituted(asString(body.season_num), 'season_num'))
    const episodeNumber = asNumber(stripUnsubstituted(asString(body.episode_num), 'episode_num'))
    if (!showTitle || seasonNumber === undefined || episodeNumber === undefined) {
      console.error('tautulli webhook: episode watched event missing season/episode numbers', {
        season_num: body.season_num,
        episode_num: body.episode_num,
      })
      return null
    }
    return {
      ids,
      ratingKey,
      serverId,
      account,
      media: { type: 'episode', showTitle, seasonNumber, episodeNumber },
    }
  }

  return null
}
