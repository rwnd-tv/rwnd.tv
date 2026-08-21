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
  /** TMDB's raw status string (e.g. 'Returning Series', 'Ended') — not
   * localized by TMDB itself, so the gallery translates it for display (see
   * StatusFilterPanel.tsx). Null until the metadata refresher has cached
   * this show. Backs the gallery's status filter panel — see
   * ShowsPage.tsx. */
  status: z.string().nullable(),
  /** TMDB genre names verbatim (e.g. 'Drama', 'Animation'). Backs the
   * gallery's genre filter panel — see ShowsPage.tsx. */
  genres: z.array(z.string()),
  /** TMDB's average rating, 0-10. Null until the metadata refresher has
   * cached this show, or genuinely null for a show TMDB has no votes for
   * yet — both render the same way (no rating shown). Backs the gallery's
   * rating filter/sort — see ShowsPage.tsx. */
  voteAverage: z.number().nullable(),
  /** Whether the current user has marked this show as "dropped" — partially
   * watched, no longer intending to finish (mirrors Trakt's own "Dropped"
   * feature). Hidden from the gallery by default — see ShowsPage.tsx's
   * dropped filter. */
  dropped: z.boolean(),
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
  /** TMDB's average rating, 0-10 — see libraryShowSchema's `voteAverage`
   * for the null-handling convention. */
  voteAverage: z.number().nullable(),
  /** TMDB's own numeric id for this show (e.g. "94605"), for linking to its
   * TMDB page — see ShowDetailPage.tsx's rating badge. Null for a show with
   * no external id on record (shouldn't happen with TMDB as the only
   * provider today, but not guaranteed by the schema). */
  tmdbId: z.string().nullable(),
  /** See libraryShowSchema's `dropped` for what this means. */
  dropped: z.boolean(),
  /** When the show was dropped — from Trakt's `hidden_at` if imported, or
   * the moment of the manual toggle otherwise. Null when `dropped` is
   * false. */
  droppedAt: z.string().datetime().nullable(),
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

/**
 * Backs the season detail page (apps/web/src/routes/SeasonDetailPage.tsx),
 * linked to from a season card on ShowDetailPage.tsx. Episode metadata
 * (title/overview/still/runtime/air date) is fetched live from the
 * provider on every request rather than cached locally — unlike the show
 * and season-summary rows, there's no local `episodes` row for an episode
 * the user hasn't logged a watch of yet, so there's nothing to read
 * instead of calling out. `watched`/`watchedCount`/`lastWatchedAt` are the
 * only per-user, locally-sourced fields on each episode.
 */
export const seasonEpisodeSchema = z.object({
  episodeNumber: z.number().int(),
  title: z.string().nullable(),
  overview: z.string().nullable(),
  stillPath: z.string().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  firstAired: z.string().nullable(),
  watched: z.boolean(),
  /** How many times the current user has logged a play of this episode —
   * shown next to the watched toggle so a rewatch isn't silently hidden by
   * the boolean (see SeasonDetailPage.tsx). */
  watchedCount: z.number().int(),
  lastWatchedAt: z.string().datetime().nullable(),
})
export type SeasonEpisode = z.infer<typeof seasonEpisodeSchema>

export const seasonDetailSchema = z.object({
  seasonNumber: z.number().int(),
  name: z.string().nullable(),
  /** The season's own synopsis — fetched live from the provider on every
   * request, same as the episode list itself, not cached on the local
   * `seasons` row (see packages/db/src/schema.ts). */
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
  airDate: z.string().nullable(),
  episodes: z.array(seasonEpisodeSchema),
})
export type SeasonDetail = z.infer<typeof seasonDetailSchema>

/**
 * Response shape for the per-episode watched toggle
 * (POST /plays to mark watched, DELETE
 * /library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays
 * to un-watch — see SeasonDetailPage.tsx). Same "just the changed fields"
 * reasoning as droppedStatusSchema below — the frontend patches this into
 * its already-cached season list rather than refetching the whole season.
 */
export const episodeWatchedStatusSchema = z.object({
  watched: z.boolean(),
  watchedCount: z.number().int(),
  lastWatchedAt: z.string().datetime().nullable(),
})
export type EpisodeWatchedStatus = z.infer<typeof episodeWatchedStatusSchema>

/**
 * Every one of the current user's individual watch timestamps for one
 * episode, newest first — backs the "are you sure you want to remove
 * this/these watch(es)?" confirmation shown before un-watching
 * (UnwatchConfirmDialog.tsx) clears all of them. Deliberately not part of
 * seasonDetailSchema/seasonEpisodeSchema above — most episodes have at
 * most one play, so fetching every episode's full watch list on every
 * season page load would be wasted work for the common case; this is
 * fetched on demand only when the confirmation dialog opens.
 */
export const episodeWatchesSchema = z.object({
  watchedAt: z.array(z.string().datetime()),
})
export type EpisodeWatches = z.infer<typeof episodeWatchesSchema>

/**
 * Response shape for the manual drop/undrop toggle
 * (POST/DELETE /library/shows/{slug}/dropped — see ShowDetailPage.tsx).
 * Deliberately just the two changed fields, not the full showDetailSchema —
 * the frontend patches these into its already-cached ShowDetail rather than
 * refetching, so the route doesn't need to rebuild the whole detail
 * response (seasons, watched counts, etc.) just to toggle a boolean.
 */
export const droppedStatusSchema = z.object({
  dropped: z.boolean(),
  droppedAt: z.string().datetime().nullable(),
})
export type DroppedStatus = z.infer<typeof droppedStatusSchema>

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
