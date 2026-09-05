import type {
  MetadataProvider,
  ProviderEpisode,
  ProviderMovie,
  ProviderSeason,
  ProviderSearchResult,
  ProviderSeasonSummary,
  ProviderShow,
} from './types.js'
import { redactUrl } from '../lib/redact-url.js'

const POSTER_SIZE = 'w342'
// Episode stills are much smaller/wider than posters — TMDB's own web
// player uses w300 for the season episode-list thumbnails this mirrors.
const STILL_SIZE = 'w300'
const MAX_RETRY_AFTER_SECONDS = 60
// TMDB's release_dates 'type' values that count as a real theatrical
// release, most-specific-first isn't relevant here (earliestRegionalDate
// treats them as one pool) — 2 = Theatrical (limited), 3 = Theatrical.
const THEATRICAL_RELEASE_TYPES = [2, 3]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Guarded, not just truthiness-checked: this value is interpolated straight
// into a user-visible outbound URL (apps/web/src/lib/imdb.ts), and TMDB
// returns "" rather than null/absent for a title it has no IMDb id for.
// Every real IMDb title id is `tt` followed by digits; anything else isn't
// something we should be building a link out of.
function imdbIdOf(raw: string | null | undefined): string | null {
  return raw && /^tt\d+$/.test(raw) ? raw : null
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
  // Movies expose this at the top level even without append_to_response —
  // unlike shows/episodes, which only get it via TmdbExternalIds below.
  imdb_id?: string | null
  // Only present when requested via append_to_response=release_dates — see
  // getMovie() below.
  release_dates?: TmdbReleaseDates
}
// TMDB's per-region release dates, nested one level under the movie
// response when append_to_response=release_dates is requested. Each
// region can carry several typed entries (premiere, theatrical, digital,
// physical, ...) — see earliestRegionalDate() below for how these reduce
// to one date per region.
interface TmdbReleaseDates {
  results: TmdbRegionalRelease[]
}
interface TmdbRegionalRelease {
  iso_3166_1: string
  release_dates: TmdbTypedRelease[]
}
interface TmdbTypedRelease {
  // 1 Premiere, 2 Theatrical (limited), 3 Theatrical, 4 Digital,
  // 5 Physical, 6 TV — see THEATRICAL_RELEASE_TYPES below.
  type: number
  // Unlike the movie's own top-level release_date, this comes back as a
  // full ISO 8601 timestamp (e.g. '2026-03-12T00:00:00.000Z') — sliced to
  // its first 10 characters in earliestRegionalDate() rather than
  // re-parsed with `new Date()`, since it's a *local* calendar date and
  // re-parsing risks shifting it a day for anything not midnight UTC.
  // Same "" (not null/absent) quirk as air_date/the top-level
  // release_date — `||`, not `??`, wherever this is read.
  release_date?: string
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
  // Only present when requested via append_to_response=external_ids — see
  // getShow() below.
  external_ids?: TmdbExternalIds
}
// TMDB returns "" (not null, not absent) for a title it has no IMDb id
// for — see imdbIdOf() below, which normalizes that.
interface TmdbExternalIds {
  imdb_id?: string | null
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
  // Only present when requested via append_to_response=external_ids — see
  // getEpisode() below. Never present on an episode object nested inside a
  // /season response (getSeason() below never requests it, and TMDB
  // doesn't return per-episode external ids there regardless).
  external_ids?: TmdbExternalIds
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
// /find only returns id + media-type-specific fields we don't need — every
// other field on findByExternalId's result arrays is ignored.
interface TmdbFindResponse {
  movie_results: { id: number }[]
  tv_results: { id: number }[]
  // Some external ids identify a TV *episode*, not its show, even for
  // what looks like a show-level lookup — confirmed live 2026-08-24: a
  // Plex agent (nature-documentary content, at least) reports an
  // episode's own tmdb/imdb ids in the same place it would put a show's.
  // TMDB's /find still resolves these, just into this array instead of
  // tv_results. Checked *before* tv_results in findByExternalId below,
  // not just as a fallback when tv_results is empty — live-verified
  // 2026-09-02 that TMDB's own cross-reference data can have a genuinely
  // bad tv_results entry alongside a correct one here for the same
  // external id (see findByExternalId's own comment). Optional rather
  // than trusting it's always present on every response.
  tv_episode_results?: { show_id: number }[]
}

/** Thrown by request() for any non-2xx TMDB response. Carries the HTTP
 * status so callers that need to tell "not found" apart from other failures
 * (findByExternalId below) don't have to string-match the message. */
class TmdbHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TmdbHttpError'
  }
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

  /** One region's several typed release dates reduced to the single date
   * the Movies calendar feed shows: earliest theatrical release if this
   * region has one, else the earliest date of any type. Returns null only
   * when the region has no usable date at all (every entry empty/absent). */
  private earliestRegionalDate(entries: TmdbTypedRelease[]): string | null {
    const usable = entries
      .map((e) => e.release_date || '') // '', not null — see TmdbTypedRelease's comment
      .filter((date) => date.length >= 10)
      .map((date) => date.slice(0, 10))
    const theatrical = entries
      .filter((e) => THEATRICAL_RELEASE_TYPES.includes(e.type))
      .map((e) => e.release_date || '')
      .filter((date) => date.length >= 10)
      .map((date) => date.slice(0, 10))
    const pool = theatrical.length > 0 ? theatrical : usable
    // Lexicographic min on 'YYYY-MM-DD' is chronological min.
    return pool.length > 0 ? pool.sort()[0]! : null
  }

  /** Every region TMDB has any date for, each already reduced to one date
   * by earliestRegionalDate — see ProviderMovie.releaseDates' doc comment
   * for why this reduction happens here rather than storing the raw
   * per-region/per-type structure. */
  private reduceReleaseDates(releaseDates: TmdbReleaseDates | undefined): Record<string, string> {
    const result: Record<string, string> = {}
    for (const region of releaseDates?.results ?? []) {
      // Guards against a malformed/unexpected region code becoming a
      // jsonb key — every real TMDB iso_3166_1 is two uppercase letters.
      if (!/^[A-Z]{2}$/.test(region.iso_3166_1)) continue
      const date = this.earliestRegionalDate(region.release_dates)
      if (date !== null) result[region.iso_3166_1] = date
    }
    return result
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

    let res: Response
    try {
      res = await fetch(url)
    } catch {
      // A network-level failure (DNS, connection refused, ...) throws
      // whatever message/cause the underlying HTTP client attaches — not
      // this codebase's to fully control, and not guaranteed to never
      // mention the request URL. Deliberately discarded rather than
      // chained as `cause`, rethrown with a redacted URL instead, so
      // nothing from the original reaches a caller's log line (M3
      // security review, F-09) — TMDB's v3 API takes its key as a query
      // parameter (`api_key` above), unlike TVDB's Bearer header.
      throw new TmdbHttpError(0, `TMDB request failed: network error for ${redactUrl(url)}`)
    }

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
      throw new TmdbHttpError(
        res.status,
        `TMDB request failed: ${res.status} ${res.statusText} (${redactUrl(url)})`,
      )
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
    // external_ids is still deliberately not appended: movies already
    // carry imdb_id at the top level (verified live), so it would only
    // grow the payload of the highest-traffic provider call for a field
    // it already has. release_dates is different — it's genuinely absent
    // from the base /movie/{id} response, and a second request just for
    // it would double this endpoint's TMDB traffic and add a second
    // partial-failure mode (base OK, dates 429) refreshOneMovie has no
    // shape for; appending keeps one request, one retry path.
    const m = await this.request<TmdbMovie>(`/movie/${externalId}`, locale, {
      append_to_response: 'release_dates',
    })
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
      imdbId: imdbIdOf(m.imdb_id),
      // '', not null — same quirk imdb_id/air_date have.
      releaseDate: m.release_date || null,
      releaseDates: this.reduceReleaseDates(m.release_dates),
    }
  }

  async getShow(externalId: string, locale: string): Promise<ProviderShow> {
    // Unlike getMovie() above, the /tv endpoint has no top-level imdb_id —
    // append_to_response is the only way to get one (verified live).
    const s = await this.request<TmdbShow>(`/tv/${externalId}`, locale, {
      append_to_response: 'external_ids',
    })
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
      imdbId: imdbIdOf(s.external_ids?.imdb_id),
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
      { append_to_response: 'external_ids' },
    )
    return {
      title: e.name ?? null,
      seasonNumber: e.season_number,
      episodeNumber: e.episode_number,
      runtimeMinutes: e.runtime ?? null,
      // `||`, not `??` — TMDB can return an empty string for an unaired
      // episode's air_date, which would otherwise pass through as
      // `firstAired: ''` and fail the Postgres date cast when resolveSeason
      // (apps/api/src/lib/media.ts) writes it.
      firstAired: e.air_date || null,
      overview: e.overview ?? null,
      stillPath: this.stillUrl(e.still_path),
      voteAverage: e.vote_average ? e.vote_average : null,
      // TMDB's episode pages are addressed by number, not id — see
      // ProviderEpisode.externalId's doc comment.
      externalId: null,
      imdbId: imdbIdOf(e.external_ids?.imdb_id),
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
      // TMDB's season pages are addressed by number, not id — see
      // ProviderSeason.externalId's doc comment.
      externalId: null,
      episodes: s.episodes.map((e) => ({
        title: e.name ?? null,
        seasonNumber: e.season_number,
        episodeNumber: e.episode_number,
        runtimeMinutes: e.runtime ?? null,
        // `||`, not `??` — TMDB can return an empty string for an unaired
        // episode's air_date, which would otherwise pass through as
        // `firstAired: ''` and fail the Postgres date cast when
        // resolveSeason (apps/api/src/lib/media.ts) writes it.
        firstAired: e.air_date || null,
        overview: e.overview ?? null,
        stillPath: this.stillUrl(e.still_path),
        voteAverage: e.vote_average ? e.vote_average : null,
        externalId: null,
        // Always null here, unlike getEpisode() above: TMDB's /season
        // endpoint returns no external ids on its per-episode objects, and
        // append_to_response=external_ids on this path returns the
        // *season's* ids, not each episode's (verified live). A per-episode
        // IMDb id costs one /episode/{n} call each — which is why one is
        // fetched by its own route (routes/library/seasons.ts's
        // .../episodes/{n}/imdb) rather than folded into this bulk payload.
        imdbId: null,
      })),
    }
  }

  async findByExternalId(
    entityType: 'movie' | 'show',
    source: 'imdb' | 'tvdb',
    externalId: string,
    locale: string,
  ): Promise<string | null> {
    let data: TmdbFindResponse
    try {
      data = await this.request<TmdbFindResponse>(`/find/${externalId}`, locale, {
        external_source: source === 'imdb' ? 'imdb_id' : 'tvdb_id',
      })
    } catch (err) {
      // TMDB 404s a malformed or unrecognised external id rather than
      // returning empty result arrays — a per-item "no match" here, not a
      // request failure worth surfacing the way any other provider error is
      // (see request()'s own throw, and matchMovie/matchShow's handling of
      // it in apps/api/src/import/match.ts).
      if (err instanceof TmdbHttpError && err.status === 404) return null
      throw err
    }
    if (entityType === 'movie') {
      return data.movie_results[0] ? String(data.movie_results[0].id) : null
    }
    // Checked *before* tv_results, not after — live-verified 2026-09-02
    // against a real Plex webhook: TMDB's own external-id cross-reference
    // table can carry a genuinely bad entry that puts an unrelated show in
    // tv_results for the same external id that tv_episode_results
    // correctly identifies (TVDB id 411857 → tv_results: "Sisbro" (wrong),
    // tv_episode_results: "1990" S1E1 "Creed of Slaves", show_id 13380
    // (right) — confirmed directly against TMDB's live API). An episode
    // hit carries season/episode numbers that corroborate it, which a bare
    // tv_results id never does, so it's the more trustworthy signal
    // whenever both are present, not just when tv_results is empty.
    const episodeHit = data.tv_episode_results?.[0]
    if (episodeHit) return String(episodeHit.show_id)
    return data.tv_results[0] ? String(data.tv_results[0].id) : null
  }
}
