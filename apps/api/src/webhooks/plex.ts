import type { ExternalIdBundle } from '../lib/external-match.js'
import type { IncomingWatchEvent } from './types.js'

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
