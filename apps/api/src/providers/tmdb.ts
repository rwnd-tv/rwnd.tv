import type {
  MetadataProvider,
  ProviderEpisode,
  ProviderMovie,
  ProviderSearchResult,
  ProviderShow,
} from './types.js'

const POSTER_SIZE = 'w342'

interface TmdbOptions {
  apiKey: string
  apiBaseUrl: string
  imageBaseUrl: string
}

// Minimal shapes for the TMDB fields we actually use — not the full API surface.
interface TmdbSearchResult {
  media_type?: string
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  overview?: string | null
  poster_path?: string | null
}
interface TmdbSearchResponse {
  results: TmdbSearchResult[]
}
interface TmdbMovie {
  id: number
  title: string
  release_date?: string
  runtime?: number | null
  overview?: string | null
  poster_path?: string | null
}
interface TmdbShow {
  id: number
  name: string
  first_air_date?: string
  overview?: string | null
  poster_path?: string | null
}
interface TmdbEpisode {
  name?: string | null
  season_number: number
  episode_number: number
  runtime?: number | null
  air_date?: string | null
}
interface TmdbSeason {
  episodes: TmdbEpisode[]
}

/**
 * TMDB terms require attribution (see README/UI footer) and forbid caching
 * results for longer than 6 months — enforced by `metadata_refreshed_at` on
 * the movies/shows tables, not by this class.
 */
export class TmdbProvider implements MetadataProvider {
  readonly source = 'tmdb' as const

  constructor(private readonly options: TmdbOptions) {}

  private posterUrl(path: string | null | undefined): string | null {
    return path ? `${this.options.imageBaseUrl}/${POSTER_SIZE}${path}` : null
  }

  private yearOf(date: string | undefined): number | null {
    if (!date) return null
    const year = Number.parseInt(date.slice(0, 4), 10)
    return Number.isNaN(year) ? null : year
  }

  private async request<T>(path: string, locale: string, params: Record<string, string> = {}) {
    const url = new URL(this.options.apiBaseUrl + path)
    url.searchParams.set('api_key', this.options.apiKey)
    url.searchParams.set('language', locale)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${path})`)
    }
    return (await res.json()) as T
  }

  async searchMulti(query: string, locale: string): Promise<ProviderSearchResult[]> {
    const data = await this.request<TmdbSearchResponse>('/search/multi', locale, { query })
    return data.results
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r): ProviderSearchResult => {
        const isMovie = r.media_type === 'movie'
        return {
          type: isMovie ? 'movie' : 'show',
          externalId: String(r.id),
          title: (isMovie ? r.title : r.name) ?? 'Untitled',
          year: this.yearOf(isMovie ? r.release_date : r.first_air_date),
          overview: r.overview ?? null,
          posterPath: this.posterUrl(r.poster_path),
        }
      })
  }

  async getMovie(externalId: string, locale: string): Promise<ProviderMovie> {
    const m = await this.request<TmdbMovie>(`/movie/${externalId}`, locale)
    return {
      externalId: String(m.id),
      title: m.title,
      year: this.yearOf(m.release_date),
      runtimeMinutes: m.runtime ?? null,
      overview: m.overview ?? null,
      posterPath: this.posterUrl(m.poster_path),
    }
  }

  async getShow(externalId: string, locale: string): Promise<ProviderShow> {
    const s = await this.request<TmdbShow>(`/tv/${externalId}`, locale)
    return {
      externalId: String(s.id),
      title: s.name,
      year: this.yearOf(s.first_air_date),
      overview: s.overview ?? null,
      posterPath: this.posterUrl(s.poster_path),
    }
  }

  async getEpisode(
    showExternalId: string,
    seasonNumber: number,
    episodeNumber: number,
    locale: string,
  ): Promise<ProviderEpisode> {
    const e = await this.request<TmdbEpisode>(
      `/tv/${showExternalId}/season/${seasonNumber}/episode/${episodeNumber}`,
      locale,
    )
    return {
      title: e.name ?? null,
      seasonNumber: e.season_number,
      episodeNumber: e.episode_number,
      runtimeMinutes: e.runtime ?? null,
      firstAired: e.air_date ?? null,
    }
  }

  async getSeason(
    showExternalId: string,
    seasonNumber: number,
    locale: string,
  ): Promise<ProviderEpisode[]> {
    const s = await this.request<TmdbSeason>(`/tv/${showExternalId}/season/${seasonNumber}`, locale)
    return s.episodes.map((e) => ({
      title: e.name ?? null,
      seasonNumber: e.season_number,
      episodeNumber: e.episode_number,
      runtimeMinutes: e.runtime ?? null,
      firstAired: e.air_date ?? null,
    }))
  }
}
