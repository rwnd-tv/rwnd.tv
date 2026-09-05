import { afterEach, describe, expect, it, vi } from 'vitest'
import { TmdbProvider } from './tmdb.js'

function provider() {
  return new TmdbProvider({
    apiKey: 'test-key',
    apiBaseUrl: 'https://api.themoviedb.org/3',
    imageBaseUrl: 'https://image.tmdb.org/t/p',
  })
}

const movieResponse = () =>
  new Response(JSON.stringify({ id: 603, title: 'The Matrix', release_date: '1999-03-30' }), {
    status: 200,
  })

describe('TmdbProvider 429 handling', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('retries once on 429, honouring Retry-After, and returns the eventual success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(movieResponse())
    vi.stubGlobal('fetch', fetchMock)

    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.title).toBe('The Matrix')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after a second consecutive 429 rather than retrying indefinitely', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getMovie('603', 'en-GB')).rejects.toThrow(/429/)
    expect(fetchMock).toHaveBeenCalledTimes(2) // one retry, then surfaced — not looped forever
  })

  it('throws immediately on a non-retryable status, with no retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getMovie('603', 'en-GB')).rejects.toThrow(/404/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('TmdbProvider — API key never reaches a thrown error message (M3 security review, F-09)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('redacts api_key from a non-2xx error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getMovie('603', 'en-GB')).rejects.toThrow(/404/)
    await provider()
      .getMovie('603', 'en-GB')
      .catch((err: Error) => {
        expect(err.message).not.toContain('test-key')
        // URL-encoded by URL#toString() — '[' and ']' aren't valid
        // unescaped query-string characters.
        expect(err.message).toContain('api_key=%5Bredacted%5D')
      })
  })

  it('redacts api_key from a network-level failure (DNS, connection refused, ...)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await provider()
      .getMovie('603', 'en-GB')
      .catch((err: Error) => {
        expect(err.message).not.toContain('test-key')
        expect(err.message).toContain('network error')
      })
    expect.assertions(2)
  })
})

describe('TmdbProvider.findByExternalId', () => {
  afterEach(() => vi.unstubAllGlobals())

  const findResponse = (body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status: 200 })

  it('resolves a movie id from movie_results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(findResponse({ movie_results: [{ id: 603 }], tv_results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB')
    expect(id).toBe('603')
  })

  it('resolves a show id from tv_results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(findResponse({ movie_results: [], tv_results: [{ id: 1399 }] }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'tvdb', '121361', 'en-GB')
    expect(id).toBe('1399')
  })

  it("falls back to an episode hit's show_id when the id identifies an episode, not the show itself", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      findResponse({
        movie_results: [],
        tv_results: [],
        tv_episode_results: [{ id: 1385732, show_id: 74313 }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt7579602', 'en-GB')
    expect(id).toBe('74313')
  })

  it('prefers the episode fallback over a tv_results hit when both are present (TMDB cross-reference bug regression)', async () => {
    // Live-verified 2026-09-02 against a real Plex webhook: TMDB's own
    // /find/411857?external_source=tvdb_id genuinely returns both —
    // tv_results incorrectly pointing at an unrelated show ("Sisbro",
    // 138346), tv_episode_results correctly identifying the real episode
    // ("1990" S1E1 "Creed of Slaves", show_id 13380). Trusting tv_results
    // here silently logged a completely wrong show against a real watch.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      findResponse({
        movie_results: [],
        tv_results: [{ id: 1399 }],
        tv_episode_results: [{ id: 1385732, show_id: 74313 }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt7579602', 'en-GB')
    expect(id).toBe('74313')
  })

  it('returns null when both result arrays are empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(findResponse({ movie_results: [], tv_results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt9999999', 'en-GB')
    expect(id).toBeNull()
  })

  it('returns null rather than throwing on a 404 (an unrecognised external id)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt0000000', 'en-GB')
    expect(id).toBeNull()
  })

  it('still surfaces a non-404 failure rather than swallowing it as "no match"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB'),
    ).rejects.toThrow(/500/)
  })

  it('sends external_source=imdb_id vs tvdb_id depending on the requested source', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => findResponse({ movie_results: [], tv_results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB')
    await provider().findByExternalId('show', 'tvdb', '121361', 'en-GB')

    const [firstCall, secondCall] = fetchMock.mock.calls as [URL][]
    const [firstUrl] = firstCall!
    const [secondUrl] = secondCall!
    expect(firstUrl.pathname).toBe('/3/find/tt0133093')
    expect(firstUrl.searchParams.get('external_source')).toBe('imdb_id')
    expect(secondUrl.pathname).toBe('/3/find/121361')
    expect(secondUrl.searchParams.get('external_source')).toBe('tvdb_id')
  })

  it('inherits the 429 retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(findResponse({ movie_results: [{ id: 603 }], tv_results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB')
    expect(id).toBe('603')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('TmdbProvider imdbId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('getMovie reads imdb_id from the top level, appending only release_dates (not external_ids, which it already has)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 603,
          title: 'The Matrix',
          release_date: '1999-03-30',
          imdb_id: 'tt0133093',
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.imdbId).toBe('tt0133093')
    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.searchParams.get('append_to_response')).toBe('release_dates')
  })

  it('getMovie normalizes an empty imdb_id to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 603, title: 'The Matrix', imdb_id: '' }), {
          status: 200,
        }),
      ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.imdbId).toBeNull()
  })

  it('getShow requests append_to_response=external_ids and reads imdb_id from it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 1396,
          name: 'Breaking Bad',
          external_ids: { imdb_id: 'tt0903747' },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const show = await provider().getShow('1396', 'en-GB')
    expect(show.imdbId).toBe('tt0903747')
    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.searchParams.get('append_to_response')).toBe('external_ids')
  })

  it('getShow normalizes a missing external_ids block to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 1396, name: 'Breaking Bad' }), { status: 200 }),
        ),
    )
    const show = await provider().getShow('1396', 'en-GB')
    expect(show.imdbId).toBeNull()
  })

  it('getEpisode requests append_to_response=external_ids and reads imdb_id from it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: 'Pilot',
          season_number: 1,
          episode_number: 1,
          external_ids: { imdb_id: 'tt0959621' },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const episode = await provider().getEpisode('1396', 1, 1, 'en-GB')
    expect(episode.imdbId).toBe('tt0959621')
    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.searchParams.get('append_to_response')).toBe('external_ids')
  })

  it('getSeason never populates imdbId on its episodes — TMDB has no per-episode ids there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            overview: null,
            episodes: [
              { name: 'Pilot', season_number: 1, episode_number: 1 },
              { name: 'Cat’s in the Bag...', season_number: 1, episode_number: 2 },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const season = await provider().getSeason('1396', 1, 'en-GB')
    expect(season.episodes.every((e) => e.imdbId === null)).toBe(true)
  })

  it('rejects a malformed imdb_id rather than building a link out of it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 603, title: 'The Matrix', imdb_id: 'nm0000206' }), {
          status: 200,
        }),
      ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.imdbId).toBeNull()
  })
})

