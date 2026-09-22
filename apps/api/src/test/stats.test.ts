import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { ratings, movies, shows } from '@rwnd/db'
import { UNKNOWN_WATCHED_AT, type StatsSummary, type StatsTimeline } from '@rwnd/shared'
import type { Play } from '@rwnd/shared'
import { extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

const SHOW_TMDB_ID = 1396
const RATING_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

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
 *
 * Genres deliberately overlap one but not the other between the two
 * movies ("Science Fiction" shared, "Action" Matrix-only, "Adventure"
 * Reloaded-only) and Breaking Bad gets its own disjoint pair ("Drama",
 * "Crime") — enough to exercise topGenres' "a title's minutes count
 * toward every one of its genres" fan-out without every genre summing to
 * the same total, which would hide an indexing bug.
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
            genres: [
              { id: 878, name: 'Science Fiction' },
              { id: 28, name: 'Action' },
            ],
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
            genres: [
              { id: 878, name: 'Science Fiction' },
              { id: 12, name: 'Adventure' },
            ],
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
            genres: [
              { id: 18, name: 'Drama' },
              { id: 80, name: 'Crime' },
            ],
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

    // Science Fiction sums both movies (272 + 90 = 362, 2 titles); Action is
    // Matrix-only (272, 1 title); Drama/Crime tie at Breaking Bad's own 180
    // minutes (1 title each, stable-sorted in the order stubTmdb lists
    // them); Adventure is Reloaded-only (90, 1 title).
    expect(body.topGenres).toEqual([
      { genre: 'Science Fiction', minutes: 362, titles: 2 },
      { genre: 'Action', minutes: 272, titles: 1 },
      { genre: 'Drama', minutes: 180, titles: 1 },
      { genre: 'Crime', minutes: 180, titles: 1 },
      { genre: 'Adventure', minutes: 90, titles: 1 },
    ])
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
    expect(body.topGenres).toEqual([])
    expect(body.ratings).toEqual({
      total: 0,
      average: null,
      distribution: RATING_VALUES.map((rating) => ({
        rating,
        movie: 0,
        show: 0,
        episode: 0,
        total: 0,
      })),
    })
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

  it('builds a zero-filled ratings histogram split by entity type, with a correct total/average', async () => {
    const cookie = await createUserAndCookie()

    // Ratings are independent of plays entirely (statsRatingsSchema's doc
    // comment) — resolve the titles via a play each so their rows exist,
    // then insert ratings directly (no API route lets a test control
    // ratedAt, and it's a plain server-stamped `new Date()` otherwise).
    await logMovie(cookie, '603', '2026-01-01T12:00:00.000Z')
    await logMovie(cookie, '604', '2026-01-02T12:00:00.000Z')
    await logEpisode(cookie, 1, '2026-01-03T12:00:00.000Z')

    const me = await json<{ id: string }>(
      await app.request('/api/v1/auth/me', { headers: { cookie } }),
    )
    const [matrix] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, 'the-matrix-1999'))
    const [reloaded] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, 'the-matrix-reloaded-2003'))
    const [breakingBad] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, 'breaking-bad-2008'))
    if (!matrix || !reloaded || !breakingBad) throw new Error('Expected seeded movie/show rows')

    await db.insert(ratings).values([
      { userId: me.id, entityType: 'movie', entityId: matrix.id, rating: 9, ratedAt: new Date() },
      { userId: me.id, entityType: 'movie', entityId: reloaded.id, rating: 7, ratedAt: new Date() },
      {
        userId: me.id,
        entityType: 'show',
        entityId: breakingBad.id,
        rating: 9,
        ratedAt: new Date(),
      },
    ])

    const res = await app.request('/api/v1/stats/summary', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<StatsSummary>(res)

    expect(body.ratings.total).toBe(3)
    expect(body.ratings.average).toBeCloseTo((9 + 7 + 9) / 3)
    expect(body.ratings.distribution).toHaveLength(10)
    expect(body.ratings.distribution.find((b) => b.rating === 9)).toEqual({
      rating: 9,
      movie: 1,
      show: 1,
      episode: 0,
      total: 2,
    })
    expect(body.ratings.distribution.find((b) => b.rating === 7)).toEqual({
      rating: 7,
      movie: 1,
      show: 0,
      episode: 0,
      total: 1,
    })
    // Zero-filled for every rating value nobody used, e.g. 1.
    expect(body.ratings.distribution.find((b) => b.rating === 1)).toEqual({
      rating: 1,
      movie: 0,
      show: 0,
      episode: 0,
      total: 0,
    })
  })

  it('scopes the ratings histogram by ratedAt, not watchedAt — independent windows', async () => {
    const cookie = await createUserAndCookie()

    // Watched in 2026, but rated in 2024: an after/before window on 2026
    // still finds the watch (topMovies) but not the rating.
    await logMovie(cookie, '603', '2026-01-01T12:00:00.000Z')
    const me = await json<{ id: string }>(
      await app.request('/api/v1/auth/me', { headers: { cookie } }),
    )
    const [matrix] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, 'the-matrix-1999'))
    if (!matrix) throw new Error('Expected seeded movie row')
    await db.insert(ratings).values({
      userId: me.id,
      entityType: 'movie',
      entityId: matrix.id,
      rating: 10,
      ratedAt: new Date('2024-06-01T12:00:00.000Z'),
    })

    const res = await app.request(
      '/api/v1/stats/summary?after=2026-01-01T00:00:00.000Z&before=2026-12-31T23:59:59.999Z',
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    const body = await json<StatsSummary>(res)

    expect(body.topMovies).toHaveLength(1) // the watch is in the window
    expect(body.ratings.total).toBe(0) // the rating is not
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
