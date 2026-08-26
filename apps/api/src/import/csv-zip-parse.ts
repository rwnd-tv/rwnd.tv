import { strFromU8, unzipSync } from 'fflate'
import { parseCsv, rowsToObjects } from '../lib/csv.js'

/**
 * Parses rwnd.tv's own data export ZIP (Settings > Database > Export data —
 * apps/api/src/export/build.ts) back into row objects, for the round-trip
 * CSV import path (apps/api/src/import/csv.ts). Filenames and required
 * columns match build.ts's own output exactly — this is deliberately not a
 * general-purpose "any CSV" importer, it only reads rwnd.tv's own format
 * back.
 */

export class CsvZipParseError extends Error {}

const FILES = {
  history: 'history.csv',
  ratings: 'ratings.csv',
  watchlist: 'watchlist.csv',
  dropped: 'dropped-shows.csv',
} as const

/** Just enough of each file's header to confirm it's the right shape —
 * doesn't require every provider-id column (`tmdb_id`/`tvdb_id`/…), since
 * those are read by name (see rowsToObjects) and a row simply won't have
 * one if the exporting instance had no configured provider for it. */
const REQUIRED_HEADERS: Record<keyof typeof FILES, string[]> = {
  history: ['type', 'title', 'watched_at'],
  ratings: ['type', 'title', 'rating', 'rated_at'],
  watchlist: ['type', 'title', 'listed_at'],
  dropped: ['show_title', 'dropped_at'],
}

export interface ParsedCsvZip {
  history: Record<string, string>[]
  ratings: Record<string, string>[]
  watchlist: Record<string, string>[]
  dropped: Record<string, string>[]
}

function readCsvEntry(
  entries: Record<string, Uint8Array>,
  name: string,
  requiredHeaders: string[],
): Record<string, string>[] {
  const bytes = entries[name]
  if (!bytes) {
    throw new CsvZipParseError(`Missing ${name} — this doesn't look like an rwnd.tv data export`)
  }
  const rows = parseCsv(strFromU8(bytes))
  const header = rows[0]
  if (!header || requiredHeaders.some((column) => !header.includes(column))) {
    throw new CsvZipParseError(`${name} doesn't look like an rwnd.tv data export`)
  }
  return rowsToObjects(rows)
}

export function parseCsvZip(buffer: Uint8Array): ParsedCsvZip {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buffer)
  } catch {
    throw new CsvZipParseError('Not a valid ZIP file')
  }

  return {
    history: readCsvEntry(entries, FILES.history, REQUIRED_HEADERS.history),
    ratings: readCsvEntry(entries, FILES.ratings, REQUIRED_HEADERS.ratings),
    watchlist: readCsvEntry(entries, FILES.watchlist, REQUIRED_HEADERS.watchlist),
    dropped: readCsvEntry(entries, FILES.dropped, REQUIRED_HEADERS.dropped),
  }
}
