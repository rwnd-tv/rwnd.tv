import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { movies, ratings, shows, watchlistItems } from '@rwnd/db'
import type { ListActivityResponse, Play } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { BREAKING_BAD_SHOW_TMDB_ID, tmdbBreakingBadShow } from './fixtures/trakt.js'

const db = testDb()
const app = testApp()

async function createUserAndCookie(email = 'watcher@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'correct-horse-battery-staple',
      displayName: 'Watcher',
    }),
  })
  return extractCookie(res)!
}

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
      throw new Error(`Unexpected fetch in test: ${url}`)
    }),
  )
}

/** Logs a movie watch and an episode watch (via the real POST /plays flow,
 * so movies/shows/episodes rows exist to attach a rating/watchlist entry
 * to), then seeds one rating, one watchlist entry and one dropped show
 * directly — there's no API route to create ratings/watchlist entries
 * (only the Trakt/CSV importers and backup restore do), and the dropped
 * toggle route only takes a slug, not an arbitrary timestamp. */
async function seedOneOfEach(cookie: string) {
  const movieWatch = await app.request('/api/v1/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      movie: { source: 'tmdb', externalId: '603' },
      watchedAt: '2026-01-01T12:00:00.000Z',
    }),
  })
  const movie = await json<Play>(movieWatch)

  const episodeWatch = await app.request('/api/v1/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      episode: {
        source: 'tmdb',
        showExternalId: String(BREAKING_BAD_SHOW_TMDB_ID),
        seasonNumber: 1,
        episodeNumber: 1,
      },
      watchedAt: '2026-01-02T12:00:00.000Z',
    }),
  })
  const episode = await json<Play>(episodeWatch)

  const [movieRow] = await db
    .select({ id: movies.id })
    .from(movies)
    .where(eq(movies.slug, 'the-matrix-1999'))
    .limit(1)
  const [showRow] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(eq(shows.slug, 'breaking-bad-2008'))
    .limit(1)
  if (!movieRow || !showRow) throw new Error('Expected seeded movie/show rows')

  const me = await json<{ id: string }>(
    await app.request('/api/v1/auth/me', { headers: { cookie } }),
  )

  const [rating] = await db
    .insert(ratings)
    .values({
      userId: me.id,
      entityType: 'movie',
      entityId: movieRow.id,
      rating: 8,
      ratedAt: new Date('2026-01-03T12:00:00.000Z'),
    })
    .returning()

  const [watchlistItem] = await db
    .insert(watchlistItems)
    .values({
      userId: me.id,
      entityType: 'show',
      entityId: showRow.id,
      listedAt: new Date('2026-01-04T12:00:00.000Z'),
    })
    .returning()

  const dropRes = await app.request(`/api/v1/library/shows/breaking-bad-2008/dropped`, {
    method: 'POST',
    headers: { cookie },
  })
  expect(dropRes.status).toBe(200)

  return { movie, episode, rating: rating!, watchlistItem: watchlistItem!, showId: showRow.id }
}

