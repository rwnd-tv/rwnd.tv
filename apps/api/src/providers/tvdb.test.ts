import { afterEach, describe, expect, it, vi } from 'vitest'
import { TvdbProvider } from './tvdb.js'

function provider(pin?: string) {
  return new TvdbProvider({ apiKey: 'test-key', pin, apiBaseUrl: 'https://api4.thetvdb.com/v4' })
}

// TVDB wraps every response body in { data, status } (see the swagger.yml
// referenced in tvdb.ts) — request() unwraps this, so fixtures below must
// mirror the real envelope, not just the payload it carries.
function apiResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, status: 'success' }), { status })
}

const loginOk = () => apiResponse({ token: 'test-token' })

describe('TvdbProvider auth', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('logs in lazily on first use and reuses the cached token afterwards', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ id: 603, name: 'Movie A', genres: [] }))
      .mockResolvedValueOnce(apiResponse({ name: 'Movie A', overview: 'ov' }))
      .mockResolvedValueOnce(apiResponse({ id: 604, name: 'Movie B', genres: [] }))
      .mockResolvedValueOnce(apiResponse({ name: 'Movie B', overview: 'ov2' }))
    vi.stubGlobal('fetch', fetchMock)

    const p = provider()
    await p.getMovie('603', 'en-GB')
    await p.getMovie('604', 'en-GB')

    // 1 login + 2 calls per getMovie (extended + translation) = 5 total.
    expect(fetchMock).toHaveBeenCalledTimes(5)
    const [loginUrl] = fetchMock.mock.calls[0] as [string]
    expect(loginUrl).toBe('https://api4.thetvdb.com/v4/login')
  })

  it('sends the pin only when configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await provider('1234').findByExternalId('movie', 'imdb', 'tt0000000', 'en-GB')
    const [, initWithPin] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(initWithPin.body as string)).toEqual({ apikey: 'test-key', pin: '1234' })

    fetchMock.mockReset().mockResolvedValueOnce(loginOk()).mockResolvedValueOnce(apiResponse([]))
    await provider().findByExternalId('movie', 'imdb', 'tt0000000', 'en-GB')
    const [, initWithoutPin] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(initWithoutPin.body as string)).toEqual({ apikey: 'test-key' })
  })

  it('re-logs-in once on a 401 and retries, but throws on a second consecutive 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB')
    expect(id).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4) // login, 401, re-login, retry success

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(
      provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB'),
    ).rejects.toThrow(/401/)
  })
})

describe('TvdbProvider.searchMulti', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('filters to movie/series, prefers a translated name/overview, falls back to the primary fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse([
          {
            type: 'movie',
            tvdb_id: '603',
            name: 'The Matrix',
            overview: 'primary overview',
            translations: { eng: 'The Matrix (EN)' },
            overviews: { eng: 'translated overview' },
            image_url: 'https://example.com/poster.jpg',
            year: '1999',
          },
          { type: 'person', tvdb_id: '1', name: 'Someone' },
          { type: 'series', tvdb_id: '', name: 'No id, skipped' },
          { type: 'series', tvdb_id: '1399', name: 'Game of Thrones', year: '2011' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const results = await provider().searchMulti('matrix', 'en-GB')
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      type: 'movie',
      externalId: '603',
      title: 'The Matrix (EN)',
      year: 1999,
      overview: 'translated overview',
      posterPath: 'https://example.com/poster.jpg',
    })
    expect(results[1]).toMatchObject({ type: 'show', externalId: '1399', title: 'Game of Thrones' })
  })
})

