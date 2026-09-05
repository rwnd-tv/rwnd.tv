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
   * apps/api/src/routes/library/seasons.ts's season detail route, the only caller
   * that uses `overview`). Used by the Trakt importer
   * (apps/api/src/import/match.ts) instead of `getEpisode` per episode —
   * resolving a large history one episode at a time would mean thousands of
   * redundant calls for shows with many watched episodes.
   */
  getSeason(showExternalId: string, seasonNumber: number, locale: string): Promise<ProviderSeason>
  /**
   * This provider's own id for an entity known only by another system's id
   * — Trakt hands out imdb/tvdb ids alongside tmdb ones, and its tmdb field
   * is frequently null or stale even when this provider does hold a
   * matching entry (apps/api/src/import/match.ts). Returns the provider's
   * id string, not a full entity, so callers hand straight off to
   * resolveMovie/resolveShow rather than duplicating their
   * insert-and-link logic. Null when this provider has no reverse lookup
   * for the given source, or genuinely has no match — callers can't and
   * shouldn't tell those apart.
   */
  findByExternalId(
    entityType: 'movie' | 'show',
    source: 'imdb' | 'tvdb',
    externalId: string,
    locale: string,
  ): Promise<string | null>
}

export interface ProviderSeason {
  overview: string | null
  /** Provider's average rating for this one season, 0-10 — null if the
   * provider doesn't expose one / has no votes yet, same convention as
   * ProviderShow.voteAverage above. */
  voteAverage: number | null
  /** This provider's own internal id for this season, distinct from
   * seasonNumber — only meaningful for a provider whose own website needs
   * an id (not a number) to link to a specific season page, e.g. TVDB's
   * thetvdb.com/dereferrer/season/{id}. TMDB's season pages are
   * number-addressed and have no use for this, so TmdbProvider always
   * returns null here. */
  externalId: string | null
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
  /** This entity's IMDb id (`tt…`), for the "View on IMDb" deep link — an
   * id namespace, never a fetch source (docs/adr/0006), so this is the
   * only IMDb-shaped field anywhere in this interface. Null if the
   * provider has none on record. Required, not optional, same reasoning
   * as ProviderSeason.externalId: a provider that can't supply one must
   * say so explicitly rather than the field being silently absent. */
  imdbId: string | null
  /** Primary release date ('YYYY-MM-DD'), or null if the provider has
   * none. Required, not optional — same convention as imdbId above; a
   * provider with no concept of a release date (TVDB) says so explicitly
   * with null rather than omitting the field. */
  releaseDate: string | null
  /** Per-region release dates, ISO 3166-1 alpha-2 → 'YYYY-MM-DD', already
   * reduced to one date per region (earliest theatrical release, else
   * earliest of any type — see TmdbProvider.earliestRegionalDate). Null
   * means this provider has no concept of regional release dates at all
   * (TVDB); an empty object means it does, and had none for this title.
   * That null/empty distinction is load-bearing for the metadata
   * refresher's negative cache — see packages/db/src/schema.ts's
   * `movies.releaseDates` doc comment. */
  releaseDates: Record<string, string> | null
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
  /** See ProviderMovie.imdbId — same convention, same field, applies to a
   * show as a whole rather than one episode. */
  imdbId: string | null
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
   * route in apps/api/src/routes/library/seasons.ts, which fetches this live. */
  overview: string | null
  /** Episode thumbnail/still image, already a full URL — null if the
   * provider has none (again, common pre-air). */
  stillPath: string | null
  /** Provider's average rating for this one episode, 0-10 — null if the
   * provider doesn't expose one / has no votes yet, same convention as
   * ProviderShow.voteAverage. */
  voteAverage: number | null
  /** This provider's own internal id for this episode — see
   * ProviderSeason.externalId for the same convention
   * (thetvdb.com/dereferrer/episode/{id}). TmdbProvider always returns
   * null here. */
  externalId: string | null
  /** See ProviderMovie.imdbId. Only ever populated when this episode was
   * fetched via getEpisode — getSeason's episodes always return null here,
   * since TMDB's season endpoint carries no per-episode external ids (see
   * TmdbProvider.getSeason's own comment). That's the whole reason episode
   * IMDb ids get their own lazily-fetched route rather than riding along
   * with the season payload. */
  imdbId: string | null
}
