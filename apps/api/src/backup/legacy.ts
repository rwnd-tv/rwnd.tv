import {
  BACKUP_FORMAT_VERSION,
  type BackupFile,
  type BackupFileV1,
  type BackupFileV2,
  type ExternalRef,
} from '@rwnd/shared'

/**
 * Up-converts a BACKUP_FORMAT_VERSION 1 file (bare TMDB-id strings, no named
 * watchlists) directly into the current shape — see
 * packages/shared/src/schemas/backups.ts's `externalRefSchema` doc comment
 * for why 1 -> 2 specifically is safe to do unconditionally (every v1 file
 * was necessarily written when TMDB was the only provider), and
 * `backupWatchlistItemSchema.list`'s doc comment for why every v1 entry
 * unambiguously belongs on "Default" (named watchlists didn't exist yet).
 */
export function migrateLegacyBackupFile(file: BackupFileV1): BackupFile {
  const ref = (tmdbId: string): ExternalRef => ({ source: 'tmdb', externalId: tmdbId })
  const refOrUndefined = (tmdbId: string | undefined): ExternalRef | undefined =>
    tmdbId === undefined ? undefined : ref(tmdbId)

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: file.createdAt,
    description: file.description,
    counts: file.counts,
    skipped: file.skipped,
    movies: file.movies.map(({ tmdbId, ...rest }) => ({ ...rest, ref: ref(tmdbId) })),
    shows: file.shows.map(({ tmdbId, ...rest }) => ({ ...rest, ref: ref(tmdbId) })),
    watchHistory: file.watchHistory.map((entry) => ({
      ...entry,
      movie: refOrUndefined(entry.movie),
      show: refOrUndefined(entry.show),
    })),
    ratings: file.ratings.map((entry) => ({
      ...entry,
      movie: refOrUndefined(entry.movie),
      show: refOrUndefined(entry.show),
    })),
    watchlist: file.watchlist.map((entry) => ({
      ...entry,
      movie: refOrUndefined(entry.movie),
      show: refOrUndefined(entry.show),
      list: 'Default',
    })),
    watchlists: [],
    droppedShows: file.droppedShows.map((entry) => ({ ...entry, show: ref(entry.show) })),
  }
}

/**
 * Up-converts a BACKUP_FORMAT_VERSION 2 file (provider-tagged refs already,
 * but no named watchlists — a v2 file's `watchlist` is what v1's was, one
 * flat per-user list) into the current shape. Safe unconditionally: named
 * watchlists didn't exist when any v2 file could have been written, so
 * every entry in it unambiguously belongs on "Default" — same reasoning as
 * migrateLegacyBackupFile's v1 -> current conversion above, just without
 * also needing the tmdbId-to-ref rewrite (v2 already has that).
 */
export function migrateV2BackupFile(file: BackupFileV2): BackupFile {
  return {
    ...file,
    formatVersion: BACKUP_FORMAT_VERSION,
    watchlist: file.watchlist.map((entry) => ({ ...entry, list: 'Default' })),
    watchlists: [],
  }
}
