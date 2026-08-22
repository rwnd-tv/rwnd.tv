import { z } from 'zod'

/**
 * Per-user backup/restore for the four categories Clear database can also
 * destroy (see schemas/account.ts) — watch history, ratings, watchlist,
 * dropped shows. Stored as one JSON file per backup
 * (apps/api/src/routes/backups.ts), not a database row, so a copy can be
 * taken off the server.
 *
 * Entries are identified by TMDB id (plus season/episode number for an
 * episode), never rwnd.tv's own row ids — those are random UUIDs
 * (`defaultRandom()` in packages/db/src/schema.ts) that only exist on the
 * database that generated them, so a backup keyed on them would only ever
 * be restorable onto the exact instance it came from. The metadata needed
 * to resolve a TMDB id back to a local row — title, poster, genres,
 * seasons, episode titles — travels inside the file itself (see
 * `backupMovieSchema`/`backupShowSchema`), so restore never needs a TMDB
 * API call: apps/api/src/lib/media.ts's resolveShow()/resolveEpisode()
 * only ever hit the provider on an `external_ids` miss, and everything
 * after that is plain field-copying from what's already known.
 *
 * An entity with no `tmdb` row in `external_ids` at all (possible for a
 * show matched purely by a backfilled `trakt` id) can't be represented —
 * it's skipped when the file is built, counted in `skipped` rather than
 * silently dropped.
 */

export const backupMovieSchema = z.object({
  tmdbId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
})
export type BackupMovie = z.infer<typeof backupMovieSchema>

export const backupSeasonSchema = z.object({
  seasonNumber: z.number().int(),
  name: z.string().nullable(),
  episodeCount: z.number().int(),
  airDate: z.string().nullable(),
  posterPath: z.string().nullable(),
})
export type BackupSeason = z.infer<typeof backupSeasonSchema>

/** Only episodes this user has actually referenced (via a watch/rating/
 * watchlist entry) travel in the file — not a show's whole episode catalog
 * — matching how the local `episodes` table itself only ever holds
 * episodes someone has logged (see packages/db/src/schema.ts). */
export const backupEpisodeSchema = z.object({
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  title: z.string().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  firstAired: z.string().nullable(),
})
export type BackupEpisode = z.infer<typeof backupEpisodeSchema>

export const backupShowSchema = z.object({
  tmdbId: z.string(),
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
  status: z.string().nullable(),
  genres: z.array(z.string()),
  voteAverage: z.number().nullable(),
  seasons: z.array(backupSeasonSchema),
  episodes: z.array(backupEpisodeSchema),
})
export type BackupShow = z.infer<typeof backupShowSchema>

const playSourceSchema = z.enum(['manual', 'plex', 'import'])

/**
 * Points at a movie, or one episode of a show — the same two shapes a
 * `plays` row's exactly-one-of `movieId`/`episodeId` can be (see
 * packages/db/src/schema.ts's `plays_exactly_one_media_ref` check).
 * Flattened rather than a tagged union, matching
 * createPlayRequestSchema's existing "exactly one of movie or episode"
 * `.refine()` convention (schemas/plays.ts) instead of introducing a new
 * shape.
 */
