import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plays } from '@rwnd/db'
import type { ListPlaysResponse, Play, User } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { BREAKING_BAD_SHOW_TMDB_ID, tmdbBreakingBadShow } from './fixtures/trakt.js'

const db = testDb()
const app = testApp()

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

describe('plays', () => {
  beforeEach(() => resetDb(db))

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/plays')
    expect(res.status).toBe(401)
  })

  describe('POST /plays', () => {
    beforeEach(() => {
      // resolveMovie() fetches from TMDB on first sight of an external ID —
      // stub it rather than hitting the network in tests.
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
          if (url.pathname === `/3/tv/${BREAKING_BAD_SHOW_TMDB_ID}`) {
            return new Response(JSON.stringify(tmdbBreakingBadShow), { status: 200 })
          }
          if (url.pathname === `/3/tv/${BREAKING_BAD_SHOW_TMDB_ID}/season/1/episode/1`) {
            return new Response(
              JSON.stringify({
                name: 'Pilot',
                season_number: 1,
                episode_number: 1,
                runtime: 58,
                air_date: '2008-01-20',
              }),
              { status: 200 },
            )
          }
          // No air_date at all — unaired, same as an episode TMDB hasn't
          // scheduled yet.
          if (url.pathname === `/3/tv/${BREAKING_BAD_SHOW_TMDB_ID}/season/1/episode/2`) {
            return new Response(
              JSON.stringify({ name: "Cat's in the Bag...", season_number: 1, episode_number: 2 }),
              { status: 200 },
            )
          }
          // A future air_date — announced but not yet aired.
          if (url.pathname === `/3/tv/${BREAKING_BAD_SHOW_TMDB_ID}/season/1/episode/3`) {
            return new Response(
              JSON.stringify({
                name: "...And the Bag's in the River",
                season_number: 1,
                episode_number: 3,
                air_date: '2099-01-01',
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected fetch in test: ${url}`)
        }),
      )
    })

    afterEach(() => vi.unstubAllGlobals())

    it('logs a movie watch and lists it back in history', async () => {
      const cookie = await createUserAndCookie()

      const created = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ movie: { source: 'tmdb', externalId: '603' } }),
      })
      expect(created.status).toBe(201)
      const play = await json<Play>(created)
      expect(play.media).toEqual({
        type: 'movie',
        title: 'The Matrix',
        posterPath: expect.stringContaining('/matrix.jpg'),
        movieSlug: 'the-matrix-1999',
      })

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      const { plays: history } = await json<ListPlaysResponse>(list)
      expect(history).toHaveLength(1)
      expect(history[0]?.id).toBe(play.id)
      expect(history[0]?.media).toMatchObject({ movieSlug: 'the-matrix-1999' })
    })

    it('rejects a second unknown-date watch for a movie that already has one', async () => {
      const cookie = await createUserAndCookie()
      const body = JSON.stringify({
        movie: { source: 'tmdb', externalId: '603' },
        watchedAt: '1900-01-01T00:00:00.000Z',
      })

      const firstRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body,
      })
      expect(firstRes.status).toBe(201)

      const secondRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body,
      })
      expect(secondRes.status).toBe(400)

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      expect((await json<ListPlaysResponse>(list)).plays).toHaveLength(1)
    })

    it('logs an episode watch with a showSlug that links to the show page', async () => {
      const cookie = await createUserAndCookie()

      const created = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          episode: {
            source: 'tmdb',
            showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
            seasonNumber: 1,
            episodeNumber: 1,
          },
        }),
      })
      expect(created.status).toBe(201)
      const play = await json<Play>(created)
      expect(play.media).toMatchObject({
        type: 'episode',
        title: 'Pilot',
        showTitle: 'Breaking Bad',
        showSlug: 'breaking-bad-2008',
      })

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      const { plays: history } = await json<ListPlaysResponse>(list)
      expect(history[0]?.media).toMatchObject({ showSlug: 'breaking-bad-2008' })
    })

    it('rejects a watchedAt in the future', async () => {
      const cookie = await createUserAndCookie()

      const res = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          movie: { source: 'tmdb', externalId: '603' },
          watchedAt: '2099-01-01T00:00:00.000Z',
        }),
      })
      expect(res.status).toBe(400)

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      expect((await json<ListPlaysResponse>(list)).plays).toHaveLength(0)
    })

    it('rejects logging a watch for an episode with no known air date', async () => {
      const cookie = await createUserAndCookie()

      const res = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          episode: {
            source: 'tmdb',
            showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
            seasonNumber: 1,
            episodeNumber: 2,
          },
        }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects logging a watch for an episode that has not aired yet', async () => {
      const cookie = await createUserAndCookie()

      const res = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          episode: {
            source: 'tmdb',
            showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
            seasonNumber: 1,
            episodeNumber: 3,
          },
        }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects a second unknown-date watch for an episode that already has one', async () => {
      const cookie = await createUserAndCookie()
      const body = JSON.stringify({
        episode: {
          source: 'tmdb',
          showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
          seasonNumber: 1,
          episodeNumber: 1,
        },
        watchedAt: '1900-01-01T00:00:00.000Z',
      })

      const firstRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body,
      })
      expect(firstRes.status).toBe(201)

      const secondRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body,
      })
      expect(secondRes.status).toBe(400)

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      expect((await json<ListPlaysResponse>(list)).plays).toHaveLength(1)
    })

    it('still allows a normal-dated rewatch of an episode that already has an unknown-date watch', async () => {
      const cookie = await createUserAndCookie()

      const unknownRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          episode: {
            source: 'tmdb',
            showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
            seasonNumber: 1,
            episodeNumber: 1,
          },
          watchedAt: '1900-01-01T00:00:00.000Z',
        }),
      })
      expect(unknownRes.status).toBe(201)

      const knownRes = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          episode: {
            source: 'tmdb',
            showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
            seasonNumber: 1,
            episodeNumber: 1,
          },
          watchedAt: '2020-01-01T00:00:00.000Z',
        }),
      })
      expect(knownRes.status).toBe(201)

      const list = await app.request('/api/v1/plays', { headers: { cookie } })
      expect((await json<ListPlaysResponse>(list)).plays).toHaveLength(2)
    })

    it("does not let a different user delete someone else's play", async () => {
      const cookieA = await createUserAndCookie()
      const created = await app.request('/api/v1/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookieA },
        body: JSON.stringify({ movie: { source: 'tmdb', externalId: '603' } }),
      })
      const play = await json<Play>(created)

      // Setup only ever creates one admin, and registration is closed by
      // default, so a second user is inserted directly for this test.
      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'other@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      const cookieB = extractCookie(loginB)!

      // The query scopes on (id, userId), so a mismatched owner reads as
      // "not found" rather than leaking that the play exists at all.
      const deleteAsOtherUser = await app.request(`/api/v1/plays/${play.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      })
      expect(deleteAsOtherUser.status).toBe(404)

      const stillThere = await app.request('/api/v1/plays', { headers: { cookie: cookieA } })
      expect((await json<ListPlaysResponse>(stillThere)).plays).toHaveLength(1)

      const deleteAsOwner = await app.request(`/api/v1/plays/${play.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieA },
      })
      expect(deleteAsOwner.status).toBe(204)
    })
  })

  it('rejects a play row with neither or both media references at the database level', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    await expect(
      db.insert(plays).values({ userId: me.id, watchedAt: new Date() }),
    ).rejects.toThrow()
  })
})
