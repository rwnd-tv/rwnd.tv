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

  it('prefers a direct tv_results hit over an episode fallback when both are somehow present', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      findResponse({
        movie_results: [],
        tv_results: [{ id: 1399 }],
        tv_episode_results: [{ id: 1385732, show_id: 74313 }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const id = await provider().findByExternalId('show', 'imdb', 'tt7579602', 'en-GB')
    expect(id).toBe('1399')
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
