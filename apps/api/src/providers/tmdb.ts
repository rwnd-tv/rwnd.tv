import type {
  MetadataProvider,
  ProviderEpisode,
  ProviderMovie,
  ProviderSeason,
  ProviderSearchResult,
  ProviderSeasonSummary,
  ProviderShow,
} from './types.js'

const POSTER_SIZE = 'w342'
// Episode stills are much smaller/wider than posters — TMDB's own web
// player uses w300 for the season episode-list thumbnails this mirrors.
const STILL_SIZE = 'w300'
const MAX_RETRY_AFTER_SECONDS = 60

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
  genres?: TmdbGenre[]
  vote_average?: number | null
  vote_count?: number
}
interface TmdbShow {
  id: number
  name: string
  first_air_date?: string
  overview?: string | null
  poster_path?: string | null
  status?: string | null
  genres?: TmdbGenre[]
  seasons?: TmdbSeasonSummary[]
  vote_average?: number | null
  vote_count?: number
}
interface TmdbGenre {
  id: number
  name: string
}
interface TmdbSeasonSummary {
  season_number: number
  name?: string | null
  episode_count?: number
  air_date?: string | null
  poster_path?: string | null
}
interface TmdbEpisode {
  name?: string | null
  season_number: number
  episode_number: number
  runtime?: number | null
  air_date?: string | null
  overview?: string | null
  still_path?: string | null
  // Same "0 means unrated" quirk as the season/show-level fields — see
  // TmdbSeason's vote_average comment below.
  vote_average?: number | null
}
interface TmdbSeason {
  overview?: string | null
  episodes: TmdbEpisode[]
  // TMDB returns vote_average: 0 for a season with no votes yet, same as
  // the show-level field — but unlike the show endpoint, the season one
  // carries no vote_count to disambiguate a genuine 0 from "unrated", so
  // 0 is treated as "no rating" outright (see getSeason() below).
  vote_average?: number | null
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

  private stillUrl(path: string | null | undefined): string | null {
    return path ? `${this.options.imageBaseUrl}/${STILL_SIZE}${path}` : null
  }

  private yearOf(date: string | undefined): number | null {
    if (!date) return null
    const year = Number.parseInt(date.slice(0, 4), 10)
    return Number.isNaN(year) ? null : year
  }

  private async request<T>(
    path: string,
    locale: string,
    params: Record<string, string> = {},
    isRetry = false,
  ): Promise<T> {
    const url = new URL(this.options.apiBaseUrl + path)
    url.searchParams.set('api_key', this.options.apiKey)
    url.searchParams.set('language', locale)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const res = await fetch(url)

    if (res.status === 429 && !isRetry) {
      // TMDB doesn't document a fixed rate limit today (the old 40-per-10s
      // cap was disabled in 2019), but their CDN still enforces one under
      // load. Retry once, honouring Retry-After when present; a second 429
      // is surfaced to the caller rather than looped on indefinitely. This
      // matters more now than at launch: the metadata refresher
      // (apps/api/src/metadata/refresh.ts) makes unattended bursts of these
      // calls, unlike the user-initiated search/import paths.
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '5', 10)
      await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000)
      return this.request<T>(path, locale, params, true)
    }

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
      genres: (m.genres ?? []).map((g) => g.name),
      // TMDB returns vote_average: 0 for a movie with zero votes, not null —
      // treated as "no rating" here rather than a real 0/10, same as
      // getShow() does for the same quirk.
      voteAverage: m.vote_count ? (m.vote_average ?? null) : null,
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
      status: s.status ?? null,
      genres: (s.genres ?? []).map((g) => g.name),
      // TMDB returns vote_average: 0 for a show with zero votes, not null —
      // treated as "no rating" here rather than a real 0/10, same as this
      // function already does for other absent-vs-empty provider fields.
      voteAverage: s.vote_count ? (s.vote_average ?? null) : null,
      seasons: (s.seasons ?? []).map((season): ProviderSeasonSummary => ({
        seasonNumber: season.season_number,
        name: season.name ?? null,
        episodeCount: season.episode_count ?? 0,
        airDate: season.air_date ?? null,
        posterPath: this.posterUrl(season.poster_path),
      })),
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
      overview: e.overview ?? null,
      stillPath: this.stillUrl(e.still_path),
      voteAverage: e.vote_average ? e.vote_average : null,
    }
  }

  async getSeason(
    showExternalId: string,
    seasonNumber: number,
    locale: string,
  ): Promise<ProviderSeason> {
    const s = await this.request<TmdbSeason>(`/tv/${showExternalId}/season/${seasonNumber}`, locale)
    return {
      overview: s.overview ?? null,
      voteAverage: s.vote_average ? s.vote_average : null,
      episodes: s.episodes.map((e) => ({
        title: e.name ?? null,
        seasonNumber: e.season_number,
        episodeNumber: e.episode_number,
        runtimeMinutes: e.runtime ?? null,
        firstAired: e.air_date ?? null,
        overview: e.overview ?? null,
        stillPath: this.stillUrl(e.still_path),
        voteAverage: e.vote_average ? e.vote_average : null,
      })),
    }
  }
}
