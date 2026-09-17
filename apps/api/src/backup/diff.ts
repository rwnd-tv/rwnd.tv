import type { Database } from '@rwnd/db'
import type {
  BackupDiff,
  BackupDiffEntry,
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

/** The movie/show(+episode) title and episode label a watch/rating/
 * watchlist entry points at, resolved against `file`'s own `movies`/
 * `shows` (the `current` snapshot's arrays for an added entry, the loaded
 * backup's for a removed one — each side resolves against itself). `title`
 * falls back to a plain label when a ref can't be found (see findByRef's
 * doc comment for why that's a defensive fallback, not an expected path).
 * `episode` is deliberately just "S01E01", not the episode's own title too
 * - there's little room for it in this dialog, and the season/episode
 * number alone is enough to identify which one. Kept separate from `title`
 * (rather than one combined string) so the frontend can truncate a long
 * title with an ellipsis while the episode number - the part that actually
 * disambiguates - always stays visible. */
function mediaRefParts(
  file: BackupFile,
  ref: { movie?: ExternalRef; show?: ExternalRef; season?: number; episode?: number },
): { title: string; episode: string | null } {
  if (ref.movie) {
    const movie = findByRef<BackupMovie>(file.movies, ref.movie)
    if (!movie) return { title: 'Unknown movie', episode: null }
    return { title: movie.year ? `${movie.title} (${movie.year})` : movie.title, episode: null }
  }

  const show = findByRef<BackupShow>(file.shows, ref.show!)
  if (!show) return { title: 'Unknown show', episode: null }
  if (ref.season === undefined) return { title: show.title, episode: null }

  return { title: show.title, episode: episodeLabel(ref.season, ref.episode!) }
}

/** `{ date: '2026-01-05', time: '14:32' }`, the local convention (see
 * database-backup.ts's UTC-day-key usage elsewhere) for a compact,
 * locale-independent date in server-generated diagnostic text — this is API
 * response content, not translated UI chrome, so it isn't run through i18n
 * date formatting. Split rather than one combined string so the frontend
 * can lay them out as their own fixed-width column next to a truncating
 * title. */
function splitDateTime(isoDatetime: string): { date: string; time: string } {
  return { date: isoDatetime.slice(0, 10), time: isoDatetime.slice(11, 16) }
}

/** Newest-first, by whatever ISO datetime string `dateOf` returns — used to
 * sort each category's added/removed entries before describing them, so the
 * Diff dialog reads like a timeline rather than the arbitrary order
 * `buildBackupFile`'s queries (or an old backup file's own array order)
 * happened to produce. */
function byDateDesc<T>(dateOf: (entry: T) => string): (a: T, b: T) => number {
  return (a, b) => dateOf(b).localeCompare(dateOf(a))
}

/** A dropped-show row's *effective* state - `manualDropped` (an explicit
 * override, set independently of Trakt) wins whenever it's non-null, else
 * fall back to `traktDropped`; the same "manualDropped wins" rule as
 * `effectiveDroppedExpr()`/`effectiveDroppedAtExpr()`
 * (apps/api/src/lib/dropped.ts) and every other place this table is read
 * (the shows gallery, ShowDetailPage). Null when the show isn't currently,
 * effectively dropped at all - notably `manualDropped: false` (a "keep
 * watching" override that disagrees with Trakt) is *not* dropped, even
 * though `traktDropped`/`traktDroppedAt` are still sitting there true. This
 * matters here specifically because `manualDroppedAt` gets re-stamped every
 * time that override is (re-)applied, even when neither `manualDropped`
 * itself nor the effective state actually changed - diffing the raw row
 * (as this used to) would surface that internal timestamp churn as a
 * spurious drop/undrop pair. */
function effectiveDrop(
  entry: BackupDroppedShow,
): { at: string; reason: 'Trakt' | 'manual' } | null {
  if (entry.manualDropped !== null) {
    return entry.manualDropped ? { at: entry.manualDroppedAt!, reason: 'manual' } : null
  }
  return entry.traktDropped ? { at: entry.traktDroppedAt!, reason: 'Trakt' } : null
}

function describeWatch(file: BackupFile, entry: BackupWatch): BackupDiffEntry {
  return { ...splitDateTime(entry.watchedAt), ...mediaRefParts(file, entry), suffix: null }
}

function describeRating(file: BackupFile, entry: BackupRating): BackupDiffEntry {
  return {
    ...splitDateTime(entry.ratedAt),
    ...mediaRefParts(file, entry),
    suffix: `rated ${entry.rating}`,
  }
}

function describeWatchlistItem(file: BackupFile, entry: BackupWatchlistItem): BackupDiffEntry {
  return { ...splitDateTime(entry.listedAt), ...mediaRefParts(file, entry), suffix: entry.list }
}

function describeDroppedShow(file: BackupFile, entry: BackupDroppedShow): BackupDiffEntry {
  const show = findByRef<BackupShow>(file.shows, entry.show)
  const title = show?.title ?? 'Unknown show'
  // Only ever called on an entry that survived computeBackupDiff's
  // effectiveDrop() filter below, so this is never actually null - the
  // fallback is just defensive, same spirit as findByRef's.
  const effective = effectiveDrop(entry)
  return {
    ...(effective ? splitDateTime(effective.at) : { date: '', time: '' }),
    title,
    episode: null,
    suffix: effective?.reason ?? null,
  }
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
 * Each surviving entry also gets a structured description (`addedItems`/
 * `removedItems`) for the Diff dialog's "what changed" section — an added
 * entry is described against the `current` snapshot's own movies/shows,
 * a removed one against `backup`'s. Sorted newest first within each list
 * before describing, by whichever date field that category's own entries
 * carry. */
export async function computeBackupDiff(
  db: Database,
  userId: string,
  backup: BackupFile,
  providers: MetadataProvider[],
): Promise<BackupDiff> {
  const current = await buildBackupFile(db, userId, '', new Date(), providers)
  const stringify = <T>(entry: T) => JSON.stringify(entry)

  const watchHistory = multisetDiff(current.watchHistory, backup.watchHistory, stringify)
  watchHistory.added.sort(byDateDesc((e) => e.watchedAt))
  watchHistory.removed.sort(byDateDesc((e) => e.watchedAt))

  const ratings = multisetDiff(current.ratings, backup.ratings, stringify)
  ratings.added.sort(byDateDesc((e) => e.ratedAt))
  ratings.removed.sort(byDateDesc((e) => e.ratedAt))

  const watchlist = multisetDiff(current.watchlist, backup.watchlist, stringify)
  watchlist.added.sort(byDateDesc((e) => e.listedAt))
  watchlist.removed.sort(byDateDesc((e) => e.listedAt))

  // Filtered to rows that are effectively dropped *first* - a show whose
  // manual override was refreshed without changing its effective state
  // (see effectiveDrop()'s doc comment) never enters either list, so it
  // can't appear as a diff entry at all, matching the activity feed's own
  // droppedBranch() (apps/api/src/routes/activity.ts) filtering on the same
  // effective state rather than the raw row. Keyed on the effective
  // {show, at, reason} rather than the full row, so an irrelevant raw-field
  // change (e.g. traktDroppedAt updating while a manual override still
  // wins) doesn't read as a change either.
  const droppedShows = multisetDiff(
    current.droppedShows.filter((e) => effectiveDrop(e) !== null),
    backup.droppedShows.filter((e) => effectiveDrop(e) !== null),
    (entry) => JSON.stringify({ show: entry.show, ...effectiveDrop(entry) }),
  )
  droppedShows.added.sort(byDateDesc((e) => effectiveDrop(e)!.at))
  droppedShows.removed.sort(byDateDesc((e) => effectiveDrop(e)!.at))

  return {
    watchHistory: {
      added: watchHistory.added.length,
      removed: watchHistory.removed.length,
      addedItems: watchHistory.added.map((entry) => describeWatch(current, entry)),
      removedItems: watchHistory.removed.map((entry) => describeWatch(backup, entry)),
    },
    ratings: {
      added: ratings.added.length,
      removed: ratings.removed.length,
      addedItems: ratings.added.map((entry) => describeRating(current, entry)),
      removedItems: ratings.removed.map((entry) => describeRating(backup, entry)),
    },
    watchlist: {
      added: watchlist.added.length,
      removed: watchlist.removed.length,
      addedItems: watchlist.added.map((entry) => describeWatchlistItem(current, entry)),
      removedItems: watchlist.removed.map((entry) => describeWatchlistItem(backup, entry)),
    },
    droppedShows: {
      added: droppedShows.added.length,
      removed: droppedShows.removed.length,
      addedItems: droppedShows.added.map((entry) => describeDroppedShow(current, entry)),
      removedItems: droppedShows.removed.map((entry) => describeDroppedShow(backup, entry)),
    },
  }
}
