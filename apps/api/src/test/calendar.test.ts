import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { episodes, movies, plays, shows, users } from '@rwnd/db'
import type { CalendarFeed, ListCalendarFeedsResponse, ListWatchlistsResponse } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

// APP_URL is what gates a link appearing at all (see build.ts's
// buildCalendarEvents doc comment) — CI sets it (.github/workflows/ci.yml),
// a bare local `vitest run` typically doesn't, so tests that need a link
// skip rather than assert a false negative outside CI.
const APP_URL = process.env.APP_URL

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
  return (await json<{ id: string }>(res)).id
}

async function createFeed(cookie: string, feedType: 'history' | 'shows') {
  const res = await app.request('/api/v1/calendar-feeds', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedType }),
  })
  expect(res.status).toBe(201)
  return json<CalendarFeed>(res)
}

async function seedShow(slug: string, title: string) {
  const [show] = await db.insert(shows).values({ title, slug }).returning()
  if (!show) throw new Error('failed to insert show')
  return show
}

async function seedMovie(slug: string, title: string) {
  const [movie] = await db.insert(movies).values({ title, slug }).returning()
  if (!movie) throw new Error('failed to insert movie')
  return movie
}

async function addToDefaultWatchlist(cookie: string, slug: string, kind: 'shows' | 'movies') {
  const listsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
  const defaultId = (await json<ListWatchlistsResponse>(listsRes)).watchlists[0]!.id
  const res = await app.request(`/api/v1/library/${kind}/${slug}/watchlists/${defaultId}`, {
    method: 'PUT',
    headers: { cookie },
  })
  expect(res.status).toBe(200)
}

