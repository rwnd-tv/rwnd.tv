import { z } from 'zod'
import { metadataProviderSourceSchema } from './common.js'

/**
 * TV Shows / Movies gallery pages (apps/web/src/routes/ShowsPage.tsx,
 * MoviesPage.tsx). Unlike /plays, these return the user's whole library in
 * one response — real libraries are ~500 items (~20KB gzipped), and the
 * gallery's filter/sort controls are client-side, so cursor pagination
 * would just add round trips for no benefit.
 */

/**
 * Backs the Dashboard search's show/movie results (SearchResultCard.tsx) —
 * clicking a result resolves it to a local `shows`/`movies` row (creating
 * one on first touch, same as any other watch/drop/refresh action) and
 * returns its slug so the page can navigate straight to `/shows/{slug}` or
 * `/movies/{slug}`, where the normal Watched button takes over. No
 * play/watch is logged by this alone. One shared shape for both media
 * types — `resolveShowRequestSchema`/`resolveMovieRequestSchema` would be
 * identical structs, and the show/movie-specific routes
 * (POST /library/shows/resolve, POST /library/movies/resolve) already tell
 * them apart by path. `source` widens in lockstep with
 * searchResultSchema.source (schemas/search.ts) — this is that value
 * round-tripped straight back by the client, and both handlers below
 * (POST /library/shows/resolve, POST /library/movies/resolve) already
 * ignore it and resolve using only `externalId` against whichever provider
 * is on context, so widening it is purely additive.
 */
export const resolveMediaRequestSchema = z.object({
  source: metadataProviderSourceSchema,
  externalId: z.string(),
})
export type ResolveMediaRequest = z.infer<typeof resolveMediaRequestSchema>

export const resolveMediaResponseSchema = z.object({
  slug: z.string(),
})
export type ResolveMediaResponse = z.infer<typeof resolveMediaResponseSchema>

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
 * Backs the Dashboard's On Deck row (apps/web/src/routes/DashboardPage.tsx)
 * — one card per show the user watched recently and hasn't finished, each
 * linking straight to the next episode they haven't seen yet rather than
 * the show page, so the card doubles as a "continue" action. `firstAired`
 * is shown on the card (how long it's been sitting there unwatched), same
 * as upNextItemSchema's own reason for carrying it.
 */
export const onDeckItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  posterPath: z.string().nullable(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  firstAired: z.string(),
})
export type OnDeckItem = z.infer<typeof onDeckItemSchema>

export const onDeckResponseSchema = z.object({
  shows: z.array(onDeckItemSchema),
})
export type OnDeckResponse = z.infer<typeof onDeckResponseSchema>

/**
 * Backs the Dashboard's Up Next row (apps/web/src/routes/DashboardPage.tsx)
 * — one card per show the user's following whose next episode hasn't aired
 * yet, independent of onDeckItemSchema above (a show can have both an
 * unwatched-aired episode and an upcoming one at once). `firstAired` is
 * shown on the card itself, unlike On Deck's — the point of this row is
 * knowing *when* something's coming, not just that it is.
 */
export const upNextItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  posterPath: z.string().nullable(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  firstAired: z.string(),
})
export type UpNextItem = z.infer<typeof upNextItemSchema>

export const upNextResponseSchema = z.object({
  shows: z.array(upNextItemSchema),
})
export type UpNextResponse = z.infer<typeof upNextResponseSchema>

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
   * provider today, but not guaranteed by the schema). Now that a real
   * answer exists for what happens with more than one provider, see
   * `metadataSource` below — this field stays TMDB-specific on purpose,
   * it's a themoviedb.org deep link, not a provenance indicator. */
  tmdbId: z.string().nullable(),
  /** Which provider the cached metadata on this page (title/overview/
   * genres/etc., not `tmdbId` above) was last fetched from — shown as a
   * provenance label next to the rating badge (docs/adr/0006). Null for a
   * row no provider has ever written (shouldn't happen in practice, same
   * caveat as `tmdbId`). */
  metadataSource: metadataProviderSourceSchema.nullable(),
  /** When `metadataSource` last wrote the cached fields. Surfaced as the
   * provenance label's tooltip — with metadata refreshed on request rather
   * than silently in the background (docs/adr/0005), "how old is this" is
   * a question a user can reasonably ask. */
  metadataRefreshedAt: z.string().datetime(),
  /** See libraryShowSchema's `dropped` for what this means. */
  dropped: z.boolean(),
  /** When the show was dropped — from Trakt's `hidden_at` if imported, or
   * the moment of the manual toggle otherwise. Null when `dropped` is
   * false. */
  droppedAt: z.string().datetime().nullable(),
  watchedEpisodes: z.number().int(),
  totalEpisodes: z.number().int().nullable(),
  /** How many of `totalEpisodes` have actually aired so far, season 0
   * excluded — distinct from `totalEpisodes` itself, which is the
   * eventual/planned count and includes episodes of a still-airing season
   * that haven't come out yet. Null until the metadata refresher has
   * computed it for every regular season (see
   * apps/api/src/metadata/refresh.ts); the "Watched" button only turns
   * purple once `watchedEpisodes` reaches this, not `totalEpisodes` — see
   * ShowDetailPage.tsx's `fullyWatched`. */
  airedEpisodes: z.number().int().nullable(),
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
  /** Whether one of this episode's logged plays is dated exactly
   * UNKNOWN_WATCHED_AT (packages/shared/src/constants.ts) — lets the
   * "log an additional watch" dialog (WatchDateDialog.tsx via
   * SeasonDetailPage.tsx's EpisodeCard) hide the "Unknown date" option
   * once one already exists, since a second one would be indistinguishable
   * from the first. */
  hasUnknownWatch: z.boolean(),
  /** This one episode's own TMDB rating, 0-10 — distinct from the season's
   * and show's own `voteAverage` fields. Null until the provider has one,
   * or genuinely unrated — both render the same way (no rating shown), same
   * convention as those other fields. */
  voteAverage: z.number().nullable(),
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
  /** This one season's own TMDB rating, 0-10 — distinct from the show's
   * overall `voteAverage` (showDetailSchema above). Null until the
   * provider has one, or genuinely unrated — both render the same way (no
   * rating shown), same convention as the show-level field. */
  voteAverage: z.number().nullable(),
  episodes: z.array(seasonEpisodeSchema),
})
export type SeasonDetail = z.infer<typeof seasonDetailSchema>

