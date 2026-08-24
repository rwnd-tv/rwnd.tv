import type {
  MetadataProvider,
  ProviderEpisode,
  ProviderMovie,
  ProviderSeason,
  ProviderSearchResult,
  ProviderSeasonSummary,
  ProviderShow,
} from './types.js'

// TVDB's episode list is paginated at 500 items/page (this endpoint's own
// doc doesn't state a size, but it's TVDB's standard page size elsewhere in
// the v4 API). allEpisodes() below keeps fetching while a page comes back
// full and stops on the first short one — the usual offset-pagination
// signal, and one that doesn't depend on this endpoint's response actually
// carrying pagination links (its documented schema doesn't).
const TVDB_EPISODES_PAGE_SIZE = 500
// Backstop against an infinite loop if that detection is ever wrong for a
// pathological show (10,000+ episodes) — not expected to bite in practice.
const MAX_EPISODE_PAGES = 40

interface TvdbOptions {
  apiKey: string
  /** Only set for a free "user-supported" key — see env.ts. A commercial
   * key omits this entirely; the API treats a present-but-empty pin as an
   * error, not a no-op, so login() only includes the field when set. */
  pin?: string
  apiBaseUrl: string
}

// Minimal shapes for the TVDB fields we actually use — not the full API
// surface (see thetvdb/v4-api's swagger.yml for the rest).
interface TvdbSearchResult {
  type?: string
  tvdb_id?: string
  name?: string
  overview?: string
  // Keyed by 3-letter language code, e.g. "eng" — see tvdbLanguage() below.
  translations?: Record<string, string>
  overviews?: Record<string, string>
  image_url?: string
  year?: string
}
interface TvdbGenre {
  name: string
}
interface TvdbStatus {
  name?: string | null
}
interface TvdbSeasonType {
  type?: string
}
interface TvdbSeasonSummary {
  id: number
  number: number
  name?: string | null
  image?: string | null
  type?: TvdbSeasonType
}
interface TvdbMovie {
  id: number
  name: string
  year?: string
  runtime?: number | null
  image?: string | null
  genres?: TvdbGenre[]
}
interface TvdbSeries {
  id: number
  name: string
  year?: string
  overview?: string | null
  image?: string | null
  status?: TvdbStatus | null
  genres?: TvdbGenre[]
  seasons?: TvdbSeasonSummary[]
}
interface TvdbEpisode {
  id: number
  name?: string | null
  number: number
  seasonNumber: number
  runtime?: number | null
  aired?: string | null
  overview?: string | null
  image?: string | null
}
interface TvdbEpisodesPage {
  episodes?: TvdbEpisode[]
}
interface TvdbTranslation {
  name?: string
  overview?: string
}
// /search/remoteid only returns the matched entity's own base record —
// every other field on TvdbRemoteIdMatch is ignored.
interface TvdbRemoteIdMatch {
  movie?: { id: number }
  series?: { id: number }
}

/** Maps this app's BCP 47 locale to TheTVDB's 3-letter ISO 639-2 language
 * code. TVDB's translations don't distinguish English variants the way
 * TMDB's `en-GB` vs `en-US` does, so both of this app's current locales
 * (see apps/web/src/i18n/locales) map to the same "eng" — kept as a real
 * lookup table, not a bare constant, so a future non-English locale is a
 * one-line addition here rather than a find-every-call-site change.
 */
const LANGUAGE_BY_LOCALE: Record<string, string> = {
  'en-GB': 'eng',
  'en-US': 'eng',
}

function tvdbLanguage(locale: string): string {
  return LANGUAGE_BY_LOCALE[locale] ?? 'eng'
}

/** Thrown by request()/login() for any non-2xx TVDB response. Carries the
 * HTTP status so callers that need to tell "not found" apart from other
 * failures (findByExternalId, translation() below) don't have to
 * string-match the message. */
export class TvdbHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TvdbHttpError'
  }
}

/**
 * TheTVDB v4 API. Unlike TMDB, every call needs a bearer token obtained via
 * a separate /login exchange (apikey [+ pin] -> a JWT valid for one month —
 * see the API's own login description) rather than a per-request api_key
 * query param, so this class caches the token in memory and re-logs-in
 * lazily on a 401 rather than tracking the JWT's expiry itself.
 *
 * TVDB's "score" field (movies/series) is an internal popularity ranking,
 * not a comparable 0-10 audience rating like TMDB's vote_average — the API
 * docs explicitly warn against assuming a meaning for it — so this provider
 * never populates voteAverage; every ProviderMovie/ProviderShow/
 * ProviderEpisode/ProviderSeason it returns has voteAverage: null.
 */
export class TvdbProvider implements MetadataProvider {
  readonly source = 'tvdb' as const

  private token: string | null = null
  private loginPromise: Promise<string> | null = null

