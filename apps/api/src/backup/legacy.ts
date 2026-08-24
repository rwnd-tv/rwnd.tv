import { BACKUP_FORMAT_VERSION, type BackupFile, type BackupFileV1, type ExternalRef } from '@rwnd/shared'

/**
 * Up-converts a BACKUP_FORMAT_VERSION 1 file (bare TMDB-id strings) into the
 * current shape (provider-tagged `externalRefSchema` refs) — see
 * packages/shared/src/schemas/backups.ts's `externalRefSchema` doc comment
 * for why a bare id alone isn't safe to keep accepting. Safe to do
 * unconditionally: a v1 file could only ever have been written when TMDB
 * was the sole provider build.ts knew how to key entries by, so every id in
 * it is unambiguously a TMDB id.
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
    })),
    droppedShows: file.droppedShows.map((entry) => ({ ...entry, show: ref(entry.show) })),
  }
}