export const backupWatchSchema = z
  .object({
    movie: z.string().optional(),
    show: z.string().optional(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    watchedAt: z.string().datetime(),
    source: playSourceSchema,
    sourceRef: z.string().nullable(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.show), {
    message: 'Provide exactly one of movie or show',
  })
  .refine((v) => Boolean(v.show) === (v.season !== undefined && v.episode !== undefined), {
    message: 'season and episode are required exactly when show is set',
  })
export type BackupWatch = z.infer<typeof backupWatchSchema>

/**
 * Points at a movie, a whole show, or one episode of a show — the three
 * shapes `ratings`/`watchlist_items` are polymorphic over in
 * packages/db/src/schema.ts. A show-level entry has `show` with no
 * `season`/`episode`; an episode-level entry has all three.
 */
export const backupRatingSchema = z
  .object({
    movie: z.string().optional(),
    show: z.string().optional(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    rating: z.number().int().min(1).max(10),
    ratedAt: z.string().datetime(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.show), {
    message: 'Provide exactly one of movie or show',
  })
  .refine((v) => (v.season === undefined) === (v.episode === undefined), {
    message: 'season and episode must both be present or both absent',
  })
export type BackupRating = z.infer<typeof backupRatingSchema>

export const backupWatchlistItemSchema = z
  .object({
    movie: z.string().optional(),
    show: z.string().optional(),
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
export type BackupWatchlistItem = z.infer<typeof backupWatchlistItemSchema>

export const backupDroppedShowSchema = z.object({
  show: z.string(),
  traktDropped: z.boolean().nullable(),
  traktDroppedAt: z.string().datetime().nullable(),
  manualDropped: z.boolean().nullable(),
  manualDroppedAt: z.string().datetime().nullable(),
})
export type BackupDroppedShow = z.infer<typeof backupDroppedShowSchema>

/** Same field names as accountDataCountsSchema (schemas/account.ts) —
 * these are the same four categories, just counted from a file instead of
 * the live database. */
export const backupCountsSchema = z.object({
  watchHistory: z.number().int(),
  ratings: z.number().int(),
  watchlist: z.number().int(),
  droppedShows: z.number().int(),
})
export type BackupCounts = z.infer<typeof backupCountsSchema>

/** Bumped whenever a change to the shapes above would make an older file
 * unsafe to restore as-is — restore refuses a mismatch outright (see
 * apps/api/src/routes/backups.ts) rather than guessing, since the database
 * is about to be wiped before the file's contents are even parsed. */
export const BACKUP_FORMAT_VERSION = 1

export const backupFileSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  createdAt: z.string().datetime(),
  description: z.string(),
  counts: backupCountsSchema,
  skipped: z.number().int(),
  movies: z.array(backupMovieSchema),
  shows: z.array(backupShowSchema),
  watchHistory: z.array(backupWatchSchema),
  ratings: z.array(backupRatingSchema),
  watchlist: z.array(backupWatchlistItemSchema),
  droppedShows: z.array(backupDroppedShowSchema),
})
export type BackupFile = z.infer<typeof backupFileSchema>

export const createBackupRequestSchema = z.object({
  description: z.string().trim().min(1).max(200),
})
export type CreateBackupRequest = z.infer<typeof createBackupRequestSchema>

/**
 * A backup's filename, minus the `.json` extension — see
 * apps/api/src/backup/paths.ts for exactly what generates it (including
 * the optional `--<slug of the description>` suffix). Reused as the
 * `{id}` route param on restore/delete so a malformed id 400s before ever
 * reaching a handler, rather than needing its own manual check next to
 * every filesystem path built from it. Kept literally identical to
 * `BACKUP_ID_RE` in paths.ts — see that file's doc comment.
 */
export const backupIdSchema = z
  .string()
  .regex(/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}(--[a-z0-9-]{1,50})?$/)
export type BackupId = z.infer<typeof backupIdSchema>

/** One row in the Database panel's backup list (GET /backups) — just a
 * file's header fields, not its full contents. */
export const backupSummarySchema = z.object({
  id: backupIdSchema,
  createdAt: z.string().datetime(),
  description: z.string(),
  counts: backupCountsSchema,
  skipped: z.number().int(),
})
export type BackupSummary = z.infer<typeof backupSummarySchema>

export const listBackupsResponseSchema = z.object({
  backups: z.array(backupSummarySchema),
})
export type ListBackupsResponse = z.infer<typeof listBackupsResponseSchema>

export const restoreBackupResponseSchema = z.object({
  counts: backupCountsSchema,
})
export type RestoreBackupResponse = z.infer<typeof restoreBackupResponseSchema>

/** Entries present now but not in the backup ("added" since the backup was
 * taken) vs. entries present in the backup but not now ("removed" since).
 * Counted per category, same four as backupCountsSchema. */
export const backupDiffCategorySchema = z.object({
  added: z.number().int(),
  removed: z.number().int(),
})
export type BackupDiffCategory = z.infer<typeof backupDiffCategorySchema>

export const backupDiffSchema = z.object({
  watchHistory: backupDiffCategorySchema,
  ratings: backupDiffCategorySchema,
  watchlist: backupDiffCategorySchema,
  droppedShows: backupDiffCategorySchema,
})
export type BackupDiff = z.infer<typeof backupDiffSchema>

export const diffBackupResponseSchema = z.object({
  diff: backupDiffSchema,
})
export type DiffBackupResponse = z.infer<typeof diffBackupResponseSchema>