  constructor(private readonly options: TvdbOptions) {}

  private async login(): Promise<string> {
    const body: Record<string, string> = { apikey: this.options.apiKey }
    if (this.options.pin) body.pin = this.options.pin

    const res = await fetch(`${this.options.apiBaseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new TvdbHttpError(res.status, `TVDB login failed: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as { data: { token: string } }
    this.token = json.data.token
    return this.token
  }

  /** getShow/getMovie/getSeason each fire off several request() calls at
   * once via Promise.all — without sharing the in-flight login, each would
   * independently see `this.token === null` on a cold cache and fire its
   * own redundant /login call. Callers all await the same promise instead,
   * so exactly one login happens per cold start (or post-401 re-login),
   * however many requests are racing to use it. */
  private ensureToken(): Promise<string> {
    if (this.token) return Promise.resolve(this.token)
    this.loginPromise ??= this.login().finally(() => {
      this.loginPromise = null
    })
    return this.loginPromise
  }

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
    isRetry = false,
  ): Promise<T> {
    const token = await this.ensureToken()
    const url = new URL(this.options.apiBaseUrl + path)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

    if (res.status === 401 && !isRetry) {
      // The cached token expired (or was never valid) — force a fresh
      // login and retry exactly once. A second 401 means the credentials
      // themselves are bad, which surfaces to the caller rather than
      // looping.
      this.token = null
      return this.request<T>(path, params, true)
    }
    if (!res.ok) {
      throw new TvdbHttpError(
        res.status,
        `TVDB request failed: ${res.status} ${res.statusText} (${path})`,
      )
    }
    const json = (await res.json()) as { data: T }
    return json.data
  }

  /** A translated name/overview for one entity, or null if TVDB has no
   * translation in this language (a 404, common for less widely covered
   * titles/seasons) rather than an error. */
  private async translation(
    entity: 'movies' | 'series' | 'seasons',
    id: string,
    locale: string,
  ): Promise<TvdbTranslation | null> {
    try {
      return await this.request<TvdbTranslation>(
        `/${entity}/${id}/translations/${tvdbLanguage(locale)}`,
      )
    } catch (err) {
      if (err instanceof TvdbHttpError && err.status === 404) return null
      throw err
    }
  }

  /** Every episode of a series under its "default" (aired) season type,
   * paginating until a short/empty page signals the end. Used to derive
   * getShow()'s per-season episode counts and air dates — TVDB's season
   * summary record carries neither (unlike TMDB's), so they're computed
   * locally from the full episode list instead. */
  private async allEpisodes(showId: string): Promise<TvdbEpisode[]> {
    const episodes: TvdbEpisode[] = []
    for (let page = 0; page < MAX_EPISODE_PAGES; page++) {
      const data = await this.request<TvdbEpisodesPage>(`/series/${showId}/episodes/default`, {
        page: String(page),
      })
      const batch = data.episodes ?? []
      episodes.push(...batch)
      if (batch.length < TVDB_EPISODES_PAGE_SIZE) break
    }
    return episodes
  }

  private yearOf(year: string | undefined): number | null {
    if (!year) return null
    const n = Number.parseInt(year, 10)
    return Number.isNaN(n) ? null : n
  }

  async searchMulti(query: string, locale: string): Promise<ProviderSearchResult[]> {
    const results = await this.request<TvdbSearchResult[]>('/search', { query })
    const lang = tvdbLanguage(locale)
    return results
      .filter((r): r is TvdbSearchResult & { tvdb_id: string } =>
        Boolean((r.type === 'movie' || r.type === 'series') && r.tvdb_id),
      )
      .map((r): ProviderSearchResult => ({
        type: r.type === 'movie' ? 'movie' : 'show',
        externalId: r.tvdb_id,
        title: r.translations?.[lang] ?? r.name ?? 'Untitled',
        year: this.yearOf(r.year),
        overview: r.overviews?.[lang] ?? r.overview ?? null,
        posterPath: r.image_url ?? null,
      }))
  }

  async getMovie(externalId: string, locale: string): Promise<ProviderMovie> {
    const [movie, translation] = await Promise.all([
      this.request<TvdbMovie>(`/movies/${externalId}/extended`, { short: 'true' }),
      this.translation('movies', externalId, locale),
    ])
    return {
      externalId: String(movie.id),
      title: translation?.name ?? movie.name,
      year: this.yearOf(movie.year),
      runtimeMinutes: movie.runtime ?? null,
      overview: translation?.overview ?? null,
      posterPath: movie.image ?? null,
      genres: (movie.genres ?? []).map((g) => g.name),
      voteAverage: null,
    }
  }