/**
 * Response shape for the per-episode/per-movie watched toggle (POST /plays
 * to mark watched, DELETE .../plays to un-watch — see SeasonDetailPage.tsx
 * and MovieDetailPage.tsx). Same "just the changed fields" reasoning as
 * droppedStatusSchema below — the frontend patches this into its
 * already-cached season list / movie detail rather than refetching the
 * whole thing. One shared shape: an episode's watched toggle and a movie's
 * are the exact same three fields, just addressed by a different route.
 */
export const watchedStatusSchema = z.object({
  watched: z.boolean(),
  watchedCount: z.number().int(),
  lastWatchedAt: z.string().datetime().nullable(),
})
export type WatchedStatus = z.infer<typeof watchedStatusSchema>

/**
 * Every one of the current user's individual watches for one episode or
 * movie, newest first — backs the "are you sure you want to remove this/
 * these watch(es)?" confirmation shown before un-watching
 * (UnwatchConfirmDialog.tsx), which lets the user tick individual watches
 * rather than only ever clearing all of them. `id` is each play's own id,
 * needed to name which ones to remove in removeWatchesRequestSchema below
 * — a plain list of timestamps isn't enough to address one watch
 * unambiguously (two plays could share an identical `watchedAt`, e.g. from
 * a bulk import). Deliberately not part of seasonDetailSchema/
 * seasonEpisodeSchema above — most episodes have at most one play, so
 * fetching every episode's full watch list on every season page load would
 * be wasted work for the common case; this is fetched on demand only when
 * the confirmation dialog opens. Shared with movies (MovieDetailPage.tsx)
 * for the same reason.
 */
export const watchesSchema = z.object({
  watches: z.array(
    z.object({
      id: z.string().uuid(),
      watchedAt: z.string().datetime(),
    }),
  ),
})
export type Watches = z.infer<typeof watchesSchema>

/**
 * Request body for DELETE .../plays (episode or movie —
 * UnwatchConfirmDialog.tsx) — the play ids to remove, from the ids
 * watchesSchema above returned. Always sent explicitly, even when every
 * watch is ticked ("remove all" is just every id, not a separate
 * omit-the-body mode) — one request shape, no special-cased branch to keep
 * in sync with the ticking UI.
 */
export const removeWatchesRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
})
export type RemoveWatchesRequest = z.infer<typeof removeWatchesRequestSchema>

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

/**
 * Backs the show page's "Watched" button (POST /library/shows/{slug}/watched
 * — see ShowDetailPage.tsx and its season-scoped counterpart,
 * SeasonDetailPage.tsx), the show-level equivalent of marking one episode
 * watched from the season grid. Logs one new play for every non-special
 * episode of the show that doesn't already have one — already-watched
 * episodes are left alone, so this fills in what's missing rather than
 * logging a rewatch of everything.
 *
 * Exactly one of `watchedAt` (every newly-logged play gets this same
 * timestamp) or `useReleaseDate` (each episode instead gets its own —
 * skipped entirely if that episode's release date isn't known) — mirrors
 * the "exactly one of" `.refine()` shape createPlayRequestSchema already
 * uses (schemas/plays.ts) rather than a discriminated union, since these
 * aren't otherwise tagged variants of the same shape.
 */