describe('TvdbProvider.getMovie / getShow', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('getMovie never populates voteAverage or release dates — TVDB has neither concept', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 603,
          name: 'The Matrix',
          year: '1999',
          runtime: 136,
          image: 'https://example.com/p.jpg',
          genres: [{ name: 'Action' }],
          score: 987654,
        }),
      )
      .mockResolvedValueOnce(apiResponse({ name: 'The Matrix', overview: 'A hacker...' }))
    vi.stubGlobal('fetch', fetchMock)

    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie).toEqual({
      externalId: '603',
      title: 'The Matrix',
      year: 1999,
      runtimeMinutes: 136,
      overview: 'A hacker...',
      posterPath: 'https://example.com/p.jpg',
      genres: ['Action'],
      voteAverage: null,
      imdbId: null,
      releaseDate: null,
      releaseDates: null,
    })
  })

  it('getMovie picks the IMDb entry out of remoteIds, ignoring unrelated sources', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 603,
          name: 'The Matrix',
          genres: [],
          remoteIds: [
            { id: 'https://example.com', sourceName: 'Official Website' },
            { id: 'tt0133093', sourceName: 'IMDB' },
          ],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ name: 'The Matrix' }))
    vi.stubGlobal('fetch', fetchMock)

    const movie = await provider().getMovie('603', 'en-GB')
    expect(movie.imdbId).toBe('tt0133093')
  })

  it('getShow derives per-season episode counts and air dates from the full episode list, and drops non-default season types', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 1399,
          name: 'Game of Thrones',
          year: '2011',
          overview: 'primary overview',
          status: { name: 'Ended' },
          genres: [{ name: 'Drama' }],
          defaultSeasonType: 1,
          seasons: [
            { id: 10, number: 1, name: 'Season 1', type: { id: 1, type: 'official' } },
            { id: 11, number: 1, name: 'Season 1 (DVD)', type: { id: 2, type: 'dvd' } },
          ],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ name: 'Game of Thrones', overview: 'translated' }))
      .mockResolvedValueOnce(
        apiResponse({
          episodes: [
            { id: 1, seasonNumber: 1, number: 1, aired: '2011-04-17' },
            { id: 2, seasonNumber: 1, number: 2, aired: '2011-04-24' },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const show = await provider().getShow('1399', 'en-GB')
    expect(show.overview).toBe('translated')
    expect(show.status).toBe('Ended')
    expect(show.voteAverage).toBeNull()
    expect(show.seasons).toEqual([
      {
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 2,
        airDate: '2011-04-17',
        posterPath: null,
      },
    ])
  })

  it('getShow picks the IMDb entry out of remoteIds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 1399,
          name: 'Game of Thrones',
          seasons: [],
          remoteIds: [{ id: 'tt0944947', sourceName: 'IMDB' }],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ name: 'Game of Thrones' }))
      .mockResolvedValueOnce(apiResponse({ episodes: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const show = await provider().getShow('1399', 'en-GB')
    expect(show.imdbId).toBe('tt0944947')
  })

  it('falls back to matching the "official" season type by name when defaultSeasonType is itself missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 1399,
          name: 'Game of Thrones',
          seasons: [{ id: 10, number: 1, name: 'Season 1', type: { id: 1, type: 'official' } }],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ name: 'Game of Thrones' }))
      .mockResolvedValueOnce(apiResponse({ episodes: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const show = await provider().getShow('1399', 'en-GB')
    expect(show.seasons).toEqual([
      { seasonNumber: 1, name: 'Season 1', episodeCount: 0, airDate: null, posterPath: null },
    ])
  })

  it("falls back to an episode's own seriesId when externalId 404s as a series — a native id, not a foreign one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // /series/11569548/extended
      .mockResolvedValueOnce(apiResponse({ id: 11569548, seriesId: 387219 })) // /episodes/11569548
      .mockResolvedValueOnce(apiResponse({ id: 387219, name: 'Formula 1', seasons: [] })) // /series/387219/extended
      .mockResolvedValueOnce(apiResponse({ name: 'Formula 1' })) // translation
      .mockResolvedValueOnce(apiResponse({ episodes: [] })) // allEpisodes
    vi.stubGlobal('fetch', fetchMock)

    const show = await provider().getShow('11569548', 'en-GB')
    expect(show.externalId).toBe('387219')
    expect(show.title).toBe('Formula 1')

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls[1]).toContain('/series/11569548/extended')
    expect(urls[2]).toContain('/episodes/11569548')
    expect(urls[3]).toContain('/series/387219/extended')
  })

  it('surfaces the original series 404 when externalId is neither a series nor an episode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // /series/{id}/extended
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // /episodes/{id}
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getShow('999999999', 'en-GB')).rejects.toThrow(
      /TVDB request failed: 404.*series\/999999999/,
    )
  })

  it('getShow pages through the full episode list until a short page ends it', async () => {
    const pageOf = (n: number, seasonNumber: number) =>
      Array.from({ length: n }, (_, i) => ({ seasonNumber, number: i + 1, aired: null }))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ id: 1, name: 'Long Show', seasons: [] }))
      .mockResolvedValueOnce(apiResponse({ name: 'Long Show' }))
      .mockResolvedValueOnce(apiResponse({ episodes: pageOf(500, 1) })) // a full page — keep going
      .mockResolvedValueOnce(apiResponse({ episodes: pageOf(3, 2) })) // short page — stop here
    vi.stubGlobal('fetch', fetchMock)

    await provider().getShow('1', 'en-GB')
    // login + extended + translation + 2 episode pages.
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})

