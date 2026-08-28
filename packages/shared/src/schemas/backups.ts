import { z } from 'zod'
import { metadataProviderSourceSchema, playSourceSchema } from './common.js'

/**
 * Per-user backup/restore for the four categories Clear database can also
 * destroy (see schemas/account.ts) — watch history, ratings, watchlist,
 * dropped shows. Stored as one JSON file per backup
 * (apps/api/src/routes/backups.ts), not a database row, so a copy can be
 * taken off the server.
 *
 * Entries are identified by a provider-tagged external id (plus season/
 * episode number for an episode), never rwnd.tv's own row ids — those are
 * random UUIDs (`defaultRandom()` in packages/db/src/schema.ts) that only
 * exist on the database that generated them, so a backup keyed on them
 * would only ever be restorable onto the exact instance it came from. The
 * metadata needed to resolve a ref back to a local row — title, poster,
 * genres, seasons, episode titles — travels inside the file itself (see
 * `backupMovieSchema`/`backupShowSchema`), so restore never needs a
 * provider API call: apps/api/src/lib/media.ts's
 * resolveShow()/resolveEpisode() only ever hit the provider on an
 * `external_ids` miss, and everything after that is plain field-copying
 * from what's already known.
 *
 * An entity with no id from any configured provider in `external_ids` at
 * all (possible for a show matched purely by a backfilled `trakt` id)
 * can't be represented — it's skipped when the file is built, counted in
 * `skipped` rather than silently dropped.
 */

/** A reference to a movie/show by whichever provider build.ts's
 * priority-ordered lookup (apps/api/src/providers/priority.ts) had an id
 * for. Format version 1 kept a bare TMDB id string here — that stopped
 * being safe once a second provider existed, since a TMDB id and a
 * same-numbered TVDB id point at unrelated titles; see
 * apps/api/src/backup/legacy.ts for how an old v1 file's bare id is
 * up-converted to `{source: 'tmdb', externalId}` on read. */
export const externalRefSchema = z.object({
  source: metadataProviderSourceSchema,
  externalId: z.string(),
})
export type ExternalRef = z.infer<typeof externalRefSchema>

// Deliberately no `slug` field, unlike backupShowSchema below — restore
// always regenerates a movie's slug via generateUniqueMovieSlug() rather
// than trusting a stored one (same as it would for a show), so carrying it
// here would earn nothing while forcing a BACKUP_FORMAT_VERSION bump that
// breaks every existing backup file for no gain.
export const backupMovieSchema = z.object({
  ref: externalRefSchema,
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
  ref: externalRefSchema,
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
    movie: externalRefSchema.optional(),
    show: externalRefSchema.optional(),
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
    movie: externalRefSchema.optional(),
    show: externalRefSchema.optional(),
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
  .refine((v) => !v.movie || (v.season === undefined && v.episode === undefined), {
    message: 'season and episode are only valid for a show entry, not a movie entry',
  })
export type BackupRating = z.infer<typeof backupRatingSchema>

export const backupWatchlistItemSchema = z
  .object({
    movie: externalRefSchema.optional(),
    show: externalRefSchema.optional(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    listedAt: z.string().datetime(),
    notes: z.string().nullable(),
    /** Which of the user's watchlists this entry belongs to, by name — see
     * `backupWatchlistSchema` below for the roster this is matched against
     * on restore. Added in format version 3 (named watchlists); every v1/v2
     * entry up-converts to "Default" (apps/api/src/backup/legacy.ts). */
    list: z.string(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.show), {
    message: 'Provide exactly one of movie or show',
  })
  .refine((v) => (v.season === undefined) === (v.episode === undefined), {
    message: 'season and episode must both be present or both absent',
  })
  .refine((v) => !v.movie || (v.season === undefined && v.episode === undefined), {
    message: 'season and episode are only valid for a show entry, not a movie entry',
  })
export type BackupWatchlistItem = z.infer<typeof backupWatchlistItemSchema>

/**
 * One of the user's named watchlists, independent of its items — needed
 * alongside `backupWatchlistItemSchema.list` above so an *empty* custom
 * list still round-trips through backup/restore rather than only existing
 * implicitly wherever an item happens to reference its name. The Default
 * list is never included here: it's not created by restore reading this
 * array, it always exists on its own (ensureDefaultWatchlist,
 * apps/api/src/lib/watchlists.ts) — restore just needs to leave it alone.
 */
export const backupWatchlistSchema = z.object({
  name: z.string(),
})
export type BackupWatchlist = z.infer<typeof backupWatchlistSchema>

export const backupDroppedShowSchema = z.object({
  show: externalRefSchema,
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
 * unsafe to restore or diff as-is. Both existing transitions have a safe,
 * lossless up-conversion, performed on read by apps/api/src/backup/legacy.ts
 * rather than refusing the file outright: 1 -> 2 (bare `tmdbId` strings to
 * provider-tagged `externalRefSchema` refs — every v1 file was necessarily
 * written when TMDB was the only provider, so its ids are unambiguously
 * `{source: 'tmdb', externalId}`) and 2 -> 3 (named watchlists — every v1/v2
 * file's flat watchlist is unambiguously what's now called "Default", see
 * `backupWatchlistItemSchema.list` above). A future format change without
 * an equivalent up-conversion should still refuse, the same way this file
 * historically did for any version mismatch. */
export const BACKUP_FORMAT_VERSION = 3

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
  /** Every one of the user's *custom* watchlists, independent of their
   * items — see `backupWatchlistSchema`'s doc comment for why this exists
   * separately from `watchlist` above. */
  watchlists: z.array(backupWatchlistSchema),
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
