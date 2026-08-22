import type { Database } from '@rwnd/db'
import type { BackupDiff, BackupFile } from '@rwnd/shared'
import { buildBackupFile } from './build.js'

/** Category keys shared between a BackupFile and the diff result — pulled
 * out so the loop below stays in sync with backupDiffSchema without
 * repeating the four names by hand. */
const CATEGORIES = ['watchHistory', 'ratings', 'watchlist', 'droppedShows'] as const

/** Multiset difference between two key lists — not a plain Set difference,
 * since a genuine duplicate (e.g. two watch-history rows with identical
 * movie/watchedAt/source down to the second, which a bulk import could
 * produce) must count as two entries on each side, not collapse to one. */
function multisetDiff(
  currentKeys: string[],
  backupKeys: string[],
): { added: number; removed: number } {
  const backupRemaining = new Map<string, number>()
  for (const key of backupKeys) backupRemaining.set(key, (backupRemaining.get(key) ?? 0) + 1)

  let added = 0
  for (const key of currentKeys) {
    const remaining = backupRemaining.get(key) ?? 0
    if (remaining > 0) backupRemaining.set(key, remaining - 1)
    else added++
  }

  let removed = 0
  for (const remaining of backupRemaining.values()) removed += remaining

  return { added, removed }
}

/** Counts entries added/removed per category between a backup file and the
 * database's current state, by snapshotting the current state through the
 * same `buildBackupFile()` used to write a backup and diffing the two
 * arrays. Entries are compared by their full JSON shape (TMDB-id-keyed
 * refs, same as the backup format itself — see backups.ts's schema doc
 * comment) rather than any local row id, since a changed rating/note is
 * naturally "the old entry removed, the new one added" under this model,
 * not a third "changed" bucket the UI doesn't ask for. */
export async function computeBackupDiff(
  db: Database,
  userId: string,
  backup: BackupFile,
): Promise<BackupDiff> {
  const current = await buildBackupFile(db, userId, '', new Date())

  const diff = {} as BackupDiff
  for (const category of CATEGORIES) {
    const currentKeys = current[category].map((entry) => JSON.stringify(entry))
    const backupKeys = backup[category].map((entry) => JSON.stringify(entry))
    diff[category] = multisetDiff(currentKeys, backupKeys)
  }
  return diff
}
