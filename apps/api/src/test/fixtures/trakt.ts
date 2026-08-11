import type {
  TraktDeviceCodeResponse,
  TraktHistoryItem,
  TraktRatingItem,
  TraktSettingsResponse,
  TraktShow,
  TraktTokenResponse,
  TraktWatchlistItem,
} from '../../trakt/types.js'

// Fixed Trakt/TMDB ids reused across fixtures so tests can assert on them.
export const MATRIX_TRAKT_ID = 1
export const MATRIX_TMDB_ID = 603
export const BREAKING_BAD_SHOW_TRAKT_ID = 2
export const BREAKING_BAD_SHOW_TMDB_ID = 1396
export const BREAKING_BAD_SHOW_TVDB_ID = 81189
export const PILOT_EPISODE_TRAKT_ID = 3
export const SECOND_EPISODE_TRAKT_ID = 4
export const OBSCURE_MOVIE_TRAKT_ID = 5
export const SEASON_WATCHLIST_SHOW_TRAKT_ID = 6

export const deviceCodeResponse: TraktDeviceCodeResponse = {
  device_code: 'test-device-code',
  user_code: 'TEST-CODE',
  verification_url: 'https://trakt.tv/activate',
  // interval: 0 and a short expiry keep the pairing poll loop
  // (routes/imports.ts) fast and deterministic in tests — real timers are
  // used, but sleep(0 * 1000) resolves on the next tick.
  expires_in: 60,
  interval: 0,
}

export const tokenResponse: TraktTokenResponse = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 604_800,
  token_type: 'bearer',
  scope: 'public',
  created_at: Math.floor(Date.now() / 1000),
}

export const settingsResponse: TraktSettingsResponse = {
  user: { username: 'trakt-test-user' },
}

export const matrixHistoryItem: TraktHistoryItem = {
  id: 101,
  watched_at: '2024-01-01T12:00:00.000Z',
  action: 'watch',
  type: 'movie',
  movie: {
    title: 'The Matrix',
    year: 1999,
    ids: {
      trakt: MATRIX_TRAKT_ID,
      slug: 'the-matrix-1999',
      imdb: 'tt0133093',
      tmdb: MATRIX_TMDB_ID,
    },
  },
}

export const pilotHistoryItem: TraktHistoryItem = {
  id: 102,
  watched_at: '2024-01-02T12:00:00.000Z',
  action: 'watch',
  type: 'episode',
  show: {
    title: 'Breaking Bad',
    year: 2008,
    ids: {
      trakt: BREAKING_BAD_SHOW_TRAKT_ID,
      slug: 'breaking-bad',
      imdb: 'tt0903747',
      tmdb: BREAKING_BAD_SHOW_TMDB_ID,
      tvdb: BREAKING_BAD_SHOW_TVDB_ID,
    },
  },
  episode: {
    season: 1,
    number: 1,
    title: 'Pilot',
    ids: { trakt: PILOT_EPISODE_TRAKT_ID, imdb: 'tt0959621', tmdb: 62085 },
  },
}

/** Same show/season as `pilotHistoryItem`, second episode — used to assert
 * provider.getSeason() is only called once per season, not once per
 * episode (apps/api/src/import/match.ts). */
export const secondEpisodeHistoryItem: TraktHistoryItem = {
  id: 103,
  watched_at: '2024-01-03T12:00:00.000Z',
  action: 'watch',
  type: 'episode',
  show: pilotHistoryItem.show,
  episode: {
    season: 1,
    number: 2,
    title: "Cat's in the Bag...",
    ids: { trakt: SECOND_EPISODE_TRAKT_ID, imdb: 'tt1054724', tmdb: 62086 },
  },
}

/** Carries a `tmdb` id, but TMDB itself 404s on it (a merged/deleted
 * title) — the importer must record this as a failure and keep going,
 * not let the whole job die on one bad id. */
export const TMDB_DELETED_MOVIE_ID = 327805
export const tmdbDeletedMovieHistoryItem: TraktHistoryItem = {
  id: 105,
  watched_at: '2024-01-07T12:00:00.000Z',
  action: 'watch',
  type: 'movie',
  movie: {
    title: 'A Title TMDB No Longer Has',
    year: 2015,
    ids: { trakt: 7, slug: 'gone-from-tmdb', imdb: 'tt9999999', tmdb: TMDB_DELETED_MOVIE_ID },
  },
}

