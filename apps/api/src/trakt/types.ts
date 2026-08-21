// Minimal shapes for the Trakt fields the importer actually uses — not the
// full API surface (same convention as apps/api/src/providers/tmdb.ts).

/** Present on every Trakt movie/show/episode/season object. */
export interface TraktIds {
  trakt: number
  slug?: string | null
  imdb?: string | null
  tmdb?: number | null
  tvdb?: number | null
}

export interface TraktMovie {
  title: string
  year: number | null
  ids: TraktIds
}

export interface TraktShow {
  title: string
  year: number | null
  ids: TraktIds
}

export interface TraktEpisode {
  season: number
  number: number
  title: string | null
  ids: TraktIds
}

export interface TraktSeason {
  number: number
  ids: TraktIds
}

/** One row of GET /sync/history. */
export interface TraktHistoryItem {
  id: number
  watched_at: string
  action: 'watch' | 'checkin' | 'scrobble'
  type: 'movie' | 'episode'
  movie?: TraktMovie
  show?: TraktShow
  episode?: TraktEpisode
}

/** One row of GET /sync/ratings. `type` also allows 'season', which rwnd.tv
 * has no local entity for — the importer records these as unmatched rather
 * than dropping them silently (see import/match.ts). */
export interface TraktRatingItem {
  rated_at: string
  rating: number
  type: 'movie' | 'show' | 'season' | 'episode'
  movie?: TraktMovie
  show?: TraktShow
  season?: TraktSeason
  episode?: TraktEpisode
}

/** One row of GET /sync/watchlist. Same `type` caveat as ratings above. */
export interface TraktWatchlistItem {
  listed_at: string
  type: 'movie' | 'show' | 'season' | 'episode'
  movie?: TraktMovie
  show?: TraktShow
  season?: TraktSeason
  episode?: TraktEpisode
}

/** One row of GET /users/hidden/dropped. Unlike ratings/watchlist, Trakt's
 * "drop" feature only ever applies to shows — no movie/season/episode
 * variant — so `type` is always 'show' here. */
export interface TraktHiddenItem {
  hidden_at: string
  type: 'show'
  show?: TraktShow
}

export interface TraktDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_url: string
  expires_in: number
  interval: number
}

export interface TraktTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope: string
  created_at: number
}

/** GET /users/settings — used to learn the connected account's username. */
export interface TraktSettingsResponse {
  user: { username: string }
}
