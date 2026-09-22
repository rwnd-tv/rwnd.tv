import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_WATCHED_AT, type StatsSummary, type StatsTimeline } from '@rwnd/shared'
import type { Play } from '@rwnd/shared'
import { extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

const SHOW_TMDB_ID = 1396

/**
 * The Matrix (movie 603, runtime 136) is watched twice — once on a known
 * date, once on the 1900 sentinel — so the same test exercises both the
 * "known runtime" arithmetic and the sentinel-handling policy
 * (statsSummarySchema's doc comment): included in totals.plays, excluded
 * from firstWatchedAt/lastWatchedAt, counted separately via
 * unknownDatePlays. The Matrix Reloaded (604) has no runtime at all, to
 * exercise the flat movie-runtime fallback. Breaking Bad's three episodes
 * give two known runtimes (50, 70 — median 60, deliberately not equal to
 * either) and one null one, to exercise the per-show median fallback
 * distinctly from both the flat default and either known value.
 */
function stubTmdb() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(input)
      if (url.pathname === '/3/movie/603') {
        return new Response(
          JSON.stringify({
            id: 603,
            title: 'The Matrix',
            release_date: '1999-03-30',
            runtime: 136,
            overview: 'A hacker learns the truth.',
            poster_path: '/matrix.jpg',
          }),
          { status: 200 },
        )
      }
      if (url.pathname === '/3/movie/604') {
        return new Response(
          JSON.stringify({
            id: 604,
            title: 'The Matrix Reloaded',
            release_date: '2003-05-15',
            runtime: null,
            overview: 'Neo and the rebels race against machines.',
            poster_path: '/matrix-reloaded.jpg',
          }),
          { status: 200 },
        )
      }
      if (url.pathname === `/3/tv/${SHOW_TMDB_ID}`) {
        return new Response(
          JSON.stringify({
            id: SHOW_TMDB_ID,
            name: 'Breaking Bad',
            first_air_date: '2008-01-20',
            overview: 'A chemistry teacher turns to crime.',
            poster_path: '/breaking-bad.jpg',
          }),
          { status: 200 },
        )
      }
      if (url.pathname === `/3/tv/${SHOW_TMDB_ID}/season/1/episode/1`) {
        return new Response(
          JSON.stringify({
            name: 'Pilot',
            season_number: 1,
            episode_number: 1,
            runtime: 50,
            air_date: '2008-01-20',
          }),
          { status: 200 },
        )
      }
      if (url.pathname === `/3/tv/${SHOW_TMDB_ID}/season/1/episode/2`) {
        return new Response(
          JSON.stringify({
            name: "Cat's in the Bag...",
            season_number: 1,
            episode_number: 2,
            runtime: 70,
            air_date: '2008-01-27',
          }),
          { status: 200 },
        )
      }
      if (url.pathname === `/3/tv/${SHOW_TMDB_ID}/season/1/episode/3`) {
        return new Response(
          JSON.stringify({
            name: "...And the Bag's in the River",
            season_number: 1,
            episode_number: 3,
            runtime: null,
            air_date: '2008-02-03',
          }),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    }),
  )
}

async function createUserAndCookie() {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'watcher@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Watcher',
    }),
  })
  return extractCookie(res)!
}

async function logMovie(cookie: string, externalId: string, watchedAt: string) {
  const res = await app.request('/api/v1/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ movie: { source: 'tmdb', externalId }, watchedAt }),
  })
  return json<Play>(res)
}

async function logEpisode(cookie: string, episodeNumber: number, watchedAt: string) {
  const res = await app.request('/api/v1/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      episode: {
        source: 'tmdb',
        showExternalId: String(SHOW_TMDB_ID),
        seasonNumber: 1,
        episodeNumber,
      },
      watchedAt,
    }),
  })
  return json<Play>(res)
}

