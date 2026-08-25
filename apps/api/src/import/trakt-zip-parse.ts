import { strFromU8, unzipSync } from 'fflate'
import type {
  TraktHiddenItem,
  TraktHistoryItem,
  TraktRatingItem,
  TraktWatchlistItem,
} from '../trakt/types.js'

/**
 * Parses a Trakt "Export now" ZIP (Settings > Data on trakt.tv — see
 * docs/TODO.md's "Build ZIP-upload import from Trakt's own 'Export now'
 * file") into the item lists apps/api/src/import/trakt.ts's shared engine
 * already knows how to process.
 *
 * Investigated 2026-08-24 against a real 11,261-item export:
 * `watched-history-*.json` shards match `TraktHistoryItem` field-for-field,
 * and `hidden-progress-watched.json` (Trakt's own name for what rwnd.tv
 * calls a "dropped" show) matches `TraktHiddenItem` the same way.
 * Ratings/watchlist were empty in that export, so weren't wired up yet —
 * confirmed 2026-08-25 against a second, populated export (real episode
 * ratings, real show watchlist entries): `ratings-{movies,shows,seasons,
 * episodes}.json` each hold a flat `TraktRatingItem[]` (the per-file split
 * is purely by `type`, not a different shape — each item still carries its
 * own `type` field, same as history/dropped), and `lists-watchlist.json`
 * holds a flat `TraktWatchlistItem[]` (plus a few harmless extra fields —
 * `rank`, `id`, `notes`, `my_rating` — not modelled here and just ignored,
 * same convention as history's extra `plex`/`aired_episodes` fields).
 */

export class TraktZipParseError extends Error {}

const HISTORY_SHARD_PATTERN = /^watched-history-(\d+)\.json$/
const DROPPED_FILE = 'hidden-progress-watched.json'
const RATINGS_FILES = [
  'ratings-movies.json',
  'ratings-shows.json',
  'ratings-seasons.json',
  'ratings-episodes.json',
]
const WATCHLIST_FILE = 'lists-watchlist.json'

export interface ParsedTraktZip {
  history: TraktHistoryItem[]
  dropped: TraktHiddenItem[]
  ratings: TraktRatingItem[]
  watchlist: TraktWatchlistItem[]
}

function readJsonEntry<T>(entries: Record<string, Uint8Array>, name: string): T {
  const bytes = entries[name]
  if (!bytes) throw new TraktZipParseError(`Missing ${name} in the export`)
  try {
    return JSON.parse(strFromU8(bytes)) as T
  } catch {
    throw new TraktZipParseError(`${name} in the export isn't valid JSON`)
  }
}

/** Reads `name` if present, or `[]` if the export doesn't have it — a
 * missing optional file (e.g. an older export format, or a category the
 * account has never used) shouldn't fail the whole import. */
function readOptionalJsonEntries<T>(entries: Record<string, Uint8Array>, name: string): T[] {
  return entries[name] ? readJsonEntry<T[]>(entries, name) : []
}

export function parseTraktZip(buffer: Uint8Array): ParsedTraktZip {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buffer)
  } catch {
    throw new TraktZipParseError('Not a valid ZIP file')
  }

  // Sharded numerically (watched-history-1.json, -2.json, ...), not
  // alphabetically — a lexical sort would put "-10.json" before "-2.json"
  // once an export has 10+ shards, silently reordering history within the
  // concatenated list (harmless for correctness — nothing here depends on
  // shard order — but worth getting right rather than relying on it not
  // mattering).
  const shards = Object.keys(entries)
    .map((name) => {
      const match = HISTORY_SHARD_PATTERN.exec(name)
      return match ? { name, index: Number(match[1]) } : null
    })
    .filter((shard): shard is { name: string; index: number } => shard !== null)
    .sort((a, b) => a.index - b.index)

  if (shards.length === 0) {
    throw new TraktZipParseError(
      'No watched-history-*.json files found — this doesn\'t look like a Trakt "Export now" ZIP',
    )
  }

  const history = shards.flatMap((shard) => readJsonEntry<TraktHistoryItem[]>(entries, shard.name))
  const dropped = readOptionalJsonEntries<TraktHiddenItem>(entries, DROPPED_FILE)
  const ratings = RATINGS_FILES.flatMap((name) =>
    readOptionalJsonEntries<TraktRatingItem>(entries, name),
  )
  const watchlist = readOptionalJsonEntries<TraktWatchlistItem>(entries, WATCHLIST_FILE)

  return { history, dropped, ratings, watchlist }
}