describe('activity', () => {
  beforeEach(() => resetDb(db))

  it('requires authentication', async () => {
    const getRes = await app.request('/api/v1/activity-feed')
    expect(getRes.status).toBe(401)
    const deleteRes = await app.request('/api/v1/activity-feed', { method: 'DELETE' })
    expect(deleteRes.status).toBe(401)
  })

  describe('GET /activity-feed', () => {
    beforeEach(stubTmdb)
    afterEach(() => vi.unstubAllGlobals())

    it('merges watches, ratings, watchlist entries and drops into one feed, newest first', async () => {
      const cookie = await createUserAndCookie()
      const seeded = await seedOneOfEach(cookie)

      const res = await app.request('/api/v1/activity-feed', { headers: { cookie } })
      expect(res.status).toBe(200)
      const body = await json<ListActivityResponse>(res)

      expect(body.total).toBe(4)
      expect(body.entries.map((e) => e.kind)).toEqual(['dropped', 'watchlist', 'rating', 'watch'])

      const dropped = body.entries[0]!
      expect(dropped.media).toMatchObject({ type: 'show', showSlug: 'breaking-bad-2008' })

      const watchlistEntry = body.entries[1]!
      expect(watchlistEntry.id).toBe(seeded.watchlistItem.id)
      expect(watchlistEntry.media).toMatchObject({ type: 'show', showSlug: 'breaking-bad-2008' })

      const ratingEntry = body.entries[2]!
      expect(ratingEntry.id).toBe(seeded.rating.id)
      expect(ratingEntry.rating).toBe(8)
      expect(ratingEntry.media).toMatchObject({ type: 'movie', movieSlug: 'the-matrix-1999' })

      const episodeWatch = body.entries[3]!
      expect(episodeWatch.id).toBe(seeded.episode.id)
      expect(episodeWatch.source).toBe('manual')
      expect(episodeWatch.media).toMatchObject({
        type: 'episode',
        showSlug: 'breaking-bad-2008',
        seasonNumber: 1,
        episodeNumber: 1,
      })
    })

    it('filters by title against the show/movie title, not the episode title', async () => {
      const cookie = await createUserAndCookie()
      await seedOneOfEach(cookie)

      const res = await app.request('/api/v1/activity-feed?q=matrix', { headers: { cookie } })
      const body = await json<ListActivityResponse>(res)
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]?.kind).toBe('rating')
    })

    it('filters by kind', async () => {
      const cookie = await createUserAndCookie()
      await seedOneOfEach(cookie)

      const res = await app.request('/api/v1/activity-feed?kinds=rating,watchlist', {
        headers: { cookie },
      })
      const body = await json<ListActivityResponse>(res)
      expect(body.entries.map((e) => e.kind).sort()).toEqual(['rating', 'watchlist'])
    })

    it('filters by an inclusive after/before date range', async () => {
      const cookie = await createUserAndCookie()
      const seeded = await seedOneOfEach(cookie)

      const res = await app.request(
        '/api/v1/activity-feed?after=2026-01-02T00:00:00.000Z&before=2026-01-03T23:59:59.999Z',
        { headers: { cookie } },
      )
      const body = await json<ListActivityResponse>(res)
      expect(body.entries.map((e) => e.id).sort()).toEqual(
        [seeded.episode.id, seeded.rating.id].sort(),
      )
    })

    it('includes entries dated exactly on a single-day after/before bound', async () => {
      const cookie = await createUserAndCookie()
      const seeded = await seedOneOfEach(cookie)

      const res = await app.request(
        '/api/v1/activity-feed?after=2026-01-01T00:00:00.000Z&before=2026-01-01T23:59:59.999Z',
        { headers: { cookie } },
      )
      const body = await json<ListActivityResponse>(res)
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]?.id).toBe(seeded.movie.id)
    })

    it('sorts by title', async () => {
      const cookie = await createUserAndCookie()
      await seedOneOfEach(cookie)

      const res = await app.request('/api/v1/activity-feed?sort=titleAsc', { headers: { cookie } })
      const body = await json<ListActivityResponse>(res)
      // "Breaking Bad" (rating/watchlist/dropped/episode-watch all resolve
      // to a "Breaking Bad"-titled row except the Matrix rating) sorts
      // before "The Matrix".
      expect(body.entries[body.entries.length - 1]?.media.title).toBe('The Matrix')
    })

    it('paginates with offset/limit and reports hasMore/total', async () => {
      const cookie = await createUserAndCookie()
      await seedOneOfEach(cookie)

      const page1 = await json<ListActivityResponse>(
        await app.request('/api/v1/activity-feed?limit=2&offset=0', { headers: { cookie } }),
      )
      expect(page1.entries).toHaveLength(2)
      expect(page1.total).toBe(4)
      expect(page1.hasMore).toBe(true)

      const page2 = await json<ListActivityResponse>(
        await app.request('/api/v1/activity-feed?limit=2&offset=2', { headers: { cookie } }),
      )
      expect(page2.entries).toHaveLength(2)
      expect(page2.hasMore).toBe(false)
    })

    it('stops showing a dropped entry once the show is un-dropped', async () => {
      const cookie = await createUserAndCookie()
      await seedOneOfEach(cookie)

      const undrop = await app.request('/api/v1/library/shows/breaking-bad-2008/dropped', {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(undrop.status).toBe(200)

      const res = await app.request('/api/v1/activity-feed', { headers: { cookie } })
      const body = await json<ListActivityResponse>(res)
      expect(body.entries.some((e) => e.kind === 'dropped')).toBe(false)
      expect(body.total).toBe(3)
    })

    it("only shows the requesting user's own activity", async () => {
      const cookieA = await createUserAndCookie('a@example.com')
      await seedOneOfEach(cookieA)
      await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!

      const res = await app.request('/api/v1/activity-feed', { headers: { cookie: cookieB } })
      const body = await json<ListActivityResponse>(res)
      expect(body.entries).toHaveLength(0)
    })
  })

  describe('DELETE /activity-feed', () => {
    beforeEach(stubTmdb)
    afterEach(() => vi.unstubAllGlobals())

    it('deletes a watch, deletes a rating, deletes a watchlist entry, and un-drops a dropped show', async () => {
      const cookie = await createUserAndCookie()
      const seeded = await seedOneOfEach(cookie)

      const res = await app.request('/api/v1/activity-feed', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          entries: [
            { kind: 'watch', id: seeded.episode.id },
            { kind: 'rating', id: seeded.rating.id },
            { kind: 'watchlist', id: seeded.watchlistItem.id },
            { kind: 'dropped', id: seeded.showId },
          ],
        }),
      })
      expect(res.status).toBe(204)

      const remaining = await json<ListActivityResponse>(
        await app.request('/api/v1/activity-feed', { headers: { cookie } }),
      )
      // The movie watch is the only entry left — everything else was removed.
      expect(remaining.entries).toHaveLength(1)
      expect(remaining.entries[0]?.kind).toBe('watch')
      expect(remaining.entries[0]?.id).toBe(seeded.movie.id)

      const [ratingRow] = await db.select().from(ratings).where(eq(ratings.id, seeded.rating.id))
      expect(ratingRow).toBeUndefined()
    })

    it("does not let a different user remove someone else's activity", async () => {
      const cookieA = await createUserAndCookie('a@example.com')
      const seeded = await seedOneOfEach(cookieA)
      await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!

      const res = await app.request('/api/v1/activity-feed', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ entries: [{ kind: 'rating', id: seeded.rating.id }] }),
      })
      // Silently a no-op (still 204) — same "re-scoped by userId in the
      // WHERE clause" convention as the bulk watch-removal routes.
      expect(res.status).toBe(204)

      const [ratingRow] = await db.select().from(ratings).where(eq(ratings.id, seeded.rating.id))
      expect(ratingRow).toBeDefined()
    })
  })
})
