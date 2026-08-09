/**
 * Source of show/movie/episode metadata and artwork. TMDB is the only
 * implementation today (see ./tmdb.ts and docs/adr/0002), but nothing
 * outside this directory talks to TMDB directly — that's what keeps a
 * future Wikidata/TVDB adapter, or a self-hoster's own key policy, a
 * contained change. Every field returned here is already provider-neutral:
 * full poster URLs, plain numbers/strings, no TMDB-specific shapes leak out.
 */
export interface MetadataProvider {
  readonly source: 'tmdb'
  searchMulti(query: string, locale: string): Promise<ProviderSearchResult[]>
  getMovie(externalId: string, locale: string): Promise<ProviderMovie>
  getShow(externalId: string, locale: string): Promise<ProviderShow>
  getEpisode(
    showExternalId: string,
    seasonNumber: number,
    episodeNumber: number,
    locale: string,
  ): Promise<ProviderEpisode>
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
}

export interface ProviderShow {
  externalId: string
  title: string
  year: number | null
  overview: string | null
  posterPath: string | null
}

export interface ProviderEpisode {
  title: string | null
  seasonNumber: number
  episodeNumber: number
  runtimeMinutes: number | null
  firstAired: string | null // YYYY-MM-DD
}