describe('TvdbProvider.getEpisode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests the exact season/episode, then a second call for its own imdbId, and maps the result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          episodes: [
            {
              id: 1,
              name: 'Winter Is Coming',
              seasonNumber: 1,
              number: 1,
              runtime: 62,
              aired: '2011-04-17',
              overview: 'ov',
              image: 'https://example.com/still.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ remoteIds: [{ id: 'tt1480055', sourceName: 'IMDB' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const episode = await provider().getEpisode('1399', 1, 1, 'en-GB')
    expect(episode).toEqual({
      title: 'Winter Is Coming',
      seasonNumber: 1,
      episodeNumber: 1,
      runtimeMinutes: 62,
      firstAired: '2011-04-17',
      overview: 'ov',
      stillPath: 'https://example.com/still.jpg',
      voteAverage: null,
      externalId: '1',
      imdbId: 'tt1480055',
    })
    const [, secondCall, thirdCall] = fetchMock.mock.calls as [unknown, [URL], [URL]]
    const [listUrl] = secondCall
    expect(listUrl.searchParams.get('season')).toBe('1')
    expect(listUrl.searchParams.get('episodeNumber')).toBe('1')
    const [extendedUrl] = thirdCall
    expect(String(extendedUrl)).toContain('/episodes/1/extended')
    expect(extendedUrl.searchParams.get('short')).toBe('true')
  })

  it('throws when no matching episode is returned', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ episodes: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().getEpisode('1399', 99, 99, 'en-GB')).rejects.toThrow(/not found/)
  })

  it('degrades to a null imdbId rather than failing episode resolution when the extended lookup errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ episodes: [{ id: 1, seasonNumber: 1, number: 1 }] }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const episode = await provider().getEpisode('1399', 1, 1, 'en-GB')
    expect(episode.imdbId).toBeNull()
  })

  // resolveSeason (apps/api/src/lib/media.ts) writes this straight into a
  // Postgres date column — an empty string rather than null/undefined would
  // fail that cast, so the provider boundary has to normalize it.
  it('normalizes an empty aired date to null, not an empty string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({ episodes: [{ id: 1, seasonNumber: 1, number: 1, aired: '' }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const episode = await provider().getEpisode('1399', 1, 1, 'en-GB')
    expect(episode.firstAired).toBeNull()
  })
})

describe('TvdbProvider.getSeason', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves the season overview via its own translation, and lists its episodes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse({
          id: 1399,
          name: 'Game of Thrones',
          defaultSeasonType: 1,
          seasons: [{ id: 10, number: 1, type: { id: 1, type: 'official' } }],
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({ episodes: [{ seasonNumber: 1, number: 1, name: 'Winter Is Coming' }] }),
      )
      .mockResolvedValueOnce(apiResponse({ overview: 'season overview' }))
    vi.stubGlobal('fetch', fetchMock)

    const season = await provider().getSeason('1399', 1, 'en-GB')
    expect(season.overview).toBe('season overview')
    expect(season.episodes).toHaveLength(1)
  })

  it('skips the translation lookup entirely when no matching season is found', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ id: 1399, name: 'Show', seasons: [] }))
      .mockResolvedValueOnce(apiResponse({ episodes: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const season = await provider().getSeason('1399', 1, 'en-GB')
    expect(season.overview).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3) // no 4th call for a translation lookup
  })

  // resolveSeason (apps/api/src/lib/media.ts) writes this straight into a
  // Postgres date column — an empty string rather than null/undefined would
  // fail that cast, so the provider boundary has to normalize it.
  it('normalizes an empty aired date to null, not an empty string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse({ id: 1399, name: 'Show', seasons: [] }))
      .mockResolvedValueOnce(
        apiResponse({ episodes: [{ seasonNumber: 1, number: 1, name: 'Pilot', aired: '' }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const season = await provider().getSeason('1399', 1, 'en-GB')
    expect(season.episodes[0]?.firstAired).toBeNull()
  })
})

describe('TvdbProvider.findByExternalId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves a movie id from the remote-id match array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([{ movie: { id: 603 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB')
    expect(id).toBe('603')
  })

  it('resolves a show id from the remote-id match array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([{ series: { id: 1399 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt0944947', 'en-GB')
    expect(id).toBe('1399')
  })

  it("falls back to an episode match's seriesId when the id identifies an episode, not the series itself", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([{ episode: { id: 6381361, seriesId: 330942 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt7579602', 'en-GB')
    expect(id).toBe('330942')
  })

  it('prefers a direct series match over an episode fallback when both are somehow present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        apiResponse([{ series: { id: 1399 }, episode: { id: 6381361, seriesId: 330942 } }]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt7579602', 'en-GB')
    expect(id).toBe('1399')
  })

  it('returns null on an empty match array or a 404, without throwing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([]))
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await provider().findByExternalId('movie', 'imdb', 'tt9999999', 'en-GB')).toBeNull()
    expect(await provider().findByExternalId('movie', 'imdb', 'tt0000000', 'en-GB')).toBeNull()
  })

  // Regression, confirmed live 2026-09-05: the real API returns
  // `{"status":"success","data":null}` for a genuine no-match, not
  // `data: []` as the doc comment above assumed — a bare `for...of` over
  // that would throw "matches is not iterable" instead of returning null.
  it('returns null rather than throwing when the real API returns data: null for no match', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse(null))
    vi.stubGlobal('fetch', fetchMock)

    expect(await provider().findByExternalId('show', 'imdb', 'tt0314979', 'en-GB')).toBeNull()
  })

  // Regression, confirmed live 2026-09-05 against Ghost in the Shell:
  // SAC_2045's real imdb id: some matches carry only a `season` field, no
  // `series`/`episode` alongside it — falling through every check
  // returned null despite a real, usable seriesId being right there.
  it('resolves a show id from a season-only match, not just series/episode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(apiResponse([{ season: { id: 1837422, seriesId: 73749 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt9466298', 'en-GB')
    expect(id).toBe('73749')
  })

  it('still surfaces a non-404 failure rather than swallowing it as "no match"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      provider().findByExternalId('movie', 'imdb', 'tt0133093', 'en-GB'),
    ).rejects.toThrow(/500/)
  })
})