describe('calendar feeds', () => {
  beforeEach(() => resetDb(db))

  describe('management routes', () => {
    it('requires authentication', async () => {
      expect((await app.request('/api/v1/calendar-feeds')).status).toBe(401)
    })

    it('creates a feed with server defaults, and lists it with the token present', async () => {
      const cookie = await createUserAndCookie()

      const feed = await createFeed(cookie, 'history')
      expect(feed).toMatchObject({
        feedType: 'history',
        settings: { includeMovies: true, includeShows: true },
        lastAccessedAt: null,
      })
      expect(feed.token).toBeTruthy()

      const listRes = await app.request('/api/v1/calendar-feeds', { headers: { cookie } })
      const { feeds } = await json<ListCalendarFeedsResponse>(listRes)
      expect(feeds).toHaveLength(1)
      // The "not one-time reveal" contract, asserted server-side too: the
      // token is present on every read, not just at creation.
      expect(feeds[0]!.token).toBe(feed.token)
    })

    it('creates a shows feed with its own defaults', async () => {
      const cookie = await createUserAndCookie()
      const feed = await createFeed(cookie, 'shows')
      expect(feed).toMatchObject({
        feedType: 'shows',
        settings: { includeDropped: false, futureOnly: true },
      })
    })

    it('rejects creating a second feed of the same type', async () => {
      const cookie = await createUserAndCookie()
      await createFeed(cookie, 'history')

      const res = await app.request('/api/v1/calendar-feeds', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedType: 'history' }),
      })
      expect(res.status).toBe(409)
    })

    it('updates only the settings applicable to the addressed feed type', async () => {
      const cookie = await createUserAndCookie()
      await createFeed(cookie, 'history')

      const res = await app.request('/api/v1/calendar-feeds/history', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        // includeDropped doesn't apply to 'history' — silently ignored,
        // not a 400.
        body: JSON.stringify({ includeMovies: false, includeDropped: true }),
      })
      expect(res.status).toBe(200)
      const updated = await json<CalendarFeed>(res)
      expect(updated.settings).toEqual({ includeMovies: false, includeShows: true })
    })

    it('regenerating invalidates the old token, preserves settings, and clears lastAccessedAt', async () => {
      const cookie = await createUserAndCookie()
      const original = await createFeed(cookie, 'shows')
      await app.request('/api/v1/calendar-feeds/shows', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeDropped: true }),
      })

      const regenRes = await app.request('/api/v1/calendar-feeds/shows/regenerate', {
        method: 'POST',
        headers: { cookie },
      })
      expect(regenRes.status).toBe(200)
      const regenerated = await json<CalendarFeed>(regenRes)
      expect(regenerated.token).not.toBe(original.token)
      expect(regenerated.settings).toEqual({
        includeDropped: true,
        futureOnly: true,
        includeAllWatched: false,
      })
      expect(regenerated.lastAccessedAt).toBeNull()

      const oldRes = await app.request(`/api/v1/calendar/${original.token}/feed.ics`)
      expect(oldRes.status).toBe(401)
      const newRes = await app.request(`/api/v1/calendar/${regenerated.token}/feed.ics`)
      expect(newRes.status).toBe(200)
    })

    it('deleting a feed 404s on a second delete, and its token stops working', async () => {
      const cookie = await createUserAndCookie()
      const feed = await createFeed(cookie, 'history')

      const delRes = await app.request('/api/v1/calendar-feeds/history', {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(delRes.status).toBe(204)

      const secondDelRes = await app.request('/api/v1/calendar-feeds/history', {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(secondDelRes.status).toBe(404)

      const feedRes = await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      expect(feedRes.status).toBe(401)
    })

    it("isolates feeds between users — one user's feed is invisible and unaddressable by another", async () => {
      const cookieA = await createUserAndCookie('a@example.com')
      await createFeed(cookieA, 'history')

      // /setup only ever creates the instance's first (owner) account —
      // a second user needs the createLocalUser + login route other test
      // files already use for this (e.g. library.test.ts, plays.test.ts).
      await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!

      const listRes = await app.request('/api/v1/calendar-feeds', { headers: { cookie: cookieB } })
      expect((await json<ListCalendarFeedsResponse>(listRes)).feeds).toHaveLength(0)

      const patchRes = await app.request('/api/v1/calendar-feeds/history', {
        method: 'PATCH',
        headers: { cookie: cookieB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMovies: false }),
      })
      expect(patchRes.status).toBe(404)
    })
  })

  describe('GET /calendar/{token}/feed.ics', () => {
    it('serves without a session, using content-type text/calendar', async () => {
      const cookie = await createUserAndCookie()
      const feed = await createFeed(cookie, 'history')

      const res = await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/calendar/)
      const body = await res.text()
      expect(body).toMatch(/^BEGIN:VCALENDAR/)
    })

    it('401s on a fabricated token', async () => {
      const res = await app.request('/api/v1/calendar/not-a-real-token/feed.ics')
      expect(res.status).toBe(401)
    })
  })

  describe('history feed content', () => {
    it('emits one event per play, filtered by includeMovies/includeShows', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const movie = await seedMovie('a-movie', 'A Movie')
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' })
        .returning()
      const moviePlay = (
        await db
          .insert(plays)
          .values({ userId, movieId: movie.id, watchedAt: new Date() })
          .returning()
      )[0]!
      const episodePlay = (
        await db
          .insert(plays)
          .values({ userId, episodeId: ep!.id, watchedAt: new Date() })
          .returning()
      )[0]!

      const feed = await createFeed(cookie, 'history')
      const both = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(both).toContain(`UID:play-${moviePlay.id}@rwnd.tv`)
      expect(both).toContain(`UID:play-${episodePlay.id}@rwnd.tv`)

      await app.request('/api/v1/calendar-feeds/history', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMovies: false }),
      })
      const showsOnly = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(showsOnly).not.toContain(`UID:play-${moviePlay.id}@rwnd.tv`)
      expect(showsOnly).toContain(`UID:play-${episodePlay.id}@rwnd.tv`)

      await app.request('/api/v1/calendar-feeds/history', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMovies: false, includeShows: false }),
      })
      const neither = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(neither).not.toContain('BEGIN:VEVENT')
      expect(neither).toContain('BEGIN:VCALENDAR')
    })

    it("includes a movie's and an episode's overview as DESCRIPTION, with no spoiler check", async () => {
      // History is always something the user already watched, unlike the
      // TV Shows feed below — no spoilerProtectionEnabled check applies
      // here regardless of the account's setting.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movie] = await db
        .insert(movies)
        .values({ title: 'A Movie', slug: 'a-movie', overview: 'A movie synopsis.' })
        .returning()
      const [show] = await db.insert(shows).values({ title: 'A Show', slug: 'a-show' }).returning()
      const [ep] = await db
        .insert(episodes)
        .values({
          showId: show!.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Pilot',
          overview: 'An episode synopsis.',
        })
        .returning()
      await db.insert(plays).values({ userId, movieId: movie!.id, watchedAt: new Date() })
      await db.insert(plays).values({ userId, episodeId: ep!.id, watchedAt: new Date() })

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).toContain('DESCRIPTION:A movie synopsis.')
      expect(body).toContain('DESCRIPTION:An episode synopsis.')
    })

    it.skipIf(!APP_URL)(
      'appends a link to the movie/episode page, blank-line separated from the description',
      async () => {
        const cookie = await createUserAndCookie()
        const userId = await meId(cookie)
        const [movie] = await db
          .insert(movies)
          .values({ title: 'A Movie', slug: 'a-movie', overview: 'A movie synopsis.' })
          .returning()
        const [show] = await db
          .insert(shows)
          .values({ title: 'A Show', slug: 'a-show' })
          .returning()
        // No overview on this one — the link should still appear, just
        // without a description or the blank line ahead of it.
        const [ep] = await db
          .insert(episodes)
          .values({ showId: show!.id, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' })
          .returning()
        await db.insert(plays).values({ userId, movieId: movie!.id, watchedAt: new Date() })
        await db.insert(plays).values({ userId, episodeId: ep!.id, watchedAt: new Date() })

        const feed = await createFeed(cookie, 'history')
        const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
        expect(body).toContain(`DESCRIPTION:A movie synopsis.\\n\\n${APP_URL}/movies/a-movie`)
        expect(body).toContain(`DESCRIPTION:${APP_URL}/shows/a-show/season/1/episode/1`)
      },
    )

    it("excludes Trakt's unknown-watch-date sentinel", async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const movie = await seedMovie('a-movie', 'A Movie')
      const sentinelPlay = (
        await db
          .insert(plays)
          .values({ userId, movieId: movie.id, watchedAt: new Date('1900-01-01T00:00:00.000Z') })
          .returning()
      )[0]!

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).not.toContain(`UID:play-${sentinelPlay.id}@rwnd.tv`)
    })

    it('emits the watchedAt instant as UTC regardless of the account timezone', async () => {
      // History events are timed (DTSTART/DTEND as UTC instants), unlike
      // the TV Shows feed's all-day events below — users.timezone is
      // never actually set by the app in practice (see build.ts's own
      // reasoning), so there's no local-day bucketing left to test here.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const movie = await seedMovie('a-movie', 'A Movie')
      await db.insert(plays).values({
        userId,
        movieId: movie.id,
        watchedAt: new Date('2026-09-04T23:30:00.000Z'),
      })
      const feed = await createFeed(cookie, 'history')

      // DTEND is the raw watchedAt instant (watchedAt is when playback
      // *finished* — see build.ts's own doc comment); DTSTART is derived
      // from it minus a runtime, so DTEND is the more direct thing to
      // assert against the account's timezone here.
      const utcBody = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(utcBody).toContain('DTEND:20260904T233000Z')

      await db.update(users).set({ timezone: 'Australia/Sydney' }).where(eq(users.id, userId))
      const sydneyBody = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(sydneyBody).toContain('DTEND:20260904T233000Z')
    })

    it("uses the movie's/episode's own runtime for the event's duration, ending at watchedAt", async () => {
      // watchedAt is when playback *finished* (see build.ts's own doc
      // comment on this), so the event's DTEND is the raw watchedAt and
      // DTSTART is watchedAt minus the runtime, not the other way round.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movie] = await db
        .insert(movies)
        .values({ title: 'A Movie', slug: 'a-movie', runtimeMinutes: 90 })
        .returning()
      await db.insert(plays).values({
        userId,
        movieId: movie!.id,
        watchedAt: new Date('2026-09-04T19:00:00.000Z'),
      })

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).toContain('DTSTART:20260904T173000Z')
      expect(body).toContain('DTEND:20260904T190000Z')
    })

    it("falls back to the show's sibling-episode median runtime when the played episode has none", async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      // Three unwatched siblings with known runtimes (median 24) plus the
      // one actually played, which has none of its own.
      await db.insert(episodes).values([
        { showId: show.id, seasonNumber: 1, episodeNumber: 1, runtimeMinutes: 20 },
        { showId: show.id, seasonNumber: 1, episodeNumber: 2, runtimeMinutes: 24 },
        { showId: show.id, seasonNumber: 1, episodeNumber: 3, runtimeMinutes: 28 },
      ])
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 4, runtimeMinutes: null })
        .returning()
      await db.insert(plays).values({
        userId,
        episodeId: ep!.id,
        watchedAt: new Date('2026-09-04T19:00:00.000Z'),
      })

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).toContain('DTSTART:20260904T183600Z')
      expect(body).toContain('DTEND:20260904T190000Z')
    })

    it('falls back to a flat 30 minutes when the show has no runtime data at all', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, runtimeMinutes: null })
        .returning()
      await db.insert(plays).values({
        userId,
        episodeId: ep!.id,
        watchedAt: new Date('2026-09-04T19:00:00.000Z'),
      })

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).toContain('DTSTART:20260904T183000Z')
      expect(body).toContain('DTEND:20260904T190000Z')
    })

    it('pushes the start later to avoid overlapping a strictly earlier previous play', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movieA] = await db
        .insert(movies)
        .values({ title: 'Movie A', slug: 'movie-a', runtimeMinutes: 60 })
        .returning()
      const [movieB] = await db
        .insert(movies)
        .values({ title: 'Movie B', slug: 'movie-b', runtimeMinutes: 90 })
        .returning()
      // Movie A finished at 18:00. Movie B finished at 19:00 with a
      // 90-minute runtime, which would naively start at 17:30 — before
      // Movie A had even finished.
      await db.insert(plays).values({
        userId,
        movieId: movieA!.id,
        watchedAt: new Date('2026-09-04T18:00:00.000Z'),
      })
      await db.insert(plays).values({
        userId,
        movieId: movieB!.id,
        watchedAt: new Date('2026-09-04T19:00:00.000Z'),
      })

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      // Movie A's own block is unclamped (nothing precedes it).
      expect(body).toContain('DTSTART:20260904T170000Z\r\nDTEND:20260904T180000Z')
      // Movie B's start is pushed from the naive 17:30 to Movie A's own
      // end (18:00), rather than overlapping it.
      expect(body).toContain('DTSTART:20260904T180000Z\r\nDTEND:20260904T190000Z')
    })

    it('keeps full duration and stacks when two plays share the exact same timestamp', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movieA] = await db
        .insert(movies)
        .values({ title: 'Movie A', slug: 'movie-a', runtimeMinutes: 45 })
        .returning()
      const [movieB] = await db
        .insert(movies)
        .values({ title: 'Movie B', slug: 'movie-b', runtimeMinutes: 45 })
        .returning()
      const tiedTimestamp = new Date('2026-09-04T19:00:00.000Z')
      const [playA] = await db
        .insert(plays)
        .values({ userId, movieId: movieA!.id, watchedAt: tiedTimestamp })
        .returning()
      const [playB] = await db
        .insert(plays)
        .values({ userId, movieId: movieB!.id, watchedAt: tiedTimestamp })
        .returning()

      const feed = await createFeed(cookie, 'history')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      const unfolded = body.replace(/\r\n /g, '')
      expect(unfolded).toContain(`UID:play-${playA!.id}@rwnd.tv`)
      expect(unfolded).toContain(`UID:play-${playB!.id}@rwnd.tv`)
      // Both plays keep the full 45-minute runtime rather than one
      // clamping to zero-length against the other.
      const dtstartCount = (unfolded.match(/DTSTART:20260904T181500Z/g) ?? []).length
      expect(dtstartCount).toBe(2)
    })
  })

  describe('shows feed content', () => {
    it('respects futureOnly, defaulting to true', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      // "Followed" via a recent watch of one episode; past and future
      // episodes of the same show are the candidates under test.
      const [watched, past, future] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2020-01-01' },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2, firstAired: '2020-01-08' },
          { showId: show.id, seasonNumber: 1, episodeNumber: 3, firstAired: '2099-01-01' },
        ])
        .returning()
      await db.insert(plays).values({ userId, episodeId: watched!.id, watchedAt: new Date() })

      const feed = await createFeed(cookie, 'shows')
      const futureOnlyBody = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(futureOnlyBody).toContain(`UID:episode-${future!.id}@rwnd.tv`)
      expect(futureOnlyBody).not.toContain(`UID:episode-${past!.id}@rwnd.tv`)

      await app.request('/api/v1/calendar-feeds/shows', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ futureOnly: false }),
      })
      const allBody = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(allBody).toContain(`UID:episode-${future!.id}@rwnd.tv`)
      expect(allBody).toContain(`UID:episode-${past!.id}@rwnd.tv`)
    })

    it('includes a watchlisted show with no watch history at all', async () => {
      const cookie = await createUserAndCookie()
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2099-01-01' })
        .returning()
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')

      const feed = await createFeed(cookie, 'shows')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).toContain(`UID:episode-${ep!.id}@rwnd.tv`)
    })

    it('excludes a dropped show by default, and includes it when includeDropped is set', async () => {
      const cookie = await createUserAndCookie()
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2099-01-01' })
        .returning()
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')
      const dropRes = await app.request('/api/v1/library/shows/a-show/dropped', {
        method: 'POST',
        headers: { cookie },
      })
      expect(dropRes.status).toBe(200)

      const feed = await createFeed(cookie, 'shows')
      const withoutDropped = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(withoutDropped).not.toContain(`UID:episode-${ep!.id}@rwnd.tv`)

      await app.request('/api/v1/calendar-feeds/shows', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeDropped: true }),
      })
      const withDropped = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(withDropped).toContain(`UID:episode-${ep!.id}@rwnd.tv`)
    })

    it('a show dropped after the feed was already fetched once disappears on the next fetch, with no special handling needed', async () => {
      // A subscribed feed is a full-replace on every client refresh, not
      // an incremental diff — this is the assertion that proves that
      // property holds, rather than something requiring a
      // STATUS:CANCELLED tombstone (iTIP-invitation machinery this
      // doesn't need).
      const cookie = await createUserAndCookie()
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2099-01-01' })
        .returning()
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')
      const feed = await createFeed(cookie, 'shows')

      const before = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(before).toContain(`UID:episode-${ep!.id}@rwnd.tv`)

      const dropRes = await app.request('/api/v1/library/shows/a-show/dropped', {
        method: 'POST',
        headers: { cookie },
      })
      expect(dropRes.status).toBe(200)

      const after = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(after).not.toContain(`UID:episode-${ep!.id}@rwnd.tv`)
    })

    it('excludes a show last watched over 30 days ago by default, and includes it when includeAllWatched is set', async () => {
      // Reproduces a real report: a show watched to completion months
      // ago, never watchlisted, silently vanished from its own feed
      // once the 30-day "recently watched" window passed.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2099-01-01' })
        .returning()
      const oldWatch = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      await db.insert(plays).values({ userId, episodeId: ep!.id, watchedAt: oldWatch })

      const feed = await createFeed(cookie, 'shows')
      const withoutAllWatched = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(withoutAllWatched).not.toContain(`UID:episode-${ep!.id}@rwnd.tv`)

      await app.request('/api/v1/calendar-feeds/shows', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAllWatched: true }),
      })
      const withAllWatched = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(withAllWatched).toContain(`UID:episode-${ep!.id}@rwnd.tv`)
    })

    it('never includes an episode with no firstAired', async () => {
      const cookie = await createUserAndCookie()
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: null })
        .returning()
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')

      const feed = await createFeed(cookie, 'shows')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).not.toContain(`UID:episode-${ep!.id}@rwnd.tv`)
    })

    it("omits an unwatched episode's DESCRIPTION when spoiler protection is on (the default), but includes a watched one's", async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      const [, watched] = await db
        .insert(episodes)
        .values([
          {
            showId: show.id,
            seasonNumber: 1,
            episodeNumber: 1,
            firstAired: '2099-01-01',
            overview: 'An unwatched synopsis.',
          },
          {
            showId: show.id,
            seasonNumber: 1,
            episodeNumber: 2,
            firstAired: '2099-01-08',
            overview: 'A watched synopsis.',
          },
        ])
        .returning()
      await db.insert(plays).values({ userId, episodeId: watched!.id, watchedAt: new Date() })
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')

      const feed = await createFeed(cookie, 'shows')
      const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(body).not.toContain('An unwatched synopsis.')
      expect(body).toContain('DESCRIPTION:A watched synopsis.')

      // With spoiler protection off, the same unwatched episode's
      // synopsis is no longer withheld — same rule
      // EpisodeDetailPage.tsx's spoilerHidden uses in the UI.
      await app.request('/api/v1/auth/me', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoilerProtectionEnabled: false }),
      })
      const unprotectedBody = await (
        await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)
      ).text()
      expect(unprotectedBody).toContain('DESCRIPTION:An unwatched synopsis.')
    })

    it.skipIf(!APP_URL)(
      "appends a link to the episode's page even when its synopsis is spoiler-hidden",
      async () => {
        const cookie = await createUserAndCookie()
        const show = await seedShow('a-show', 'A Show')
        await db.insert(episodes).values({
          showId: show.id,
          seasonNumber: 1,
          episodeNumber: 1,
          firstAired: '2099-01-01',
          overview: 'An unwatched synopsis.',
        })
        await addToDefaultWatchlist(cookie, 'a-show', 'shows')

        const feed = await createFeed(cookie, 'shows')
        const body = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
        // The synopsis stays withheld (spoiler protection defaults on,
        // this episode is unwatched)...
        expect(body).not.toContain('An unwatched synopsis.')
        // ...but the link itself is never gated by that check, and with
        // no description ahead of it there's no leading blank line.
        expect(body).toContain(`DESCRIPTION:${APP_URL}/shows/a-show/season/1/episode/1`)
      },
    )

    // Regression, found live 2026-09-04: a description backfilled well
    // after an episode row was first created didn't show up in a real
    // subscribed client, because DTSTAMP (derived only from `createdAt`
    // at the time) never changed to signal an update — see build.ts's
    // `latestOf` doc comment.
    it("advances DTSTAMP when an episode's overview is filled in later, so a client can detect the update", async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await seedShow('a-show', 'A Show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, firstAired: '2099-01-01' })
        .returning()
      await db.insert(plays).values({ userId, episodeId: ep!.id, watchedAt: new Date() })
      await addToDefaultWatchlist(cookie, 'a-show', 'shows')

      const feed = await createFeed(cookie, 'shows')
      const uid = `episode-${ep!.id}@rwnd.tv`
      const before = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      const dtstampBefore = before.match(new RegExp(`UID:${uid}\\r\\nDTSTAMP:(\\S+)`))?.[1]
      expect(dtstampBefore).toBeTruthy()

      // Simulates the overview backfill (apps/api/src/metadata/refresh.ts)
      // touching this episode well after it was first created.
      await db
        .update(episodes)
        .set({ overview: 'Filled in later.', overviewCheckedAt: new Date(Date.now() + 60_000) })
        .where(eq(episodes.id, ep!.id))

      const after = await (await app.request(`/api/v1/calendar/${feed.token}/feed.ics`)).text()
      expect(after).toContain('DESCRIPTION:Filled in later.')
      const dtstampAfter = after.match(new RegExp(`UID:${uid}\\r\\nDTSTAMP:(\\S+)`))?.[1]
      expect(dtstampAfter).toBeTruthy()
      expect(dtstampAfter).not.toBe(dtstampBefore)
    })
  })
})
