import type { Database } from '@rwnd/db'
import type {
  BackupDiff,
  BackupDroppedShow,
  BackupFile,
  BackupMovie,
  BackupRating,
  BackupShow,
  BackupWatch,
  BackupWatchlistItem,
  ExternalRef,
} from '@rwnd/shared'
import type { MetadataProvider } from '../providers/types.js'
import { buildBackupFile } from './build.js'

/** Multiset difference between two entry lists, keyed by `keyOf` — not a
 * plain Set difference, since a genuine duplicate (e.g. two watch-history
 * rows with identical movie/watchedAt/source down to the second, which a
 * bulk import could produce) must count as two entries on each side, not
 * collapse to one. Returns the surviving entries themselves (not just
 * counts), so a caller can describe what actually changed, not just how
 * many did — `added.length`/`removed.length` reproduce the old count-only
 * behavior exactly. */
export function multisetDiff<T>(
  currentEntries: T[],
  backupEntries: T[],
  keyOf: (entry: T) => string,
): { added: T[]; removed: T[] } {
  // A queue per key, not a count, so the entry that eventually survives
  // (the "removed" ones) is still the real object, not just a tally.
  const backupRemaining = new Map<string, T[]>()
  for (const entry of backupEntries) {
    const key = keyOf(entry)
    const queue = backupRemaining.get(key)
    if (queue) queue.push(entry)
    else backupRemaining.set(key, [entry])
  }

  const added: T[] = []
  for (const entry of currentEntries) {
    const queue = backupRemaining.get(keyOf(entry))
    if (queue && queue.length > 0) queue.shift()
    else added.push(entry)
  }

  const removed: T[] = []
  for (const queue of backupRemaining.values()) removed.push(...queue)

  return { added, removed }
}

/** Finds a movie/show by provider-tagged ref within a backup file's own
 * `movies`/`shows` arrays. Never misses in practice: `buildBackupFile`
 * only ever pushes a ref into a watch/rating/watchlist/dropped-show entry
 * alongside pushing the matching row into `movies`/`shows`, and the same
 * holds for whatever's already in a loaded backup file — but returns
 * `undefined` rather than throwing, since a diff line is diagnostic text,
 * not something worth failing the whole response over. */
function findByRef<T extends { ref: ExternalRef }>(list: T[], ref: ExternalRef): T | undefined {
  return list.find(
    (item) => item.ref.source === ref.source && item.ref.externalId === ref.externalId,
  )
}

/** "S01E01" — zero-padded, matching how every other season/episode label
 * in this app is written. */
