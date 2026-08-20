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
  /** URL-friendly identifier (e.g. "battlestar-galactica-1978") — links to
   * the show's page (apps/web/src/routes/ShowDetailPage.tsx) use this, not
   * `id`. */
  slug: z.string(),
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

/**
 * Backs the per-show page (apps/web/src/routes/ShowDetailPage.tsx), linked
 * to from the shows gallery and from History. `watchedEpisodes`/
 * `totalEpisodes` here follow the exact same season-0-excluded convention
 * as libraryShowSchema above, for consistency with the gallery card the
 * user likely just came from — but each season's own `watchedEpisodes`
 * (below) is a real, unfiltered count, specials included.
 */
export const showSeasonSchema = z.object({
  seasonNumber: z.number().int(),
  /** Null until the metadata refresher has cached this season — the UI
   * falls back to "Season {{n}}" / "Specials". */
  name: z.string().nullable(),
  episodeCount: z.number().int(),
  posterPath: z.string().nullable(),
  airDate: z.string().nullable(),
  watchedEpisodes: z.number().int(),
})
export type ShowSeason = z.infer<typeof showSeasonSchema>

export const showDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
  status: z.string().nullable(),
  genres: z.array(z.string()),
  watchedEpisodes: z.number().int(),
  totalEpisodes: z.number().int().nullable(),
  /** When the current user watched their first/most recent episode of this
   * show — across every season, specials included. Both null if they
   * haven't watched anything of it *with a known date* — a play dated
   * exactly 1900-01-01 is Trakt's "I don't remember when" sentinel (some
   * users, including the project owner, used it for backfilled history),
   * so it's excluded from this range entirely rather than dragging it back
   * to a bogus 1900. */
  firstWatchedAt: z.string().datetime().nullable(),
  lastWatchedAt: z.string().datetime().nullable(),
  /** True if this show has at least one play dated exactly 1900-01-01 — the
   * UI shows "Watched: unknown" when this is true and there's no other,
   * real-dated play to show a range for instead. */
  hasUnknownWatchDate: z.boolean(),
  seasons: z.array(showSeasonSchema),
})
export type ShowDetail = z.infer<typeof showDetailSchema>

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