describe('TmdbProvider air dates', () => {
  afterEach(() => vi.unstubAllGlobals())

  // resolveSeason (apps/api/src/lib/media.ts) writes this straight into a
  // Postgres date column — an empty string rather than null/undefined would
  // fail that cast, so the provider boundary has to normalize it.
  it('getEpisode normalizes an empty air_date to null, not an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ name: 'Pilot', season_number: 1, episode_number: 1, air_date: '' }),
            { status: 200 },
          ),
        ),
    )
    const episode = await provider().getEpisode('1396', 1, 1, 'en-GB')
    expect(episode.firstAired).toBeNull()
  })

  it('getSeason normalizes an empty air_date to null, not an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            overview: null,
            episodes: [{ name: 'Pilot', season_number: 1, episode_number: 1, air_date: '' }],
          }),
          { status: 200 },
        ),
      ),
    )
    const season = await provider().getSeason('1396', 1, 'en-GB')
    expect(season.episodes[0]?.firstAired).toBeNull()
  })
})

describe('TmdbProvider release dates', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prefers the earliest theatrical release in a region over an earlier non-theatrical one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-30',
            release_dates: {
              results: [
                {
                  iso_3166_1: 'GB',
                  release_dates: [
                    { type: 1, release_date: '1999-01-01T00:00:00.000Z' }, // Premiere, earlier
                    { type: 3, release_date: '1999-06-11T00:00:00.000Z' }, // Theatrical
                    { type: 2, release_date: '1999-06-18T00:00:00.000Z' }, // Theatrical (limited)
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.releaseDate).toBe('1999-03-30')
    expect(movie.releaseDates).toEqual({ GB: '1999-06-11' })
  })

  it('falls back to the earliest date of any type when a region has no theatrical release', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 603,
            title: 'The Matrix',
            release_dates: {
              results: [
                {
                  iso_3166_1: 'JP',
                  release_dates: [
                    { type: 4, release_date: '1999-09-01T00:00:00.000Z' }, // Digital
                    { type: 6, release_date: '1999-10-01T00:00:00.000Z' }, // TV
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.releaseDates).toEqual({ JP: '1999-09-01' })
  })

  it('skips a region entry whose only dates are empty strings, and drops an unusable region entirely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 603,
            title: 'The Matrix',
            release_dates: {
              results: [
                { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '' }] },
                {
                  iso_3166_1: 'DE',
                  release_dates: [{ type: 3, release_date: '1999-08-19T00:00:00.000Z' }],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.releaseDates).toEqual({ DE: '1999-08-19' })
  })

  it('normalizes a missing release_dates block to an empty object, not null', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 603, title: 'The Matrix' }), { status: 200 }),
        ),
    )
    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.releaseDate).toBeNull()
    expect(movie.releaseDates).toEqual({})
  })
})
