import { z } from 'zod'
import {
  backupCountsSchema,
  backupDroppedShowSchema,
  backupMovieSchema,
  backupRatingSchema,
  backupShowSchema,
  backupWatchSchema,
  externalRefSchema,
} from './backups.js'

/**
 * Frozen shape of BACKUP_FORMAT_VERSION 2 files — kept only so
 * apps/api/src/backup/legacy.ts can parse and up-convert an old backup a
 * user saved before format version 3 introduced named watchlists (see
 * backups.ts's `backupWatchlistSchema`/`backupWatchlistItemSchema` doc
 * comments). Never edit this schema — it must keep matching exactly the
 * bytes format version 2 actually wrote, independent of whatever
 * backups.ts's current shapes evolve into next.
 *
 * Every other category (movies/shows/watchHistory/ratings/droppedShows) is
 * unchanged between v2 and v3, so this reuses those schemas directly from
 * backups.ts rather than re-freezing them — same convention backups-v1.ts
 * already follows for the fields v1 -> v2 didn't touch.
 */

export const backupWatchlistItemSchemaV2 = z
  .object({
    movie: externalRefSchema.optional(),
    show: externalRefSchema.optional(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    listedAt: z.string().datetime(),
    notes: z.string().nullable(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.show), {
    message: 'Provide exactly one of movie or show',
  })
  .refine((v) => (v.season === undefined) === (v.episode === undefined), {
    message: 'season and episode must both be present or both absent',
  })
export type BackupWatchlistItemV2 = z.infer<typeof backupWatchlistItemSchemaV2>

export const backupFileSchemaV2 = z.object({
  formatVersion: z.literal(2),
  createdAt: z.string().datetime(),
  description: z.string(),
  counts: backupCountsSchema,
  skipped: z.number().int(),
  movies: z.array(backupMovieSchema),
  shows: z.array(backupShowSchema),
  watchHistory: z.array(backupWatchSchema),
  ratings: z.array(backupRatingSchema),
  watchlist: z.array(backupWatchlistItemSchemaV2),
  droppedShows: z.array(backupDroppedShowSchema),
})
export type BackupFileV2 = z.infer<typeof backupFileSchemaV2>