  async getShow(externalId: string, locale: string): Promise<ProviderShow> {
    const [show, translation, episodes] = await Promise.all([
      this.request<TvdbSeries>(`/series/${externalId}/extended`, { short: 'true' }),
      this.translation('series', externalId, locale),
      this.allEpisodes(externalId),
    ])

    const bySeason = new Map<number, { count: number; earliestAired: string | null }>()
    for (const ep of episodes) {
      const entry = bySeason.get(ep.seasonNumber) ?? { count: 0, earliestAired: null }
      entry.count += 1
      if (ep.aired && (!entry.earliestAired || ep.aired < entry.earliestAired)) {
        entry.earliestAired = ep.aired
      }
      bySeason.set(ep.seasonNumber, entry)
    }

    return {
      externalId: String(show.id),
      title: translation?.name ?? show.name,
      year: this.yearOf(show.year),
      overview: translation?.overview ?? show.overview ?? null,
      posterPath: show.image ?? null,
      status: show.status?.name ?? null,
      genres: (show.genres ?? []).map((g) => g.name),
      voteAverage: null,
      seasons: (show.seasons ?? [])
        .filter((s) => s.type?.type === 'default')
        .map((s): ProviderSeasonSummary => {
          const derived = bySeason.get(s.number)
          return {
            seasonNumber: s.number,
            name: s.name ?? null,
            episodeCount: derived?.count ?? 0,
            airDate: derived?.earliestAired ?? null,
            posterPath: s.image ?? null,
          }
        }),
    }
  }

  async getEpisode(
    showExternalId: string,
    seasonNumber: number,
    episodeNumber: number,
    // TVDB's episode-list endpoint has no per-request language param (only
    // /episodes/{id}/translations/{lang}, which needs the episode's own
    // internal id — an extra call this single-episode lookup doesn't make).
    // Its base episode record already carries primary-language text, which
    // for English-original shows is already English — see getMovie/getShow
    // above for the entities that do fetch a real translation.
    _locale: string,
  ): Promise<ProviderEpisode> {
    const data = await this.request<TvdbEpisodesPage>(
      `/series/${showExternalId}/episodes/default`,
      {
        season: String(seasonNumber),
        episodeNumber: String(episodeNumber),
        page: '0',
      },
    )
    const episode = data.episodes?.[0]
    if (!episode) {
      throw new TvdbHttpError(
        404,
        `TVDB episode S${seasonNumber}E${episodeNumber} not found for series ${showExternalId}`,
      )
    }
    return {
      title: episode.name ?? null,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.number,
      runtimeMinutes: episode.runtime ?? null,
      firstAired: episode.aired ?? null,
      overview: episode.overview ?? null,
      stillPath: episode.image ?? null,
      voteAverage: null,
    }
  }

  async getSeason(
    showExternalId: string,
    seasonNumber: number,
    locale: string,
  ): Promise<ProviderSeason> {
    const [show, episodesPage] = await Promise.all([
      this.request<TvdbSeries>(`/series/${showExternalId}/extended`, { short: 'true' }),
      this.request<TvdbEpisodesPage>(`/series/${showExternalId}/episodes/default`, {
        season: String(seasonNumber),
        page: '0',
      }),
    ])
    const season = (show.seasons ?? []).find(
      (s) => s.number === seasonNumber && s.type?.type === 'default',
    )
    const translation = season ? await this.translation('seasons', String(season.id), locale) : null

    return {
      overview: translation?.overview ?? null,
      voteAverage: null,
      episodes: (episodesPage.episodes ?? []).map((e) => ({
        title: e.name ?? null,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.number,
        runtimeMinutes: e.runtime ?? null,
        firstAired: e.aired ?? null,
        overview: e.overview ?? null,
        stillPath: e.image ?? null,
        voteAverage: null,
      })),
    }
  }

  async findByExternalId(
    entityType: 'movie' | 'show',
    // TVDB's remote-id search auto-detects the source system from the id's
    // own shape (an imdb "tt..." id vs. another provider's numeric id) —
    // it doesn't need to be told which one it is.
    _source: 'imdb' | 'tvdb',
    externalId: string,
    _locale: string,
  ): Promise<string | null> {
    let matches: TvdbRemoteIdMatch[]
    try {
      matches = await this.request<TvdbRemoteIdMatch[]>(
        `/search/remoteid/${encodeURIComponent(externalId)}`,
      )
    } catch (err) {
      // Documented as returning an empty array for no match, but a
      // malformed id may 404 rather than doing that — treated the same as
      // TmdbProvider treats its own /find 404s: a per-item "no match", not
      // a request failure worth surfacing.
      if (err instanceof TvdbHttpError && err.status === 404) return null
      throw err
    }
    for (const match of matches) {
      if (entityType === 'movie' && match.movie) return String(match.movie.id)
      if (entityType === 'show' && match.series) return String(match.series.id)
    }
    return null
  }
}
