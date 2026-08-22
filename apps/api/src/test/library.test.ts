import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { droppedShows, episodes, externalIds, movies, plays, seasons, shows } from '@rwnd/db'
import type {
  EpisodeWatchedStatus,
  EpisodeWatches,
  ListLibraryMoviesResponse,
  ListLibraryShowsResponse,
  MarkShowWatchedResponse,
  RemoveShowWatchesResponse,
  SeasonDetail,
  ShowDetail,
  User,
} from '@rwnd/shared'
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
  afterEach(() => vi.unstubAllGlobals())

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
        .values({
          title: 'Breaking Bad',
          slug: 'breaking-bad',
          year: 2008,
          genres: ['Drama', 'Crime'],
        })
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

      const [show] = await db
        .insert(shows)
        .values({ title: 'Doctor Who', slug: 'doctor-who' })
        .returning()
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

      const [show] = await db
        .insert(shows)
        .values({ title: 'Special Edition', slug: 'special-edition' })
        .returning()
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

      const [show] = await db
        .insert(shows)
        .values({ title: 'Not Yet Refreshed', slug: 'not-yet-refreshed' })
        .returning()
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

      const [show] = await db
        .insert(shows)
        .values({ title: 'Only Bs', slug: 'only-bs' })
        .returning()
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

  describe('GET /library/shows/:id', () => {
    it('returns 404 for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show', { headers: { cookie } })
      expect(res.status).toBe(404)
    })

    it('reports real per-season watched counts, but excludes specials from the header total (regression)', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({
          title: 'Doctor Who',
          slug: 'doctor-who-2005',
          year: 2005,
          overview: 'A Time Lord.',
          genres: ['Sci-Fi'],
        })
        .returning()
      if (!show) throw new Error('failed to insert show')

      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 0, episodeCount: 2, name: 'Specials' },
        { showId: show.id, seasonNumber: 1, episodeCount: 10, name: 'Season 1' },
      ])

      const [special, ep1, ep2] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 0, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
        ])
        .returning()
      if (!special || !ep1 || !ep2) throw new Error('failed to insert episodes')

      await db.insert(plays).values([
        { userId, episodeId: special.id, watchedAt: new Date('2026-01-01') },
        { userId, episodeId: ep1.id, watchedAt: new Date('2026-01-02') },
        { userId, episodeId: ep2.id, watchedAt: new Date('2026-01-03') },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<ShowDetail>(res)

      // Header mirrors /library/shows: specials excluded from both halves.
      expect(detail).toMatchObject({
        id: show.id,
        title: 'Doctor Who',
        watchedEpisodes: 2,
        totalEpisodes: 10,
      })
      // But each season's own count is real — the special genuinely was watched.
      expect(detail.seasons).toEqual([
        expect.objectContaining({ seasonNumber: 0, episodeCount: 2, watchedEpisodes: 1 }),
        expect.objectContaining({ seasonNumber: 1, episodeCount: 10, watchedEpisodes: 2 }),
      ])
    })

    it('reports a null total and zero watched counts for a show with no plays or cached seasons', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Unwatched Show', slug: 'unwatched-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      const detail = await json<ShowDetail>(res)
      expect(detail).toMatchObject({
        watchedEpisodes: 0,
        totalEpisodes: null,
        firstWatchedAt: null,
        lastWatchedAt: null,
        hasUnknownWatchDate: false,
        seasons: [],
      })
    })

    it('reports the first/last watch across the whole show, specials included', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Long Runner', slug: 'long-runner' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 0, episodeCount: 1 },
        { showId: show.id, seasonNumber: 1, episodeCount: 2 },
      ])
      const [special, ep1, ep2] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 0, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
        ])
        .returning()
      if (!special || !ep1 || !ep2) throw new Error('failed to insert episodes')

      // The earliest watch is the special (2012), the latest is ep2
      // (2014) — both must count even though the header totals exclude
      // season 0.
      await db.insert(plays).values([
        { userId, episodeId: ep1.id, watchedAt: new Date('2013-06-15') },
        { userId, episodeId: special.id, watchedAt: new Date('2012-03-28') },
        { userId, episodeId: ep2.id, watchedAt: new Date('2014-09-12') },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      const detail = await json<ShowDetail>(res)
      expect(new Date(detail.firstWatchedAt!).toISOString()).toBe(
        new Date('2012-03-28').toISOString(),
      )
      expect(new Date(detail.lastWatchedAt!).toISOString()).toBe(
        new Date('2014-09-12').toISOString(),
      )
    })

    it('excludes 1900-01-01 (Trakt\'s "unknown date" sentinel) from the watched range', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Mixed Dates Show', slug: 'mixed-dates-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      const [known, unknown] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
        ])
        .returning()
      if (!known || !unknown) throw new Error('failed to insert episodes')

      await db.insert(plays).values([
        { userId, episodeId: known.id, watchedAt: new Date('2016-05-01') },
        { userId, episodeId: unknown.id, watchedAt: new Date('1900-01-01') },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      const detail = await json<ShowDetail>(res)
      // The range reflects only the known-dated play — the 1900 one must
      // not drag firstWatchedAt back to 1900 — but hasUnknownWatchDate
      // still flags that an unknown-dated play exists.
      expect(new Date(detail.firstWatchedAt!).toISOString()).toBe(
        new Date('2016-05-01').toISOString(),
      )
      expect(new Date(detail.lastWatchedAt!).toISOString()).toBe(
        new Date('2016-05-01').toISOString(),
      )
      expect(detail.hasUnknownWatchDate).toBe(true)
    })

    it('reports a null range with hasUnknownWatchDate true when every play is dated 1900-01-01', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({ title: 'All Unknown Dates', slug: 'all-unknown-dates' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId, episodeId: ep.id, watchedAt: new Date('1900-01-01') })

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      const detail = await json<ShowDetail>(res)
      expect(detail).toMatchObject({
        firstWatchedAt: null,
        lastWatchedAt: null,
        hasUnknownWatchDate: true,
      })
    })

    it("does not count another user's plays", async () => {
      const cookieA = await createUserAndCookie('a2@example.com')
      await createLocalUser(db, 'b2@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b2@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!
      const userIdB = await meId(cookieB)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Only Bs Watched This', slug: 'only-bs-watched-this' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 1 })
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId: userIdB, episodeId: ep.id, watchedAt: new Date() })

      const resA = await app.request(`/api/v1/library/shows/${show.slug}`, {
        headers: { cookie: cookieA },
      })
      expect((await json<ShowDetail>(resA)).watchedEpisodes).toBe(0)

      const resB = await app.request(`/api/v1/library/shows/${show.slug}`, {
        headers: { cookie: cookieB },
      })
      expect((await json<ShowDetail>(resB)).watchedEpisodes).toBe(1)
    })
  })

  describe('GET /library/shows/{slug}/seasons/{seasonNumber}', () => {
    async function insertShowWithSeason(seasonAirDate: string) {
      const [show] = await db
        .insert(shows)
        .values({ title: 'Rated Show', slug: 'rated-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db
        .insert(externalIds)
        .values({ entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '70001' })
      await db
        .insert(seasons)
        .values({ showId: show.id, seasonNumber: 1, episodeCount: 1, airDate: seasonAirDate })
      return show
    }

    it("surfaces the season's own TMDB rating", async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason('2020-01-01')
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/70001/season/1') {
            return new Response(
              JSON.stringify({
                overview: 'Season overview.',
                vote_average: 8.4,
                episodes: [
                  { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                ],
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      expect((await json<SeasonDetail>(res)).voteAverage).toBe(8.4)
    })

    it('treats a season vote_average of 0 as unrated, not a real zero score', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason('2020-01-01')
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/70001/season/1') {
            return new Response(
              JSON.stringify({
                overview: null,
                vote_average: 0,
                episodes: [
                  { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                ],
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1`, {
        headers: { cookie },
      })
      expect((await json<SeasonDetail>(res)).voteAverage).toBeNull()
    })
  })

  describe('GET/DELETE /library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays', () => {
    async function insertShowWithEpisode() {
      const [show] = await db
        .insert(shows)
        .values({ title: 'Rewatched Show', slug: 'rewatched-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      const [episode] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' })
        .returning()
      if (!episode) throw new Error('failed to insert episode')
      return { show, episode }
    }

    it('lists watches newest first, each with its own id', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const { show, episode } = await insertShowWithEpisode()
      await db.insert(plays).values([
        { userId, episodeId: episode.id, watchedAt: new Date('2020-01-01T00:00:00.000Z') },
        { userId, episodeId: episode.id, watchedAt: new Date('2021-01-01T00:00:00.000Z') },
      ])

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        { headers: { cookie } },
      )
      expect(res.status).toBe(200)
      const body = await json<EpisodeWatches>(res)
      expect(body.watches).toHaveLength(2)
      expect(body.watches[0]?.watchedAt).toBe('2021-01-01T00:00:00.000Z')
      expect(body.watches[1]?.watchedAt).toBe('2020-01-01T00:00:00.000Z')
      expect(body.watches[0]?.id).not.toBe(body.watches[1]?.id)
    })

    // Regression: two watches sharing an identical watchedAt (e.g. Trakt's
    // 1900-01-01 "unknown date" sentinel, common across several plays)
    // were seen removing each other rather than just the one ticked —
    // ORDER BY watchedAt alone gives Postgres no guarantee of a stable
    // order between ties, so the id-keyed selection in
    // UnwatchConfirmDialog.tsx could see the list "reorder" across two
    // fetches of the very same underlying data and reset a partial
    // selection back to "everything ticked". Fixed by tie-breaking on id.
    it('breaks a watchedAt tie by id, so repeated fetches return the same order', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const { show, episode } = await insertShowWithEpisode()
      const tiedAt = new Date('1900-01-01T00:00:00.000Z')
      const inserted = await db
        .insert(plays)
        .values([
          { userId, episodeId: episode.id, watchedAt: tiedAt },
          { userId, episodeId: episode.id, watchedAt: tiedAt },
        ])
        .returning()
      const [p1, p2] = inserted
      if (!p1 || !p2) throw new Error('failed to insert plays')
      const expectedOrder = [p1.id, p2.id].sort()

      const res1 = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        { headers: { cookie } },
      )
      const res2 = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        { headers: { cookie } },
      )
      expect((await json<EpisodeWatches>(res1)).watches.map((w) => w.id)).toEqual(expectedOrder)
      expect((await json<EpisodeWatches>(res2)).watches.map((w) => w.id)).toEqual(expectedOrder)
    })

    it('removing one of two watches that share an identical watchedAt leaves only the other', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const { show, episode } = await insertShowWithEpisode()
      const tiedAt = new Date('1900-01-01T00:00:00.000Z')
      const inserted = await db
        .insert(plays)
        .values([
          { userId, episodeId: episode.id, watchedAt: tiedAt },
          { userId, episodeId: episode.id, watchedAt: tiedAt },
        ])
        .returning()
      const [p1, p2] = inserted
      if (!p1 || !p2) throw new Error('failed to insert plays')

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        {
          method: 'DELETE',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [p1.id] }),
        },
      )
      expect(await json<EpisodeWatchedStatus>(res)).toEqual({
        watched: true,
        watchedCount: 1,
        lastWatchedAt: tiedAt.toISOString(),
      })

      const remaining = await db.select().from(plays).where(eq(plays.episodeId, episode.id))
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(p2.id)
    })

    it('returns an empty list for an episode never logged locally', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Never Logged', slug: 'never-logged' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        { headers: { cookie } },
      )
      expect(await json<EpisodeWatches>(res)).toEqual({ watches: [] })
    })

    it('removes only the ticked watches, leaving the rest and reporting the real remaining count', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const { show, episode } = await insertShowWithEpisode()
      const [play1, play2, play3] = await db
        .insert(plays)
        .values([
          { userId, episodeId: episode.id, watchedAt: new Date('2020-01-01T00:00:00.000Z') },
          { userId, episodeId: episode.id, watchedAt: new Date('2021-01-01T00:00:00.000Z') },
          { userId, episodeId: episode.id, watchedAt: new Date('2022-01-01T00:00:00.000Z') },
        ])
        .returning()
      if (!play1 || !play2 || !play3) throw new Error('failed to insert plays')

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        {
          method: 'DELETE',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [play1.id, play3.id] }),
        },
      )
      expect(res.status).toBe(200)
      expect(await json<EpisodeWatchedStatus>(res)).toEqual({
        watched: true,
        watchedCount: 1,
        lastWatchedAt: '2021-01-01T00:00:00.000Z',
      })

      const remaining = await db.select().from(plays).where(eq(plays.episodeId, episode.id))
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(play2.id)
    })

    it('removing every ticked watch reports fully unwatched', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const { show, episode } = await insertShowWithEpisode()
      const [play1] = await db
        .insert(plays)
        .values({ userId, episodeId: episode.id, watchedAt: new Date('2020-01-01T00:00:00.000Z') })
        .returning()
      if (!play1) throw new Error('failed to insert play')

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        {
          method: 'DELETE',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [play1.id] }),
        },
      )
      expect(await json<EpisodeWatchedStatus>(res)).toEqual({
        watched: false,
        watchedCount: 0,
        lastWatchedAt: null,
      })
    })

    it("cannot remove another user's watch, or a watch on a different episode, by id", async () => {
      const cookieA = await createUserAndCookie('a@example.com')
      const userIdA = await meId(cookieA)
      await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
      })
      const cookieB = extractCookie(loginB)!
      const userIdB = await meId(cookieB)

      const { show, episode: episode1 } = await insertShowWithEpisode()
      const [episode2] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 2, title: 'Ep 2' })
        .returning()
      if (!episode2) throw new Error('failed to insert episode')

      const [playA] = await db
        .insert(plays)
        .values({ userId: userIdA, episodeId: episode1.id, watchedAt: new Date('2020-01-01') })
        .returning()
      const [playOtherEpisode] = await db
        .insert(plays)
        .values({ userId: userIdA, episodeId: episode2.id, watchedAt: new Date('2020-01-01') })
        .returning()
      const [playB] = await db
        .insert(plays)
        .values({ userId: userIdB, episodeId: episode1.id, watchedAt: new Date('2020-01-01') })
        .returning()
      if (!playA || !playOtherEpisode || !playB) throw new Error('failed to insert plays')

      // User A tries to delete their own episode-1 watch plus another
      // user's watch and a watch on a different episode, all by id — only
      // the first should actually go.
      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        {
          method: 'DELETE',
          headers: { cookie: cookieA, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [playA.id, playB.id, playOtherEpisode.id] }),
        },
      )
      expect(await json<EpisodeWatchedStatus>(res)).toEqual({
        watched: false,
        watchedCount: 0,
        lastWatchedAt: null,
      })

      const remainingIds = (await db.select({ id: plays.id }).from(plays)).map((p) => p.id)
      expect(remainingIds).toContain(playB.id)
      expect(remainingIds).toContain(playOtherEpisode.id)
      expect(remainingIds).not.toContain(playA.id)
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request(
        '/api/v1/library/shows/no-such-show/seasons/1/episodes/1/plays',
        {
          method: 'DELETE',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000000'] }),
        },
      )
      expect(res.status).toBe(404)
    })

    it('rejects an empty ids array', async () => {
      const cookie = await createUserAndCookie()
      const { show } = await insertShowWithEpisode()
      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/plays`,
        {
          method: 'DELETE',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [] }),
        },
      )
      expect(res.status).toBe(400)
    })
  })

  describe('POST/DELETE /library/shows/{slug}/dropped', () => {
    it('marks a show as dropped, then un-drops it — reflected in both the detail and gallery endpoints', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [show] = await db
        .insert(shows)
        .values({ title: 'Some Show', slug: 'some-show-dropped-1' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      // Needs at least one play to appear in /library/shows at all — see
      // the "does not double-count" test above for why that query drives
      // from watched plays, not the shows table.
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 1 })
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId, episodeId: ep.id, watchedAt: new Date() })

      const dropRes = await app.request(`/api/v1/library/shows/${show.slug}/dropped`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(dropRes.status).toBe(200)
      const dropped = await json<{ dropped: boolean; droppedAt: string | null }>(dropRes)
      expect(dropped.dropped).toBe(true)
      expect(dropped.droppedAt).not.toBeNull()

      const detail = await json<ShowDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } }),
      )
      expect(detail.dropped).toBe(true)

      const gallery = await json<ListLibraryShowsResponse>(
        await app.request('/api/v1/library/shows', { headers: { cookie } }),
      )
      expect(gallery.shows.find((s) => s.slug === show.slug)?.dropped).toBe(true)

      const undropRes = await app.request(`/api/v1/library/shows/${show.slug}/dropped`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(undropRes.status).toBe(200)
      expect(await json<{ dropped: boolean; droppedAt: string | null }>(undropRes)).toEqual({
        dropped: false,
        droppedAt: null,
      })

      const detailAfterUndrop = await json<ShowDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } }),
      )
      expect(detailAfterUndrop.dropped).toBe(false)
    })

    it("manually toggling back to Trakt's own state clears the override instead of pinning it", async () => {
      // Reproduces James's report: a show Trakt already lists as dropped,
      // manually undropped then re-dropped in rwnd.tv, should end up with
      // no manual override at all (not stuck "manually dropped" forever) —
      // see droppedShows's doc comment in packages/db/src/schema.ts.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [show] = await db
        .insert(shows)
        .values({ title: 'Trakt Dropped Show', slug: 'trakt-dropped-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(droppedShows).values({
        userId,
        showId: show.id,
        traktDropped: true,
        traktDroppedAt: new Date('2026-01-01T00:00:00.000Z'),
      })

      const undropRes = await app.request(`/api/v1/library/shows/${show.slug}/dropped`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(await json<{ dropped: boolean }>(undropRes)).toMatchObject({ dropped: false })
      const [afterUndrop] = await db
        .select()
        .from(droppedShows)
        .where(eq(droppedShows.showId, show.id))
      expect(afterUndrop?.manualDropped).toBe(false)

      const dropRes = await app.request(`/api/v1/library/shows/${show.slug}/dropped`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(await json<{ dropped: boolean }>(dropRes)).toMatchObject({ dropped: true })
      const [afterRedrop] = await db
        .select()
        .from(droppedShows)
        .where(eq(droppedShows.showId, show.id))
      expect(afterRedrop?.manualDropped).toBeNull()
      expect(afterRedrop?.traktDropped).toBe(true)
    })

    it('undropping a show that was never dropped is a harmless no-op', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Never Dropped', slug: 'never-dropped' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/dropped`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      expect(await json<{ dropped: boolean }>(res)).toMatchObject({ dropped: false })
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/dropped', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /library/shows/{slug}/watched', () => {
    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    /** Season 1 has 2 episodes, season 2 has 1, specials (season 0) has 1 —
     * specials must never be counted/fetched. */
    function stubTmdbSeasons() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/50001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2020-01-08' },
              ],
            })
          }
          if (url.pathname === '/3/tv/50001/season/2') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 2, episode_number: 1, air_date: '2021-01-01' },
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )
    }

    async function insertShowWithSeasons() {
      const [show] = await db
        .insert(shows)
        .values({ title: 'Watch Whole Show', slug: 'watch-whole-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db
        .insert(externalIds)
        .values({ entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '50001' })
      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 0, episodeCount: 1 },
        { showId: show.id, seasonNumber: 1, episodeCount: 2 },
        { showId: show.id, seasonNumber: 2, episodeCount: 1 },
      ])
      return show
    }

    it('logs a new watch for every non-special episode, resolving them from the provider', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T12:00:00.000Z' }),
      })
      expect(res.status).toBe(201)
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 3 })

      const playRows = await db
        .select({ watchedAt: plays.watchedAt, seasonNumber: episodes.seasonNumber })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
      expect(playRows).toHaveLength(3)
      expect(playRows.every((row) => row.seasonNumber > 0)).toBe(true)
      expect(
        playRows.every((row) => row.watchedAt.toISOString() === '2026-06-01T12:00:00.000Z'),
      ).toBe(true)

      // Season 0's single episode was never resolved locally at all — the
      // route never called provider.getSeason() for it.
      const specialsEpisodes = await db
        .select()
        .from(episodes)
        .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, 0)))
      expect(specialsEpisodes).toHaveLength(0)
    })

    it('does not add another watch to an already-fully-watched show — nothing left to fill', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      const firstRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(firstRes)).toEqual({ count: 3 })

      const secondRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(secondRes)).toEqual({ count: 0 })

      const totalPlays = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(totalPlays).toHaveLength(3)
      // Untouched — not overwritten by the second, no-op call.
      expect(
        totalPlays.every((p) => p.watchedAt.toISOString() === '2026-01-01T00:00:00.000Z'),
      ).toBe(true)
    })

    it('fills in only the episodes not yet watched, leaving an already-watched one alone', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      // A watch that predates this route ever running — same shape resolving
      // the season would produce, so the route finds it already resolved.
      const [existing] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' })
        .returning()
      if (!existing) throw new Error('failed to insert episode')
      await db
        .insert(plays)
        .values({ userId, episodeId: existing.id, watchedAt: new Date('2020-02-01T00:00:00.000Z') })

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z' }),
      })
      // Only the other 2 episodes (season 1 ep 2, season 2 ep 1) were missing.
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 2 })

      const playRows = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(playRows).toHaveLength(3)
      const existingPlay = playRows.find((p) => p.episodeId === existing.id)
      expect(existingPlay?.watchedAt.toISOString()).toBe('2020-02-01T00:00:00.000Z')
    })

    it('logs each episode at its own release date when useReleaseDate is set', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ useReleaseDate: true }),
      })
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 3 })

      const playRows = await db
        .select({
          watchedAt: plays.watchedAt,
          seasonNumber: episodes.seasonNumber,
          episodeNumber: episodes.episodeNumber,
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
      const byEpisode = new Map(
        playRows.map((r) => [`${r.seasonNumber}:${r.episodeNumber}`, r.watchedAt.toISOString()]),
      )
      expect(byEpisode.get('1:1')).toBe('2020-01-01T00:00:00.000Z')
      expect(byEpisode.get('1:2')).toBe('2020-01-08T00:00:00.000Z')
      expect(byEpisode.get('2:1')).toBe('2021-01-01T00:00:00.000Z')
    })

    it('skips episodes with no known release date when useReleaseDate is set', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeasons()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/50001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2 }, // unaired — no air_date
              ],
            })
          }
          if (url.pathname === '/3/tv/50001/season/2') {
            return jsonResponse({
              episodes: [{ name: 'Ep 1', season_number: 2, episode_number: 1 }], // unaired
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ useReleaseDate: true }),
      })
      // Only season 1 episode 1 has a known release date.
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 1 })
    })

    it('skips unaired episodes (unknown or future release date) even with a manual watchedAt', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeasons()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/50001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2099-01-01' }, // future
              ],
            })
          }
          if (url.pathname === '/3/tv/50001/season/2') {
            return jsonResponse({
              episodes: [{ name: 'Ep 1', season_number: 2, episode_number: 1 }], // unaired — no air_date
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z' }),
      })
      // Only season 1 episode 1 has actually aired.
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 1 })
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/watched', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(404)
    })

    it('404s for a show with no known TMDB id', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'No TMDB id', slug: 'no-tmdb-id' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /library/shows/{slug}/watched', () => {
    it('removes every watch for non-special episodes, leaving specials and other users untouched', async () => {
      const cookieA = await createUserAndCookie('remover@example.com')
      const userIdA = await meId(cookieA)
      await createLocalUser(db, 'other-watcher@example.com', 'correct-horse-battery-staple')
      const loginB = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'other-watcher@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      const cookieB = extractCookie(loginB)!
      const userIdB = await meId(cookieB)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Remove Watches', slug: 'remove-watches' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      const [special, ep1, ep2] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 0, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
        ])
        .returning()
      if (!special || !ep1 || !ep2) throw new Error('failed to insert episodes')

      await db.insert(plays).values([
        { userId: userIdA, episodeId: special.id, watchedAt: new Date('2026-01-01') },
        { userId: userIdA, episodeId: ep1.id, watchedAt: new Date('2026-01-02') },
        // A rewatch — two plays against the same episode, both must go.
        { userId: userIdA, episodeId: ep1.id, watchedAt: new Date('2026-01-03') },
        { userId: userIdA, episodeId: ep2.id, watchedAt: new Date('2026-01-04') },
        // Another user's watch of the same episode must survive.
        { userId: userIdB, episodeId: ep1.id, watchedAt: new Date('2026-01-05') },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'DELETE',
        headers: { cookie: cookieA },
      })
      expect(res.status).toBe(200)
      expect(await json<RemoveShowWatchesResponse>(res)).toEqual({ count: 3 })

      const remaining = await db
        .select({ userId: plays.userId, episodeId: plays.episodeId })
        .from(plays)
      expect(remaining).toHaveLength(2)
      expect(remaining).toContainEqual({ userId: userIdA, episodeId: special.id })
      expect(remaining).toContainEqual({ userId: userIdB, episodeId: ep1.id })
    })

    it('is a harmless no-op for a show with nothing watched', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Nothing Watched', slug: 'nothing-watched' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      expect(await json<RemoveShowWatchesResponse>(res)).toEqual({ count: 0 })
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/watched', {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /library/shows/{slug}/seasons/{seasonNumber}/watched', () => {
    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    async function insertShowWithSeason0And1() {
      const [show] = await db
        .insert(shows)
        .values({ title: 'Season Watch Show', slug: 'season-watch-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db
        .insert(externalIds)
        .values({ entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '60001' })
      await db.insert(seasons).values([
        { showId: show.id, seasonNumber: 0, episodeCount: 1 },
        { showId: show.id, seasonNumber: 1, episodeCount: 2 },
      ])
      return show
    }

    it('logs a new watch for every episode of the season, resolving them from the provider', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeason0And1()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2020-01-08' },
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T12:00:00.000Z' }),
      })
      expect(res.status).toBe(201)
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 2 })

      const playRows = await db
        .select({ seasonNumber: episodes.seasonNumber })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
      expect(playRows).toHaveLength(2)
      expect(playRows.every((row) => row.seasonNumber === 1)).toBe(true)
    })

    it('works for specials (season 0), unlike the show-level route', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason0And1()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/0') {
            return jsonResponse({
              episodes: [
                { name: 'Special', season_number: 0, episode_number: 1, air_date: '2020-01-01' },
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/0/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(201)
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 1 })
    })

    it('fills in only the episode not yet watched, leaving an already-watched one alone', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeason0And1()
      const [existing] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' })
        .returning()
      if (!existing) throw new Error('failed to insert episode')
      await db
        .insert(plays)
        .values({ userId, episodeId: existing.id, watchedAt: new Date('2020-02-01T00:00:00.000Z') })

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2020-01-08' },
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 1 })

      const playRows = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(playRows).toHaveLength(2)
      const existingPlay = playRows.find((p) => p.episodeId === existing.id)
      expect(existingPlay?.watchedAt.toISOString()).toBe('2020-02-01T00:00:00.000Z')
    })

    it('logs each episode at its own release date when useReleaseDate is set', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeason0And1()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2020-01-08' },
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ useReleaseDate: true }),
      })
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 2 })

      const playRows = await db
        .select({ watchedAt: plays.watchedAt, episodeNumber: episodes.episodeNumber })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
      const byEpisode = new Map(playRows.map((r) => [r.episodeNumber, r.watchedAt.toISOString()]))
      expect(byEpisode.get(1)).toBe('2020-01-01T00:00:00.000Z')
      expect(byEpisode.get(2)).toBe('2020-01-08T00:00:00.000Z')
    })

    it('skips unaired episodes (unknown or future release date) even with a manual watchedAt', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason0And1()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2099-01-01' }, // future
              ],
            })
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z' }),
      })
      // Only episode 1 has actually aired.
      expect(await json<MarkShowWatchedResponse>(res)).toEqual({ count: 1 })
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/seasons/1/watched', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /library/shows/{slug}/seasons/{seasonNumber}/watched', () => {
    it("removes only this season's watches, leaving other seasons and users untouched", async () => {
      const cookieA = await createUserAndCookie('season-remover@example.com')
      const userIdA = await meId(cookieA)
      const [show] = await db
        .insert(shows)
        .values({ title: 'Season Remove Watches', slug: 'season-remove-watches' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      const [s1e1, s1e2, s2e1] = await db
        .insert(episodes)
        .values([
          { showId: show.id, seasonNumber: 1, episodeNumber: 1 },
          { showId: show.id, seasonNumber: 1, episodeNumber: 2 },
          { showId: show.id, seasonNumber: 2, episodeNumber: 1 },
        ])
        .returning()
      if (!s1e1 || !s1e2 || !s2e1) throw new Error('failed to insert episodes')

      await db.insert(plays).values([
        { userId: userIdA, episodeId: s1e1.id, watchedAt: new Date('2026-01-01') },
        // A rewatch — two plays against the same episode, both must go.
        { userId: userIdA, episodeId: s1e1.id, watchedAt: new Date('2026-01-02') },
        { userId: userIdA, episodeId: s1e2.id, watchedAt: new Date('2026-01-03') },
        // A different season's watch must survive.
        { userId: userIdA, episodeId: s2e1.id, watchedAt: new Date('2026-01-04') },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'DELETE',
        headers: { cookie: cookieA },
      })
      expect(res.status).toBe(200)
      expect(await json<RemoveShowWatchesResponse>(res)).toEqual({ count: 3 })

      const remaining = await db.select({ episodeId: plays.episodeId }).from(plays)
      expect(remaining).toEqual([{ episodeId: s2e1.id }])
    })

    it('is a harmless no-op for a season with nothing watched', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Season Nothing Watched', slug: 'season-nothing-watched' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      expect(await json<RemoveShowWatchesResponse>(res)).toEqual({ count: 0 })
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/seasons/1/watched', {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(404)
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