export const markShowWatchedRequestSchema = z
  .object({
    watchedAt: z.string().datetime().optional(),
    useReleaseDate: z.literal(true).optional(),
    /** Log a new watch for every episode in scope regardless of its
     * current watched state, rather than only filling in what's missing
     * — backs the "log an additional watch" button
     * (ShowDetailPage.tsx/SeasonDetailPage.tsx), shown once some watches
     * already exist so a rewatch can be logged without going through
     * History. Orthogonal to watchedAt/useReleaseDate — still exactly
     * one of those two for what date to use. */
    additional: z.literal(true).optional(),
  })
  .refine((v) => Boolean(v.watchedAt) !== Boolean(v.useReleaseDate), {
    message: 'Provide exactly one of watchedAt or useReleaseDate',
  })
export type MarkShowWatchedRequest = z.infer<typeof markShowWatchedRequestSchema>

export const markShowWatchedResponseSchema = z.object({
  count: z.number().int(),
})
export type MarkShowWatchedResponse = z.infer<typeof markShowWatchedResponseSchema>

/**
 * Backs the show page's "Watched" button when it's already showing every
 * non-special episode watched (see ShowDetailPage.tsx) — clicking it in
 * that state opens a confirmation instead of the watch-date dialog, and
 * this is what DELETE /library/shows/{slug}/watched removes: every play
 * the current user has logged against a non-special episode of the show.
 * Only ever touches locally-known episode rows — unlike the POST route
 * above, nothing here needs resolving from the provider.
 */
export const removeShowWatchesResponseSchema = z.object({
  count: z.number().int(),
})
export type RemoveShowWatchesResponse = z.infer<typeof removeShowWatchesResponseSchema>

export const libraryMovieSchema = z.object({
  id: z.string().uuid(),
  /** URL-friendly identifier (e.g. "the-matrix-1999") — links to the
   * movie's page (apps/web/src/routes/MovieDetailPage.tsx) use this, not
   * `id`. Same convention as libraryShowSchema's `slug` above. */
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  /** TMDB genre names verbatim. Backs the gallery's genre filter panel —
   * see libraryShowSchema's `genres` for the same convention. */
  genres: z.array(z.string()),
  /** TMDB's average rating, 0-10. Null until the metadata refresher has
   * cached this movie, or genuinely null for a movie TMDB has no votes
   * for yet — both render the same way (no rating shown). Backs the
   * gallery's rating filter/sort — see libraryShowSchema's `voteAverage`
   * for the same convention. */
  voteAverage: z.number().nullable(),
  /** Counts rewatches. */
  playCount: z.number().int(),
  lastWatchedAt: z.string().datetime(),
})
export type LibraryMovie = z.infer<typeof libraryMovieSchema>

export const listLibraryMoviesResponseSchema = z.object({
  movies: z.array(libraryMovieSchema),
})
export type ListLibraryMoviesResponse = z.infer<typeof listLibraryMoviesResponseSchema>

/**
 * Backs the per-movie page (apps/web/src/routes/MovieDetailPage.tsx),
 * linked to from the movies gallery, Dashboard search, and History. A
 * movie has no season/episode tree, so this is much flatter than
 * showDetailSchema above — `watched`/`watchedCount` play the role
 * `watchedEpisodes`/`totalEpisodes` do for a show, since a movie is one
 * thing with N plays rather than a fraction of episodes.
 */
export const movieDetailSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterPath: z.string().nullable(),
  genres: z.array(z.string()),
  /** TMDB's average rating, 0-10 — see libraryShowSchema's `voteAverage`
   * for the null-handling convention. */
  voteAverage: z.number().nullable(),
  /** TMDB's own numeric id for this movie, for linking to its TMDB page —
   * see showDetailSchema's `tmdbId` for the same convention. */
  tmdbId: z.string().nullable(),
  /** See showDetailSchema's field of the same name. */
  metadataSource: metadataProviderSourceSchema.nullable(),
  /** See showDetailSchema's field of the same name. */
  metadataRefreshedAt: z.string().datetime(),
  watched: z.boolean(),
  /** How many times the current user has logged a play of this movie —
   * see seasonEpisodeSchema's `watchedCount` for the same reasoning. */
  watchedCount: z.number().int(),
  /** Both null if the user hasn't watched this movie *with a known date* —
   * see showDetailSchema's `firstWatchedAt`/`lastWatchedAt` for the
   * 1900-01-01 Trakt-sentinel exclusion this follows exactly. */
  firstWatchedAt: z.string().datetime().nullable(),
  lastWatchedAt: z.string().datetime().nullable(),
  /** True if this movie has at least one play dated exactly 1900-01-01 —
   * same meaning as showDetailSchema's field of the same name. Doubles as
   * the "log an additional watch" dialog's `disableUnknown` input, the
   * role seasonEpisodeSchema's `hasUnknownWatch` plays for an episode. */
  hasUnknownWatchDate: z.boolean(),
})
export type MovieDetail = z.infer<typeof movieDetailSchema>
