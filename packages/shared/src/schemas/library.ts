import { z } from 'zod'

/**
 * TV Shows / Movies gallery pages (apps/web/src/routes/ShowsPage.tsx,
 * MoviesPage.tsx). Unlike /plays, these return the user's whole library in
 * one response — real libraries are ~500 items (~20KB gzipped), and the
 * gallery's filter/sort controls are client-side, so cursor pagination
 * would just add round trips for no benefit.
 */

export const libraryShowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  /** TMDB genre names verbatim (e.g. 'Drama', 'Animation'). Backs the
   * gallery's genre filter panel — see ShowsPage.tsx. */
  genres: z.array(z.string()),
  /** Distinct episodes watched, season 0 (specials) excluded. */
  watchedEpisodes: z.number().int(),
  /** SUM of cached season episode counts, season 0 excluded. `null` means
   * this show's season data hasn't been cached from the provider yet —
   * the UI shows a plain watched count instead of a progress bar, rather
   * than implying 0% complete. */
  totalEpisodes: z.number().int().nullable(),
  lastWatchedAt: z.string().datetime(),
})
export type LibraryShow = z.infer<typeof libraryShowSchema>

export const listLibraryShowsResponseSchema = z.object({
  shows: z.array(libraryShowSchema),
})
export type ListLibraryShowsResponse = z.infer<typeof listLibraryShowsResponseSchema>

export const libraryMovieSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  /** Counts rewatches. */
  playCount: z.number().int(),
  lastWatchedAt: z.string().datetime(),
})
export type LibraryMovie = z.infer<typeof libraryMovieSchema>

export const listLibraryMoviesResponseSchema = z.object({
  movies: z.array(libraryMovieSchema),
})
export type ListLibraryMoviesResponse = z.infer<typeof listLibraryMoviesResponseSchema>
