import { z } from 'zod'
import { paginationQuerySchema } from './common.js'

/**
 * A play is logged against a *provider* result, not a local row directly —
 * the API resolves/creates the local movie or episode as part of handling
 * the request. Exactly one of movie/episode must be present.
 *
 * `source` is deliberately still `z.literal('tmdb')`, not the wider
 * `metadataProviderSourceSchema` (schemas/common.ts) used elsewhere as of
 * the multi-provider plumbing work (docs/adr/0006) — unlike
 * searchResultSchema/resolveMediaRequestSchema, this value is *authored by
 * the client* from a `tmdbId` field (see use-movie-watch-actions.ts,
 * use-episode-watch-actions.ts, both of which hardcode `'tmdb'`), and the
 * handler ignores it and resolves against whichever provider is on
 * context. Widening this now would let a request claim `source: 'tvdb'`
 * and silently resolve it against TMDB anyway. Widen this once POST /plays
 * actually honours `source` per-request, not before.
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

export const playMediaSummarySchema = z.object({
  // 'show' is never produced by a play (POST /plays only ever logs a movie
  // or episode watch) — it's here for GET /activity-feed's rating/watchlist
  // entries (schemas/activity.ts), which can target a whole show rather
  // than one episode. Widened on this shared schema rather than forked into
  // a separate one so ActivityTile.tsx (apps/web) can reuse the same
  // movie/episode/show switch PosterTile-based rendering everywhere else
  // already uses.
  type: z.enum(['movie', 'show', 'episode']),
  title: z.string(),
  posterPath: z.string().nullable(),
  showTitle: z.string().optional(),
  /** Present for episodes and shows — links an entry to the show's page
   * (apps/web/src/routes/ShowDetailPage.tsx). */
  showSlug: z.string().optional(),
  /** Present only for movies — links History entries to the movie's page
   * (apps/web/src/routes/MovieDetailPage.tsx), the movie counterpart of
   * `showSlug` above. */
  movieSlug: z.string().optional(),
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

/**
 * Request body for PATCH /plays/{id} (HistoryPage.tsx's "Edit date…" on a
 * single selected watch, via WatchDateDialog.tsx). Always flips `source` to
 * `'manual'` server-side — not a request field — since an edited timestamp
 * no longer reflects what Plex's scrobble or an import actually reported.
 */
export const updatePlayRequestSchema = z.object({
  watchedAt: z.string().datetime(),
})
export type UpdatePlayRequest = z.infer<typeof updatePlayRequestSchema>
