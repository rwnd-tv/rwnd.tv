import { z } from 'zod'
import { paginationQuerySchema } from './common.js'

/**
 * A play is logged against a *provider* result, not a local row directly —
 * the API resolves/creates the local movie or episode as part of handling
 * the request. Exactly one of movie/episode must be present.
 */
export const createPlayRequestSchema = z
  .object({
    movie: z.object({ source: z.literal('tmdb'), externalId: z.string() }).optional(),
    episode: z
      .object({
        source: z.literal('tmdb'),
        showExternalId: z.string(),
        seasonNumber: z.number().int().min(0),
        episodeNumber: z.number().int().min(1),
      })
      .optional(),
    watchedAt: z.string().datetime().optional(),
  })
  .refine((v) => Boolean(v.movie) !== Boolean(v.episode), {
    message: 'Provide exactly one of movie or episode',
  })
export type CreatePlayRequest = z.infer<typeof createPlayRequestSchema>

const playMediaSummarySchema = z.object({
  type: z.enum(['movie', 'episode']),
  title: z.string(),
  posterPath: z.string().nullable(),
  showTitle: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
})

export const playSchema = z.object({
  id: z.string().uuid(),
  watchedAt: z.string().datetime(),
  source: z.enum(['manual', 'plex', 'import']),
  createdAt: z.string().datetime(),
  media: playMediaSummarySchema,
})
export type Play = z.infer<typeof playSchema>

export const listPlaysQuerySchema = paginationQuerySchema
export type ListPlaysQuery = z.infer<typeof listPlaysQuerySchema>

export const listPlaysResponseSchema = z.object({
  plays: z.array(playSchema),
  nextCursor: z.string().datetime().nullable(),
})
export type ListPlaysResponse = z.infer<typeof listPlaysResponseSchema>
