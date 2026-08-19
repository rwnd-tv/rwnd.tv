import { beforeEach, describe, expect, it } from 'vitest'
import { episodes, movies, plays, seasons, shows } from '@rwnd/db'
import type { ListLibraryMoviesResponse, ListLibraryShowsResponse, User } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndCookie(email = 'watcher@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

async function meId(cookie: string) {
  const res = await app.request('/api/v1/auth/me', { headers: { cookie } })
  return (await json<User>(res)).id
}

describe('library', () => {
  beforeEach(() => resetDb(db))

  it('requires authentication', async () => {
    expect((await app.request('/api/v1/library/shows')).status).toBe(401)
    expect((await app.request('/api/v1/library/movies')).status).toBe(401)
  })

  describe('GET /library/shows', () => {
    it('returns an empty library for a user with nothing watched', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows', { headers: { cookie } })
      expect(await json<ListLibraryShowsResponse>(res)).toEqual({ shows: [] })
    })

    it('does not double-count total episodes against every matching play (regression)', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Breaking Bad', year: 2008, genres: ['Drama', 'Crime'] })
        .returning()
      if (!show) throw new Error('failed to insert show')

      // Three regular seasons, 10 episodes each cached from the provider —
      // total should be 30, never multiplied by the number of plays below.
      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 1, episodeCount: 10 },
        { showId: show.id, seasonNumber: 2, episodeCount: 10 },
        { showId: show.id, seasonNumber: 3, episodeCount: 10 },
      ])

      const [ep1, ep2, ep3] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
          { showId: show.id, seasonNumber: 2, episodeNumber: 1 },
        ])
        .returning()
      if (!ep1 || !ep2 || !ep3) throw new Error('failed to insert episodes')

      // 3 distinct episodes, but 5 plays — ep1 watched twice, plus a
      // rewatch of ep2. Naively joining seasons and plays in one GROUP BY
      // would multiply the 30-episode total by however many play rows
      // matched, e.g. up to 150. It must stay 30.
      await db.insert(plays).values([
        { userId, episodeId: ep1.id, watchedAt: new Date('2026-01-01') },
        { userId, episodeId: ep1.id, watchedAt: new Date('2026-01-02') },
        { userId, episodeId: ep2.id, watchedAt: new Date('2026-01-03') },
        { userId, episodeId: ep2.id, watchedAt: new Date('2026-01-04') },
        { userId, episodeId: ep3.id, watchedAt: new Date('2026-01-05') },
      ])

      const res = await app.request('/api/v1/library/shows', { headers: { cookie } })
      const { shows: library } = await json<ListLibraryShowsResponse>(res)
      expect(library).toHaveLength(1)
      expect(library[0]).toMatchObject({
        id: show.id,
        genres: ['Drama', 'Crime'],
        totalEpisodes: 30,
        watchedEpisodes: 3,
      })
    })

    it('excludes specials (season 0) from both the watched count and the total', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db.insert(shows).values({ title: 'Doctor Who' }).returning()
      if (!show) throw new Error('failed to insert show')

      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 0, episodeCount: 12 }, // specials
        { showId: show.id, seasonNumber: 1, episodeCount: 10 },
      ])

      const [special, regular] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 0, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
        ])
        .returning()
      if (!special || !regular) throw new Error('failed to insert episodes')

      await db.insert(plays).values([
        { userId, episodeId: special.id, watchedAt: new Date('2026-01-01') },
        { userId, episodeId: regular.id, watchedAt: new Date('2026-01-02') },
      ])

      const res = await app.request('/api/v1/library/shows', { headers: { cookie } })
      const { shows: library } = await json<ListLibraryShowsResponse>(res)
      expect(library).toHaveLength(1)
      // total is 10 (season 1 only), not 22 — and watched is 1 (the regular
      // episode only), not 2, despite the special having been played.
      expect(library[0]).toMatchObject({ totalEpisodes: 10, watchedEpisodes: 1 })
    })

    it('still lists a show whose only plays are specials', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db.insert(shows).values({ title: 'Special Edition' }).returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 0, episodeCount: 3 })
      const [special] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 0, episodeNumber: 1 })
        .returning()
      if (!special) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId, episodeId: special.id, watchedAt: new Date() })

      const res = await app.request('/api/v1/library/shows', { headers: { cookie } })
      const { shows: library } = await json<ListLibraryShowsResponse>(res)
      expect(library).toHaveLength(1)
      expect(library[0]).toMatchObject({ watchedEpisodes: 0, totalEpisodes: null })
      expect(library[0]?.lastWatchedAt).toBeTruthy()
    })

    it('reports a null total when the show has no cached season data yet', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db.insert(shows).values({ title: 'Not Yet Refreshed' }).returning()
      if (!show) throw new Error('failed to insert show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId, episodeId: ep.id, watchedAt: new Date() })

      const res = await app.request('/api/v1/library/shows', { headers: { cookie } })
      const { shows: library } = await json<ListLibraryShowsResponse>(res)
      expect(library[0]).toMatchObject({ watchedEpisodes: 1, totalEpisodes: null })
    })

    it("does not leak another user's plays", async () => {
      const cookieA = await createUserAndCookie('a@example.com')
      await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!

      const [show] = await db.insert(shows).values({ title: 'Only Bs' }).returning()
      if (!show) throw new Error('failed to insert show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      const userIdB = await meId(cookieB)
      await db.insert(plays).values({ userId: userIdB, episodeId: ep.id, watchedAt: new Date() })

      const resA = await app.request('/api/v1/library/shows', { headers: { cookie: cookieA } })
      expect((await json<ListLibraryShowsResponse>(resA)).shows).toHaveLength(0)

      const resB = await app.request('/api/v1/library/shows', { headers: { cookie: cookieB } })
      expect((await json<ListLibraryShowsResponse>(resB)).shows).toHaveLength(1)
    })
  })

  describe('GET /library/movies', () => {
    it('counts rewatches and reports the last watch, absent from an unwatched movie', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [watched, unwatched] = await db
        .insert(movies)
        .values([{ title: 'The Matrix', year: 1999 }, { title: 'Never Watched' }])
        .returning()
      if (!watched || !unwatched) throw new Error('failed to insert movies')

      await db.insert(plays).values([
        { userId, movieId: watched.id, watchedAt: new Date('2026-01-01') },
        { userId, movieId: watched.id, watchedAt: new Date('2026-02-01') },
      ])

      const res = await app.request('/api/v1/library/movies', { headers: { cookie } })
      const { movies: library } = await json<ListLibraryMoviesResponse>(res)
      expect(library).toHaveLength(1)
      expect(library[0]).toMatchObject({ id: watched.id, playCount: 2 })
      expect(new Date(library[0]!.lastWatchedAt).toISOString()).toBe(
        new Date('2026-02-01').toISOString(),
      )
    })
  })
})
