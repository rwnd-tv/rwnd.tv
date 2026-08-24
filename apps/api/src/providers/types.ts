import type { MetadataProviderSource } from '@rwnd/shared'

/**
 * Source of show/movie/episode metadata and artwork. TMDB is the only
 * implementation today (see ./tmdb.ts and docs/adr/0002), but nothing
 * outside this directory talks to TMDB directly — that's what keeps a
 * future Wikidata/TVDB adapter, or a self-hoster's own key policy, a
 * contained change. Every field returned here is already provider-neutral:
 * full poster URLs, plain numbers/strings, no TMDB-specific shapes leak out.
 */
export interface MetadataProvider {
  readonly source: MetadataProviderSource
  searchMulti(query: string, locale: string): Promise<ProviderSearchResult[]>
  getMovie(externalId: string, locale: string): Promise<ProviderMovie>
  getShow(externalId: string, locale: string): Promise<ProviderShow>
  getEpisode(
    showExternalId: string,
    seasonNumber: number,
    episodeNumber: number,
    locale: string,
  ): Promise<ProviderEpisode>
  /**
   * All episodes of one season in a single call, plus the season's own
   * synopsis (both come back on the same provider response — see
   * apps/api/src/routes/library.ts's season detail route, the only caller
   * that uses `overview`). Used by the Trakt importer
   * (apps/api/src/import/match.ts) instead of `getEpisode` per episode —
   * resolving a large history one episode at a time would mean thousands of
   * redundant calls for shows with many watched episodes.
   */
  getSeason(showExternalId: string, seasonNumber: number, locale: string): Promise<ProviderSeason>
}

export interface ProviderSeason {
  overview: string | null
  /** Provider's average rating for this one season, 0-10 — null if the
   * provider doesn't expose one / has no votes yet, same convention as
   * ProviderShow.voteAverage above. */
  voteAverage: number | null
  episodes: ProviderEpisode[]
}

export interface ProviderSearchResult {
  type: 'movie' | 'show'
  externalId: string
  title: string
  year: number | null
  overview: string | null
  posterPath: string | null
}

export interface ProviderMovie {
  externalId: string
  title: string
  year: number | null
  runtimeMinutes: number | null
  overview: string | null
  posterPath: string | null
  /** Provider's genre names verbatim (e.g. 'Drama', 'Animation'). Same
   * fixed-vocabulary reasoning as ProviderShow.genres — see
   * packages/db/src/schema.ts's `movies.genres` column. */
  genres: string[]
  /** Provider's average rating (TMDB: 0-10, one decimal place in their UI),
   * or null if the provider doesn't expose one / has no votes yet. Same
   * convention as ProviderShow.voteAverage. */
  voteAverage: number | null
}

export interface ProviderShow {
  externalId: string
  title: string
  year: number | null
  overview: string | null
  posterPath: string | null
  /** Provider's raw airing status (e.g. TMDB's 'Returning Series', 'Ended',
   * 'Canceled'), or null if the provider doesn't expose one. Drives how
   * often the metadata refresher re-fetches a show — see
   * apps/api/src/metadata/refresh.ts. */
  status: string | null
  /** Provider's genre names verbatim (e.g. 'Drama', 'Animation'). Backs the
   * shows gallery's genre filter panel — see packages/db/src/schema.ts's
   * `shows.genres` column. */
  genres: string[]
  /** Provider's average rating (TMDB: 0-10, one decimal place in their UI),
   * or null if the provider doesn't expose one / has no votes yet. */
  voteAverage: number | null
  /** Per-season episode counts, cached locally so the shows library gallery
   * can compute watched-progress without calling the provider — see
   * packages/db/src/schema.ts's `seasons` table. Excludes nothing itself;
   * callers decide whether to include season 0 (specials). */
  seasons: ProviderSeasonSummary[]
}

export interface ProviderSeasonSummary {
  seasonNumber: number
  name: string | null
  episodeCount: number
  airDate: string | null
  posterPath: string | null
}

export interface ProviderEpisode {
  title: string | null
  seasonNumber: number
  episodeNumber: number
  runtimeMinutes: number | null
  firstAired: string | null // YYYY-MM-DD
  /** Episode-level synopsis, or null if the provider has none yet (common
   * for unaired episodes). Not cached locally — see the season detail
   * route in apps/api/src/routes/library.ts, which fetches this live. */
  overview: string | null
  /** Episode thumbnail/still image, already a full URL — null if the
   * provider has none (again, common pre-air). */
  stillPath: string | null
  /** Provider's average rating for this one episode, 0-10 — null if the
   * provider doesn't expose one / has no votes yet, same convention as
   * ProviderShow.voteAverage. */
  voteAverage: number | null
}
