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