describe('GET /stats/summary', () => {
  beforeEach(async () => {
    await resetDb(db)
    stubTmdb()
  })

  it('aggregates totals, applies the runtime fallback ladder, and ranks top shows/movies', async () => {
    const cookie = await createUserAndCookie()

    await logMovie(cookie, '603', '2026-01-01T12:00:00.000Z')
    await logMovie(cookie, '603', UNKNOWN_WATCHED_AT)
    await logMovie(cookie, '604', '2026-01-02T12:00:00.000Z')
    await logEpisode(cookie, 1, '2026-01-03T12:00:00.000Z')
    await logEpisode(cookie, 2, '2026-01-04T12:00:00.000Z')
    await logEpisode(cookie, 3, '2026-01-05T12:00:00.000Z')

    const res = await app.request('/api/v1/stats/summary', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<StatsSummary>(res)

    expect(body.totals).toEqual({
      plays: 6,
      episodePlays: 3,
      moviePlays: 3,
      distinctShows: 1,
      distinctEpisodes: 3,
      distinctMovies: 2,
      // Matrix known (136) x2 + Reloaded fallback (90) + ep1 (50) + ep2 (70) + ep3 median (60)
      minutesWatched: 136 + 136 + 90 + 50 + 70 + 60,
      estimatedMinutes: 90 + 60,
      playsWithoutRuntime: 2,
      firstWatchedAt: '2026-01-01T12:00:00.000Z',
      lastWatchedAt: '2026-01-05T12:00:00.000Z',
      unknownDatePlays: 1,
    })

    expect(body.topShows).toHaveLength(1)
    expect(body.topShows[0]).toMatchObject({
      title: 'Breaking Bad',
      plays: 3,
      episodes: 3,
      minutes: 50 + 70 + 60,
    })

    expect(body.topMovies).toHaveLength(2)
    // Sorted by minutes descending: The Matrix (2 known-runtime plays) beats
    // The Matrix Reloaded (1 fallback-runtime play).
    expect(body.topMovies[0]).toMatchObject({ title: 'The Matrix', plays: 2, minutes: 272 })
    expect(body.topMovies[1]).toMatchObject({ title: 'The Matrix Reloaded', plays: 1, minutes: 90 })
  })

  it('returns zeroed totals and empty lists for a user with no watch history', async () => {
    const cookie = await createUserAndCookie()

    const res = await app.request('/api/v1/stats/summary', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<StatsSummary>(res)

    expect(body.totals).toEqual({
      plays: 0,
      episodePlays: 0,
      moviePlays: 0,
      distinctShows: 0,
      distinctEpisodes: 0,
      distinctMovies: 0,
      minutesWatched: 0,
      estimatedMinutes: 0,
      playsWithoutRuntime: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
      unknownDatePlays: 0,
    })
    expect(body.topShows).toEqual([])
    expect(body.topMovies).toEqual([])
  })

  it('requires a session', async () => {
    const res = await app.request('/api/v1/stats/summary')
    expect(res.status).toBe(401)
  })

  it('scopes totals and top lists to an after/before window, excluding plays outside it', async () => {
    const cookie = await createUserAndCookie()

    await logMovie(cookie, '603', '2025-06-01T12:00:00.000Z') // outside the 2026 window below
    await logMovie(cookie, '603', '2026-01-01T12:00:00.000Z')
    await logEpisode(cookie, 1, '2026-01-03T12:00:00.000Z')

    const res = await app.request(
      '/api/v1/stats/summary?after=2026-01-01T00:00:00.000Z&before=2026-12-31T23:59:59.999Z',
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    const body = await json<StatsSummary>(res)

    expect(body.totals.plays).toBe(2)
    expect(body.totals.moviePlays).toBe(1)
    expect(body.totals.episodePlays).toBe(1)
    expect(body.topMovies).toHaveLength(1)
    expect(body.topMovies[0]).toMatchObject({ title: 'The Matrix', plays: 1 })
  })
})

describe('GET /stats/timeline', () => {
  beforeEach(async () => {
    await resetDb(db)
    stubTmdb()
  })

  function toEpochMinutes(iso: string): number {
    return Math.floor(new Date(iso).getTime() / 60_000)
  }

  it('returns ascending epoch-minute arrays split by episode/movie, sentinel-excluded and counted separately', async () => {
    const cookie = await createUserAndCookie()

    await logMovie(cookie, '603', '2026-01-02T12:00:00.000Z')
    await logMovie(cookie, '603', UNKNOWN_WATCHED_AT)
    await logEpisode(cookie, 1, '2026-01-01T06:00:00.000Z')
    await logEpisode(cookie, 2, '2026-01-03T18:30:00.000Z')

    const res = await app.request('/api/v1/stats/timeline', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<StatsTimeline>(res)

    expect(body.episodePlays).toEqual([
      toEpochMinutes('2026-01-01T06:00:00.000Z'),
      toEpochMinutes('2026-01-03T18:30:00.000Z'),
    ])
    expect(body.moviePlays).toEqual([toEpochMinutes('2026-01-02T12:00:00.000Z')])
    expect(body.unknownDatePlays).toBe(1)
  })

  it('returns empty arrays for a user with no watch history', async () => {
    const cookie = await createUserAndCookie()

    const res = await app.request('/api/v1/stats/timeline', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<StatsTimeline>(res)

    expect(body).toEqual({ episodePlays: [], moviePlays: [], unknownDatePlays: 0 })
  })

  it('requires a session', async () => {
    const res = await app.request('/api/v1/stats/timeline')
    expect(res.status).toBe(401)
  })
})
