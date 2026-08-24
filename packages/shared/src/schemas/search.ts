import { z } from 'zod'
import { metadataProviderSourceSchema } from './common.js'

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(['movie', 'show', 'all']).default('all'),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>

export const searchResultSchema = z.object({
  type: z.enum(['movie', 'show']),
  /** Which provider this result came from — echoed straight back by
   * SearchResultCard.tsx into POST /library/shows|movies/resolve's own
   * `source`, so this widens in lockstep with
   * resolveMediaRequestSchema.source (library.ts). */
  source: metadataProviderSourceSchema,
  externalId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>