function episodeLabel(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

/** The movie/show(+episode) title a watch/rating/watchlist entry points
 * at, resolved against `file`'s own `movies`/`shows` (the `current`
 * snapshot's arrays for an added entry, the loaded backup's for a removed
 * one — each side resolves against itself). Falls back to a plain label
 * when a ref can't be found (see findByRef's doc comment for why that's a
 * defensive fallback, not an expected path). */
function describeMediaRef(
  file: BackupFile,
  ref: { movie?: ExternalRef; show?: ExternalRef; season?: number; episode?: number },
): string {
  if (ref.movie) {
    const movie = findByRef<BackupMovie>(file.movies, ref.movie)
    if (!movie) return 'Unknown movie'
    return movie.year ? `${movie.title} (${movie.year})` : movie.title
  }

  const show = findByRef<BackupShow>(file.shows, ref.show!)
  if (!show) return 'Unknown show'
  if (ref.season === undefined) return show.title

  const label = episodeLabel(ref.season, ref.episode!)
  const episodeTitle = show.episodes.find(
    (e) => e.seasonNumber === ref.season && e.episodeNumber === ref.episode,
  )?.title
  return episodeTitle ? `${show.title} ${label}: ${episodeTitle}` : `${show.title} ${label}`
}

/** `2026-01-05`, the local convention (see database-backup.ts's UTC-day-key
 * usage elsewhere) for a compact, locale-independent date in
 * server-generated diagnostic text — this is API response content, not
 * translated UI chrome, so it isn't run through i18n date formatting. */
function shortDate(isoDatetime: string): string {
  return isoDatetime.slice(0, 10)
}

function describeWatch(file: BackupFile, entry: BackupWatch): string {
  return `${describeMediaRef(file, entry)} · watched ${shortDate(entry.watchedAt)}`
}

function describeRating(file: BackupFile, entry: BackupRating): string {
  return `${describeMediaRef(file, entry)} · rated ${entry.rating}`
}

function describeWatchlistItem(file: BackupFile, entry: BackupWatchlistItem): string {
  return `${describeMediaRef(file, entry)} · ${entry.list}`
}

function describeDroppedShow(file: BackupFile, entry: BackupDroppedShow): string {
  const show = findByRef<BackupShow>(file.shows, entry.show)
  const title = show?.title ?? 'Unknown show'
  const reasons = [entry.traktDropped && 'Trakt', entry.manualDropped && 'manual'].filter(Boolean)
  return reasons.length > 0 ? `${title} (${reasons.join(', ')})` : title
}

/** Counts entries added/removed per category between a backup file and the
 * database's current state, by snapshotting the current state through the
 * same `buildBackupFile()` used to write a backup and diffing the two
 * arrays. Entries are compared by their full JSON shape (provider-tagged
 * refs, same as the backup format itself — see backups.ts's schema doc
 * comment) rather than any local row id, since a changed rating/note is
 * naturally "the old entry removed, the new one added" under this model,
 * not a third "changed" bucket the UI doesn't ask for. Uses today's
 * provider priority to build the "current" snapshot regardless of which
 * provider `backup` itself was keyed by — an entry that only changed which
 * provider it's tagged with (e.g. a priority reorder) reads as "removed,
 * then added", same as any other ref change.
 *
 * Each surviving entry also gets a one-line description (`addedTitles`/
 * `removedTitles`) for the Diff dialog's "what changed" section — an added
 * entry is described against the `current` snapshot's own movies/shows,
 * a removed one against `backup`'s. */
export async function computeBackupDiff(
  db: Database,
  userId: string,
  backup: BackupFile,
  providers: MetadataProvider[],
): Promise<BackupDiff> {
  const current = await buildBackupFile(db, userId, '', new Date(), providers)
  const stringify = <T>(entry: T) => JSON.stringify(entry)

  const watchHistory = multisetDiff(current.watchHistory, backup.watchHistory, stringify)
  const ratings = multisetDiff(current.ratings, backup.ratings, stringify)
  const watchlist = multisetDiff(current.watchlist, backup.watchlist, stringify)
  const droppedShows = multisetDiff(current.droppedShows, backup.droppedShows, stringify)

  return {
    watchHistory: {
      added: watchHistory.added.length,
      removed: watchHistory.removed.length,
      addedTitles: watchHistory.added.map((entry) => describeWatch(current, entry)),
      removedTitles: watchHistory.removed.map((entry) => describeWatch(backup, entry)),
    },
    ratings: {
      added: ratings.added.length,
      removed: ratings.removed.length,
      addedTitles: ratings.added.map((entry) => describeRating(current, entry)),
      removedTitles: ratings.removed.map((entry) => describeRating(backup, entry)),
    },
    watchlist: {
      added: watchlist.added.length,
      removed: watchlist.removed.length,
      addedTitles: watchlist.added.map((entry) => describeWatchlistItem(current, entry)),
      removedTitles: watchlist.removed.map((entry) => describeWatchlistItem(backup, entry)),
    },
    droppedShows: {
      added: droppedShows.added.length,
      removed: droppedShows.removed.length,
      addedTitles: droppedShows.added.map((entry) => describeDroppedShow(current, entry)),
      removedTitles: droppedShows.removed.map((entry) => describeDroppedShow(backup, entry)),
    },
  }
}