/** A show whose TMDB lookup 404s. Two episodes of it, sharing the same
 * `show` object, are used to assert that the *show* resolution failure is
 * cached per job — without that, every episode of an unresolvable show
 * independently retries the same failing TMDB request (found live: one
 * such show accounted for 200+ redundant failures on a real import). */
export const TMDB_DELETED_SHOW_ID = 888888
const undeadShow: TraktShow = {
  title: 'A Show TMDB No Longer Has',
  year: 2016,
  ids: { trakt: 8, slug: 'gone-show', imdb: null, tmdb: TMDB_DELETED_SHOW_ID },
}
export const undeadShowHistoryItem1: TraktHistoryItem = {
  id: 106,
  watched_at: '2024-01-08T12:00:00.000Z',
  action: 'watch',
  type: 'episode',
  show: undeadShow,
  episode: { season: 1, number: 1, title: null, ids: { trakt: 801, imdb: null, tmdb: null } },
}
export const undeadShowHistoryItem2: TraktHistoryItem = {
  id: 107,
  watched_at: '2024-01-09T12:00:00.000Z',
  action: 'watch',
  type: 'episode',
  show: undeadShow,
  episode: { season: 1, number: 2, title: null, ids: { trakt: 802, imdb: null, tmdb: null } },
}

/**
 * Deliberately malformed — `ids` is missing entirely. Trakt responses
 * aren't runtime-validated at the HTTP boundary (no zod parse), so a
 * malformed response is a real possibility, and it throws from a place
 * import/match.ts's provider-error try/catches don't cover (reading
 * `.trakt` off `ids` happens before any of those). Used to assert
 * apps/api/src/import/trakt.ts's per-item catch survives errors it didn't
 * anticipate, not just TMDB ones.
 */
export const malformedHistoryItem: TraktHistoryItem = {
  id: 108,
  watched_at: '2024-01-10T12:00:00.000Z',
  action: 'watch',
  type: 'movie',
  movie: {
    title: 'Malformed Movie',
    year: null,
    ids: undefined,
  } as unknown as TraktHistoryItem['movie'],
}

/** No TMDB id and nothing already matched locally — the importer can't
 * resolve this and must record it as a failure, not throw or silently
 * drop it. */
export const unmatchedHistoryItem: TraktHistoryItem = {
  id: 104,
  watched_at: '2024-01-04T12:00:00.000Z',
  action: 'watch',
  type: 'movie',
  movie: {
    title: 'Some Obscure Film',
    year: 2020,
    ids: { trakt: OBSCURE_MOVIE_TRAKT_ID, slug: 'some-obscure-film', imdb: null, tmdb: null },
  },
}

export function matrixRatingItem(rating: number): TraktRatingItem {
  return {
    rated_at: '2024-01-01T00:00:00.000Z',
    rating,
    type: 'movie',
    movie: matrixHistoryItem.movie,
  }
}

export const matrixWatchlistItem: TraktWatchlistItem = {
  listed_at: '2024-01-05T00:00:00.000Z',
  type: 'movie',
  movie: matrixHistoryItem.movie,
}

/** `metadata_entity_type` has no 'season' value — rwnd.tv has nowhere to
 * put this, so it must be reported unmatched rather than inserted as
 * something else. */
export const seasonWatchlistItem: TraktWatchlistItem = {
  listed_at: '2024-01-06T00:00:00.000Z',
  type: 'season',
  show: {
    title: 'Some Other Show',
    year: 2015,
    ids: { trakt: SEASON_WATCHLIST_SHOW_TRAKT_ID, slug: 'some-other-show', imdb: null, tmdb: 9999 },
  },
  season: { number: 1, ids: { trakt: 777 } },
}

export const tmdbMatrixMovie = {
  id: MATRIX_TMDB_ID,
  title: 'The Matrix',
  release_date: '1999-03-30',
  runtime: 136,
  overview: 'A hacker learns the truth.',
  poster_path: '/matrix.jpg',
}

export const tmdbBreakingBadShow = {
  id: BREAKING_BAD_SHOW_TMDB_ID,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  overview: 'A chemistry teacher turns to crime.',
  poster_path: '/breaking-bad.jpg',
}

export const tmdbBreakingBadSeason1 = {
  episodes: [
    {
      name: 'Pilot',
      season_number: 1,
      episode_number: 1,
      runtime: 58,
      air_date: '2008-01-20',
    },
    {
      name: "Cat's in the Bag...",
      season_number: 1,
      episode_number: 2,
      runtime: 48,
      air_date: '2008-01-27',
    },
  ],
}
