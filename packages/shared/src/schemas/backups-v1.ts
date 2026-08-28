import { z } from 'zod'
import { backupCountsSchema, backupEpisodeSchema, backupSeasonSchema } from './backups.js'
import { playSourceSchema, ratingValueSchema } from './common.js'

/**
 * Frozen shape of BACKUP_FORMAT_VERSION 1 files — kept only so
 * apps/api/src/backup/legacy.ts can parse and up-convert an old backup a
 * user saved before format version 2 introduced provider-tagged references
 * (see backups.ts's `externalRefSchema` doc comment). Never edit these
 * schemas — they must keep matching exactly the bytes format version 1
 * actually wrote, independent of whatever backups.ts's current shapes
 * evolve into next.
 */

const backupMovieSchemaV1 = z.object({
  tmdbId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
})

const backupShowSchemaV1 = z.object({
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

const backupWatchSchemaV1 = z
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

const backupRatingSchemaV1 = z
  .object({
    movie: z.string().optional(),
    show: z.string().optional(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    rating: ratingValueSchema,
    ratedAt: z.string().datetime(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.show), {
    message: 'Provide exactly one of movie or show',
  })
  .refine((v) => (v.season === undefined) === (v.episode === undefined), {
    message: 'season and episode must both be present or both absent',
  })

const backupWatchlistItemSchemaV1 = z
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

const backupDroppedShowSchemaV1 = z.object({
  show: z.string(),
  traktDropped: z.boolean().nullable(),
  traktDroppedAt: z.string().datetime().nullable(),
  manualDropped: z.boolean().nullable(),
  manualDroppedAt: z.string().datetime().nullable(),
})

export const backupFileSchemaV1 = z.object({
  formatVersion: z.literal(1),
  createdAt: z.string().datetime(),
  description: z.string(),
  counts: backupCountsSchema,
  skipped: z.number().int(),
  movies: z.array(backupMovieSchemaV1),
  shows: z.array(backupShowSchemaV1),
  watchHistory: z.array(backupWatchSchemaV1),
  ratings: z.array(backupRatingSchemaV1),
  watchlist: z.array(backupWatchlistItemSchemaV1),
  droppedShows: z.array(backupDroppedShowSchemaV1),
})
export type BackupFileV1 = z.infer<typeof backupFileSchemaV1>
