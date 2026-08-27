import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  droppedShows,
  episodes,
  externalIds,
  movies,
  plays,
  ratings,
  seasons,
  shows,
  users,
} from '@rwnd/db'
import type {
  ListLibraryMoviesResponse,
  ListLibraryShowsResponse,
  MarkShowWatchedResponse,
  MovieDetail,
  OnDeckResponse,
  RatingStatus,
  RemoveShowWatchesResponse,
  SeasonDetail,
  ShowDetail,
  User,
  WatchedStatus,
  Watches,
} from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { createApp } from '../app.js'
import type { MetadataProvider, ProviderSeason } from '../providers/types.js'
import { BREAKING_BAD_SHOW_TMDB_ID } from './fixtures/trakt.js'

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

    it('a rated show with several plays still reports correct counts, and the rating (fan-out guard)', async () => {
      // Same regression risk as the test above, now that a ratings LEFT
      // JOIN sits alongside droppedShows in this query — ratings_user_
      // entity_idx must keep it from multiplying rows.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [show] = await db
        .insert(shows)
        .values({ title: 'Rated And Rewatched', slug: 'rated-and-rewatched' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 1 })
      const [ep] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1 })
        .returning()
      if (!ep) throw new Error('failed to insert episode')
      await db.insert(plays).values([
        { userId, episodeId: ep.id, watchedAt: new Date('2026-01-01') },
        { userId, episodeId: ep.id, watchedAt: new Date('2026-01-02') },
      ])
      await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 9 }),
      })

      const { shows: library } = await json<ListLibraryShowsResponse>(
        await app.request('/api/v1/library/shows', { headers: { cookie } }),
      )
      expect(library.find((s) => s.slug === show.slug)).toMatchObject({
        totalEpisodes: 1,
        watchedEpisodes: 1,
        myRating: 9,
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

    it('carries metadataSource/metadataRefreshedAt, null when the show has never been resolved via a provider', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'No Provider Yet', slug: 'no-provider-yet' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<ShowDetail>(res)
      // Never resolved via resolveShow/refreshOneShow (migration 0012's
      // backfill only covers rows that already had a tmdb external_ids row
      // at the time it ran) — metadataSource is genuinely unknown here.
      expect(detail.metadataSource).toBeNull()
      expect(detail.metadataRefreshedAt).toBeTruthy()
    })

    it('carries metadataSource once the show has an external id from a configured provider', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Resolved Show', slug: 'resolved-show', metadataSource: 'tmdb' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(externalIds).values({
        entityType: 'show',
        entityId: show.id,
        source: 'tmdb',
        externalId: '999',
      })

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<ShowDetail>(res)
      expect(detail.metadataSource).toBe('tmdb')
    })

    it('carries tvdbId independently of tmdbId/metadataSource — a show can have both, either, or neither', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({
          title: 'Cross-Provider Show',
          slug: 'cross-provider-show',
          metadataSource: 'tmdb',
        })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(externalIds).values([
        { entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '111' },
        { entityType: 'show', entityId: show.id, source: 'tvdb', externalId: '222' },
      ])

      const res = await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<ShowDetail>(res)
      // TVDB currently the fallback provider (metadataSource: 'tmdb'), but
      // the link is still present — see showDetailSchema's `tvdbId` doc
      // comment for why it isn't gated on metadataSource.
      expect(detail.tmdbId).toBe('111')
      expect(detail.tvdbId).toBe('222')
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

  describe('GET /library/on-deck', () => {
    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    /** Season 1: episodes 1-3, all aired. Season 2: episode 1, aired. */
    function stubTmdbSeasons() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/60001/season/1') {
            return jsonResponse({
              episodes: [
                { name: 'Ep 1', season_number: 1, episode_number: 1, air_date: '2020-01-01' },
                { name: 'Ep 2', season_number: 1, episode_number: 2, air_date: '2020-01-08' },
                { name: 'Ep 3', season_number: 1, episode_number: 3, air_date: '2020-01-15' },
              ],
            })
          }
          if (url.pathname === '/3/tv/60001/season/2') {
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

    async function insertShowWithSeasons(seasonNumbers: number[]) {
      const [show] = await db
        .insert(shows)
        .values({ title: 'Gap Show', slug: 'gap-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db
        .insert(externalIds)
        .values({ entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '60001' })
      await db.insert(seasons).values(
        seasonNumbers.map((seasonNumber) => ({
          showId: show.id,
          seasonNumber,
          episodeCount: seasonNumber === 1 ? 3 : 1,
        })),
      )
      return show
    }

    async function watchEpisode(userId: string, showId: string, season: number, episode: number) {
      const [inserted] = await db
        .insert(episodes)
        .values({ showId, seasonNumber: season, episodeNumber: episode })
        .onConflictDoNothing()
        .returning({ id: episodes.id })
      const row =
        inserted ??
        (
          await db
            .select({ id: episodes.id })
            .from(episodes)
            .where(
              and(
                eq(episodes.showId, showId),
                eq(episodes.seasonNumber, season),
                eq(episodes.episodeNumber, episode),
              ),
            )
        )[0]
      if (!row) throw new Error('failed to insert episode')
      await db.insert(plays).values({ userId, episodeId: row.id, watchedAt: new Date() })
    }

    it('excludes a gap episode by default — skips over it, finding the next real episode instead', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons([1, 2])
      stubTmdbSeasons()

      // Watched episode 1 and 3 of season 1, skipping episode 2 — then
      // season 2 episode 1 is the true "next" one, not the skipped gap.
      await watchEpisode(userId, show.id, 1, 1)
      await watchEpisode(userId, show.id, 1, 3)

      const res = await app.request('/api/v1/library/on-deck', { headers: { cookie } })
      expect(res.status).toBe(200)
      const body = await json<OnDeckResponse>(res)
      expect(body.shows).toHaveLength(1)
      expect(body.shows[0]).toMatchObject({ slug: 'gap-show', seasonNumber: 2, episodeNumber: 1 })
    })

    it('excludes the show entirely when the only unwatched episode is a gap and nothing comes after it', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons([1])
      stubTmdbSeasons()

      // Watched episode 1 and 3, skipping episode 2 — with no season 2,
      // there's nothing after episode 3, so the skipped episode 2 must not
      // be surfaced by default.
      await watchEpisode(userId, show.id, 1, 1)
      await watchEpisode(userId, show.id, 1, 3)

      const res = await app.request('/api/v1/library/on-deck', { headers: { cookie } })
      const body = await json<OnDeckResponse>(res)
      expect(body.shows).toHaveLength(0)
    })

    it('surfaces the gap episode when the user has opted into onDeckFillGaps', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      await db.update(users).set({ onDeckFillGaps: true }).where(eq(users.id, userId))
      const show = await insertShowWithSeasons([1])
      stubTmdbSeasons()

      await watchEpisode(userId, show.id, 1, 1)
      await watchEpisode(userId, show.id, 1, 3)

      const res = await app.request('/api/v1/library/on-deck', { headers: { cookie } })
      const body = await json<OnDeckResponse>(res)
      expect(body.shows).toHaveLength(1)
      expect(body.shows[0]).toMatchObject({ slug: 'gap-show', seasonNumber: 1, episodeNumber: 2 })
    })

    it('surfaces the plain next episode for a linear watcher regardless of the setting', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons([1, 2])
      stubTmdbSeasons()

      await watchEpisode(userId, show.id, 1, 1)
      await watchEpisode(userId, show.id, 1, 2)

      const res = await app.request('/api/v1/library/on-deck', { headers: { cookie } })
      const body = await json<OnDeckResponse>(res)
      expect(body.shows).toHaveLength(1)
      expect(body.shows[0]).toMatchObject({ slug: 'gap-show', seasonNumber: 1, episodeNumber: 3 })
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

    it('marks an episode hasUnknownWatch once one of its plays is dated 1900-01-01', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeason('2020-01-01')
      const [episode] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' })
        .returning()
      if (!episode) throw new Error('failed to insert episode')
      await db
        .insert(plays)
        .values({ userId, episodeId: episode.id, watchedAt: new Date('1900-01-01T00:00:00.000Z') })

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/70001/season/1') {
            return new Response(
              JSON.stringify({
                overview: null,
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
      expect((await json<SeasonDetail>(res)).episodes[0]?.hasUnknownWatch).toBe(true)
    })

    it('does not mark an episode hasUnknownWatch for a normal-dated watch', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeason('2020-01-01')
      const [episode] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' })
        .returning()
      if (!episode) throw new Error('failed to insert episode')
      await db
        .insert(plays)
        .values({ userId, episodeId: episode.id, watchedAt: new Date('2020-06-01T00:00:00.000Z') })

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/tv/70001/season/1') {
            return new Response(
              JSON.stringify({
                overview: null,
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
      expect((await json<SeasonDetail>(res)).episodes[0]?.hasUnknownWatch).toBe(false)
    })

    it('resolves tvdbSeasonId/tvdbEpisodeId via a live TVDB side-lookup, independent of the primary provider', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Cross-Provider Season Show', slug: 'cross-provider-season-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(externalIds).values([
        { entityType: 'show', entityId: show.id, source: 'tmdb', externalId: '70001' },
        { entityType: 'show', entityId: show.id, source: 'tvdb', externalId: '9001' },
      ])
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 1 })

      // Fakes rather than real Tmdb/TvdbProvider instances — this test is
      // about the route's own cross-provider merge logic, already exercised
      // against the real API shapes in apps/api/src/providers/tvdb.test.ts.
      const fakeSeason = (externalId: string | null): ProviderSeason => ({
        overview: null,
        voteAverage: null,
        externalId,
        episodes: [
          {
            title: 'Ep 1',
            seasonNumber: 1,
            episodeNumber: 1,
            runtimeMinutes: null,
            firstAired: null,
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: externalId ? `${externalId}-ep` : null,
          },
        ],
      })
      const fakeTmdb = {
        source: 'tmdb',
        getSeason: async () => fakeSeason(null),
      } as unknown as MetadataProvider
      const fakeTvdb = {
        source: 'tvdb',
        getSeason: async () => fakeSeason('55555'),
      } as unknown as MetadataProvider

      const customApp = createApp({ db, metadataProviders: [fakeTmdb, fakeTvdb] })
      const res = await customApp.request(`/api/v1/library/shows/${show.slug}/seasons/1`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<SeasonDetail>(res)
      expect(body.tvdbSeasonId).toBe('55555')
      expect(body.episodes[0]?.tvdbEpisodeId).toBe('55555-ep')
    })

    it('leaves tvdbSeasonId/tvdbEpisodeId null when the show has no tvdb external id, without calling TVDB at all', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason('2020-01-01')

      const fakeTmdb = {
        source: 'tmdb',
        getSeason: async () => ({
          overview: null,
          voteAverage: null,
          externalId: null,
          episodes: [
            {
              title: 'Ep 1',
              seasonNumber: 1,
              episodeNumber: 1,
              runtimeMinutes: null,
              firstAired: null,
              overview: null,
              stillPath: null,
              voteAverage: null,
              externalId: null,
            },
          ],
        }),
      } as unknown as MetadataProvider
      const tvdbGetSeason = vi.fn()
      const fakeTvdb = { source: 'tvdb', getSeason: tvdbGetSeason } as unknown as MetadataProvider

      const customApp = createApp({ db, metadataProviders: [fakeTmdb, fakeTvdb] })
      const res = await customApp.request(`/api/v1/library/shows/${show.slug}/seasons/1`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<SeasonDetail>(res)
      expect(body.tvdbSeasonId).toBeNull()
      expect(body.episodes[0]?.tvdbEpisodeId).toBeNull()
      expect(tvdbGetSeason).not.toHaveBeenCalled()
    })

    it('serves a season for a show with no tmdb external id at all, resolved entirely via a second provider (regression: Formula 1 404)', async () => {
      // TMDB is still `metadataProviders[0]` (primary), but this show has
      // no `tmdb` external_ids row — only `tvdb` — same shape as a real
      // show resolved through match.ts's cross-provider fallback (e.g.
      // Formula 1, which TMDB has no entry for under any id). Before the
      // season/watched routes picked *any* configured provider with a
      // recorded id (pickRefreshTarget) instead of always the primary,
      // this 404'd with "Season not found" even though the season was
      // fully cached locally.
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'TVDB-Only Show', slug: 'tvdb-only-show', metadataSource: 'tvdb' })
        .returning()
      if (!show) throw new Error('failed to insert show')
      await db
        .insert(externalIds)
        .values({ entityType: 'show', entityId: show.id, source: 'tvdb', externalId: '9001' })
      await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 1 })

      const tmdbGetSeason = vi.fn()
      const fakeTmdb = { source: 'tmdb', getSeason: tmdbGetSeason } as unknown as MetadataProvider
      const fakeTvdb = {
        source: 'tvdb',
        getSeason: async (externalId: string) => {
          if (externalId !== '9001') throw new Error(`Unexpected externalId: ${externalId}`)
          return {
            overview: 'A season only TVDB knows about',
            voteAverage: null,
            externalId: 'fake-tvdb-season',
            episodes: [
              {
                title: 'Ep 1',
                seasonNumber: 1,
                episodeNumber: 1,
                runtimeMinutes: null,
                firstAired: null,
                overview: null,
                stillPath: null,
                voteAverage: null,
                externalId: null,
              },
            ],
          }
        },
      } as unknown as MetadataProvider

      const customApp = createApp({ db, metadataProviders: [fakeTmdb, fakeTvdb] })
      const res = await customApp.request(`/api/v1/library/shows/${show.slug}/seasons/1`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<SeasonDetail>(res)
      expect(body.overview).toBe('A season only TVDB knows about')
      expect(body.episodes).toHaveLength(1)
      expect(tmdbGetSeason).not.toHaveBeenCalled()
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
      const body = await json<Watches>(res)
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
      expect((await json<Watches>(res1)).watches.map((w) => w.id)).toEqual(expectedOrder)
      expect((await json<Watches>(res2)).watches.map((w) => w.id)).toEqual(expectedOrder)
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
      expect(await json<WatchedStatus>(res)).toEqual({
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
      expect(await json<Watches>(res)).toEqual({ watches: [] })
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
      expect(await json<WatchedStatus>(res)).toEqual({
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
      expect(await json<WatchedStatus>(res)).toEqual({
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
      expect(await json<WatchedStatus>(res)).toEqual({
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

  describe('PUT/DELETE /library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/rating', () => {
    function stubTmdbEpisode() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === `/3/tv/${BREAKING_BAD_SHOW_TMDB_ID}/season/1/episode/1`) {
            return new Response(
              JSON.stringify({
                name: 'Pilot',
                season_number: 1,
                episode_number: 1,
                air_date: '2008-01-20',
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected fetch in test: ${url}`)
        }),
      )
    }

    async function insertShowWithTmdbId(slug: string) {
      const [show] = await db.insert(shows).values({ title: 'Breaking Bad', slug }).returning()
      if (!show) throw new Error('failed to insert show')
      await db.insert(externalIds).values({
        entityType: 'show',
        entityId: show.id,
        source: 'tmdb',
        externalId: String(BREAKING_BAD_SHOW_TMDB_ID),
      })
      return show
    }

    afterEach(() => vi.unstubAllGlobals())

    it('creates the local episode row on demand and rates it, without logging a watch', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithTmdbId('breaking-bad-rate-1')
      stubTmdbEpisode()

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`,
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 8 }),
        },
      )
      expect(res.status).toBe(200)
      expect((await json<RatingStatus>(res)).rating).toBe(8)

      const [episode] = await db
        .select()
        .from(episodes)
        .where(
          and(
            eq(episodes.showId, show.id),
            eq(episodes.seasonNumber, 1),
            eq(episodes.episodeNumber, 1),
          ),
        )
      expect(episode).toBeDefined()
      expect(await db.select().from(plays)).toHaveLength(0)

      const season = await json<SeasonDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}/seasons/1`, { headers: { cookie } }),
      )
      expect(season.episodes.find((e) => e.episodeNumber === 1)?.myRating).toBe(8)
    })

    it('does not call the provider when the episode already has a local row', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithTmdbId('breaking-bad-rate-2')
      const [episode] = await db
        .insert(episodes)
        .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' })
        .returning()
      if (!episode) throw new Error('failed to insert episode')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('should not call the provider')
        }),
      )

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`,
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 6 }),
        },
      )
      expect(res.status).toBe(200)
    })

    it('re-rating replaces rather than duplicates', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithTmdbId('breaking-bad-rate-3')
      stubTmdbEpisode()

      await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 6 }),
      })
      const second = await json<RatingStatus>(
        await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`, {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 10 }),
        }),
      )
      expect(second.rating).toBe(10)

      const rows = await db.select().from(ratings).where(eq(ratings.entityType, 'episode'))
      expect(rows).toHaveLength(1)
    })

    it('clearing a rating with no local episode row is a harmless no-op with no provider call', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithTmdbId('breaking-bad-rate-4')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('should not call the provider')
        }),
      )

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`,
        { method: 'DELETE', headers: { cookie } },
      )
      expect(res.status).toBe(200)
      expect(await json<RatingStatus>(res)).toEqual({ rating: null, ratedAt: null })
    })

    it('404s when the show has no external id for any configured provider', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'No Provider Id', slug: 'no-provider-id-rating' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(
        `/api/v1/library/shows/${show.slug}/seasons/1/episodes/1/rating`,
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 8 }),
        },
      )
      expect(res.status).toBe(404)
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request(
        '/api/v1/library/shows/no-such-show/seasons/1/episodes/1/rating',
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 8 }),
        },
      )
      expect(res.status).toBe(404)
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

  describe('PUT/DELETE /library/shows/{slug}/rating', () => {
    it('sets a rating, reflected in both the detail and gallery endpoints', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Rated Show', slug: 'rated-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 8 }),
      })
      expect(res.status).toBe(200)
      const status = await json<RatingStatus>(res)
      expect(status.rating).toBe(8)
      expect(status.ratedAt).not.toBeNull()

      const detail = await json<ShowDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie } }),
      )
      expect(detail.myRating).toBe(8)

      const gallery = await json<ListLibraryShowsResponse>(
        await app.request('/api/v1/library/shows', { headers: { cookie } }),
      )
      // Unwatched, so it wouldn't otherwise appear in the plays-driven
      // gallery query — confirms myRating doesn't itself pull it in or
      // drop out an unrelated row.
      expect(gallery.shows.find((s) => s.slug === show.slug)).toBeUndefined()
    })

    it('rating a show does not log a watch — rating is independent of watched status', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Never Watched, Rated', slug: 'never-watched-rated' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 10 }),
      })

      const allPlays = await db.select().from(plays)
      expect(allPlays).toHaveLength(0)
    })

    it('re-rating replaces rather than duplicates, and moves ratedAt', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Re-rated Show', slug: 're-rated-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const first = await json<RatingStatus>(
        await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 4 }),
        }),
      )
      const second = await json<RatingStatus>(
        await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 10 }),
        }),
      )
      expect(second.rating).toBe(10)
      expect(second.ratedAt).not.toBe(first.ratedAt)

      const rows = await db
        .select()
        .from(ratings)
        .where(and(eq(ratings.entityType, 'show'), eq(ratings.entityId, show.id)))
      expect(rows).toHaveLength(1)
    })

    it('accepts an odd rating value — the API is not narrowed to the 5-star widget’s even values', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Odd Rating Show', slug: 'odd-rating-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 7 }),
      })
      expect(res.status).toBe(200)
      expect((await json<RatingStatus>(res)).rating).toBe(7)
    })

    it.each([0, 11, 2.5])('rejects an out-of-range or non-integer rating (%s)', async (rating) => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Invalid Rating Show', slug: 'invalid-rating-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      const res = await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      })
      expect(res.status).toBe(400)
    })

    it('404s for a show that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/shows/no-such-show/rating', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5 }),
      })
      expect(res.status).toBe(404)
    })

    it('clears a rating, and clearing a never-rated show is a harmless no-op', async () => {
      const cookie = await createUserAndCookie()
      const [show] = await db
        .insert(shows)
        .values({ title: 'Clear Rating Show', slug: 'clear-rating-show' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 6 }),
      })

      const cleared = await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(await json<RatingStatus>(cleared)).toEqual({ rating: null, ratedAt: null })

      // Clearing again — nothing left to clear — is still a 200 no-op.
      const clearedAgain = await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(clearedAgain.status).toBe(200)
      expect(await json<RatingStatus>(clearedAgain)).toEqual({ rating: null, ratedAt: null })
    })

    it("one user's rating is invisible to, and cannot be cleared by, another", async () => {
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
        .values({ title: 'Shared Show', slug: 'shared-show-rating' })
        .returning()
      if (!show) throw new Error('failed to insert show')

      await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'PUT',
        headers: { cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 9 }),
      })

      const detailB = await json<ShowDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie: cookieB } }),
      )
      expect(detailB.myRating).toBeNull()

      await app.request(`/api/v1/library/shows/${show.slug}/rating`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      })

      const detailA = await json<ShowDetail>(
        await app.request(`/api/v1/library/shows/${show.slug}`, { headers: { cookie: cookieA } }),
      )
      expect(detailA.myRating).toBe(9)
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

    it('logs a new watch for every aired episode again when additional is set, even if already watched', async () => {
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
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z', additional: true }),
      })
      expect(await json<MarkShowWatchedResponse>(secondRes)).toEqual({ count: 3 })

      const totalPlays = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(totalPlays).toHaveLength(6)
    })

    it('excludes an episode that already has an unknown-date watch when logging with the unknown sentinel, even in additional mode', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      const firstRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '1900-01-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(firstRes)).toEqual({ count: 3 })

      // Every episode already has an unknown-date watch — a second pass
      // with the same sentinel, even with additional set, logs nothing.
      const secondRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '1900-01-01T00:00:00.000Z', additional: true }),
      })
      expect(await json<MarkShowWatchedResponse>(secondRes)).toEqual({ count: 0 })

      const totalPlays = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(totalPlays).toHaveLength(3)
    })

    it('still logs a normal-dated additional watch for an episode that already has an unknown-date watch', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const show = await insertShowWithSeasons()
      stubTmdbSeasons()

      const firstRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '1900-01-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(firstRes)).toEqual({ count: 3 })

      const secondRes = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z', additional: true }),
      })
      expect(await json<MarkShowWatchedResponse>(secondRes)).toEqual({ count: 3 })

      const totalPlays = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(totalPlays).toHaveLength(6)
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

    it('still skips unaired episodes when additional is set', async () => {
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
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z', additional: true }),
      })
      // Only season 1 episode 1 has actually aired — additional doesn't
      // bypass that, only the already-watched filter.
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

    it('rejects a watchedAt in the future', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeasons()

      const res = await app.request(`/api/v1/library/shows/${show.slug}/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2099-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(400)
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

    it('logs another watch for an already-watched episode when additional is set', async () => {
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

      const firstRes = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-01-01T00:00:00.000Z' }),
      })
      expect(await json<MarkShowWatchedResponse>(firstRes)).toEqual({ count: 2 })

      const secondRes = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2026-06-01T00:00:00.000Z', additional: true }),
      })
      expect(await json<MarkShowWatchedResponse>(secondRes)).toEqual({ count: 2 })

      const playRows = await db.select().from(plays).where(eq(plays.userId, userId))
      expect(playRows).toHaveLength(4)
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

    it('rejects a watchedAt in the future', async () => {
      const cookie = await createUserAndCookie()
      const show = await insertShowWithSeason0And1()

      const res = await app.request(`/api/v1/library/shows/${show.slug}/seasons/1/watched`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchedAt: '2099-01-01T00:00:00.000Z' }),
      })
      expect(res.status).toBe(400)
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
        .values([
          {
            title: 'The Matrix',
            slug: 'the-matrix-1999',
            year: 1999,
            genres: ['Action', 'Science Fiction'],
            voteAverage: 8.2,
          },
          { title: 'Never Watched', slug: 'never-watched' },
        ])
        .returning()
      if (!watched || !unwatched) throw new Error('failed to insert movies')

      await db.insert(plays).values([
        { userId, movieId: watched.id, watchedAt: new Date('2026-01-01') },
        { userId, movieId: watched.id, watchedAt: new Date('2026-02-01') },
      ])

      const res = await app.request('/api/v1/library/movies', { headers: { cookie } })
      const { movies: library } = await json<ListLibraryMoviesResponse>(res)
      expect(library).toHaveLength(1)
      expect(library[0]).toMatchObject({
        id: watched.id,
        slug: 'the-matrix-1999',
        genres: ['Action', 'Science Fiction'],
        voteAverage: 8.2,
        playCount: 2,
      })
      expect(new Date(library[0]!.lastWatchedAt).toISOString()).toBe(
        new Date('2026-02-01').toISOString(),
      )
    })
  })

  describe('GET /library/movies/{slug}', () => {
    it('returns 404 for an unknown slug', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/movies/no-such-movie', { headers: { cookie } })
      expect(res.status).toBe(404)
    })

    it('carries metadataSource/metadataRefreshedAt, null when the movie has never been resolved via a provider', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'No Provider Yet', slug: 'no-provider-yet-movie' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      const res = await app.request(`/api/v1/library/movies/${movie.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<MovieDetail>(res)
      expect(detail.metadataSource).toBeNull()
      expect(detail.metadataRefreshedAt).toBeTruthy()
    })

    it('carries metadataSource once the movie has an external id from a configured provider', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Resolved Movie', slug: 'resolved-movie', metadataSource: 'tmdb' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db.insert(externalIds).values({
        entityType: 'movie',
        entityId: movie.id,
        source: 'tmdb',
        externalId: '999',
      })

      const res = await app.request(`/api/v1/library/movies/${movie.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<MovieDetail>(res)
      expect(detail.metadataSource).toBe('tmdb')
    })

    it('carries tvdbId independently of tmdbId/metadataSource — same convention as the show route', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({
          title: 'Cross-Provider Movie',
          slug: 'cross-provider-movie',
          metadataSource: 'tmdb',
        })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db.insert(externalIds).values([
        { entityType: 'movie', entityId: movie.id, source: 'tmdb', externalId: '111' },
        { entityType: 'movie', entityId: movie.id, source: 'tvdb', externalId: '222' },
      ])

      const res = await app.request(`/api/v1/library/movies/${movie.slug}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const detail = await json<MovieDetail>(res)
      expect(detail.tmdbId).toBe('111')
      expect(detail.tvdbId).toBe('222')
    })

    it("returns metadata and the current user's watch status", async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [movie] = await db
        .insert(movies)
        .values({
          title: 'The Matrix',
          slug: 'the-matrix-1999',
          year: 1999,
          runtimeMinutes: 136,
          overview: 'A hacker discovers reality is a simulation.',
          genres: ['Action', 'Science Fiction'],
          voteAverage: 8.2,
        })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db.insert(externalIds).values({
        entityType: 'movie',
        entityId: movie.id,
        source: 'tmdb',
        externalId: '603',
      })
      await db.insert(plays).values([
        { userId, movieId: movie.id, watchedAt: new Date('2026-01-01') },
        { userId, movieId: movie.id, watchedAt: new Date('2026-02-01') },
      ])

      const res = await app.request('/api/v1/library/movies/the-matrix-1999', {
        headers: { cookie },
      })
      const body = await json<MovieDetail>(res)
      expect(body).toMatchObject({
        slug: 'the-matrix-1999',
        title: 'The Matrix',
        year: 1999,
        runtimeMinutes: 136,
        genres: ['Action', 'Science Fiction'],
        voteAverage: 8.2,
        tmdbId: '603',
        watched: true,
        watchedCount: 2,
        hasUnknownWatchDate: false,
      })
      expect(new Date(body.lastWatchedAt!).toISOString()).toBe(new Date('2026-02-01').toISOString())
    })

    it('reports an unknown-date-only watch as watched with no first/lastWatchedAt (1900 sentinel regression)', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)

      const [movie] = await db
        .insert(movies)
        .values({ title: 'Old Import', slug: 'old-import' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db
        .insert(plays)
        .values({ userId, movieId: movie.id, watchedAt: new Date('1900-01-01') })

      const res = await app.request('/api/v1/library/movies/old-import', { headers: { cookie } })
      const body = await json<MovieDetail>(res)
      expect(body).toMatchObject({
        watched: true,
        watchedCount: 1,
        firstWatchedAt: null,
        lastWatchedAt: null,
        hasUnknownWatchDate: true,
      })
    })

    it("does not count another user's plays", async () => {
      const cookie = await createUserAndCookie()
      // Setup only ever creates one admin (registration is closed by
      // default), so a second user is inserted directly rather than via a
      // second POST /setup — see plays.test.ts for the same pattern.
      const otherUserId = await createLocalUser(
        db,
        'other@example.com',
        'correct-horse-battery-staple',
      )

      const [movie] = await db
        .insert(movies)
        .values({ title: 'Someone Else Watched This', slug: 'someone-else-watched-this' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db
        .insert(plays)
        .values({ userId: otherUserId, movieId: movie.id, watchedAt: new Date() })

      const res = await app.request('/api/v1/library/movies/someone-else-watched-this', {
        headers: { cookie },
      })
      const body = await json<MovieDetail>(res)
      expect(body).toMatchObject({ watched: false, watchedCount: 0, lastWatchedAt: null })
    })
  })

  describe('GET /library/movies/{slug}/plays', () => {
    it('returns 404 for an unknown slug', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/movies/no-such-movie/plays', {
        headers: { cookie },
      })
      expect(res.status).toBe(404)
    })

    it('returns an empty list for a movie with no plays', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Untouched', slug: 'untouched' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      const res = await app.request('/api/v1/library/movies/untouched/plays', {
        headers: { cookie },
      })
      expect(await json<Watches>(res)).toEqual({ watches: [] })
    })

    it('lists watches newest first, in a stable order across repeated fetches (regression)', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Rewatched', slug: 'rewatched' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      // Same timestamp on both — ties must still return in a stable order
      // across repeated fetches (UnwatchConfirmDialog.tsx depends on this).
      const tied = new Date('1900-01-01')
      await db.insert(plays).values([
        { userId, movieId: movie.id, watchedAt: tied },
        { userId, movieId: movie.id, watchedAt: tied },
      ])

      const res1 = await app.request('/api/v1/library/movies/rewatched/plays', {
        headers: { cookie },
      })
      const res2 = await app.request('/api/v1/library/movies/rewatched/plays', {
        headers: { cookie },
      })
      const order1 = (await json<Watches>(res1)).watches.map((w) => w.id)
      const order2 = (await json<Watches>(res2)).watches.map((w) => w.id)
      expect(order1).toHaveLength(2)
      expect(order1).toEqual(order2)
    })
  })

  describe('DELETE /library/movies/{slug}/plays', () => {
    it('returns 404 for an unknown slug', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/movies/no-such-movie/plays', {
        method: 'DELETE',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000000'] }),
      })
      expect(res.status).toBe(404)
    })

    it('removes only the named ids, ignoring ids for another movie or user', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      // Same "second user inserted directly, not via a second POST /setup"
      // reasoning as the GET /library/movies/{slug} test above.
      const otherUserId = await createLocalUser(
        db,
        'other2@example.com',
        'correct-horse-battery-staple',
      )

      const [movie, otherMovie] = await db
        .insert(movies)
        .values([
          { title: 'Target', slug: 'target' },
          { title: 'Other', slug: 'other-movie' },
        ])
        .returning()
      if (!movie || !otherMovie) throw new Error('failed to insert movies')

      const [keep, remove] = await db
        .insert(plays)
        .values([
          { userId, movieId: movie.id, watchedAt: new Date('2026-01-01') },
          { userId, movieId: movie.id, watchedAt: new Date('2026-02-01') },
        ])
        .returning()
      if (!keep || !remove) throw new Error('failed to insert plays')
      const [otherUsersPlay] = await db
        .insert(plays)
        .values({ userId: otherUserId, movieId: movie.id, watchedAt: new Date('2026-03-01') })
        .returning()
      if (!otherUsersPlay) throw new Error('failed to insert play')
      const [otherMoviePlay] = await db
        .insert(plays)
        .values({ userId, movieId: otherMovie.id, watchedAt: new Date('2026-04-01') })
        .returning()
      if (!otherMoviePlay) throw new Error('failed to insert play')

      const res = await app.request('/api/v1/library/movies/target/plays', {
        method: 'DELETE',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [remove.id, otherUsersPlay.id, otherMoviePlay.id] }),
      })
      const body = await json<WatchedStatus>(res)
      expect(body).toMatchObject({ watched: true, watchedCount: 1 })
      expect(new Date(body.lastWatchedAt!).toISOString()).toBe(new Date('2026-01-01').toISOString())
    })

    it('removing every watch leaves the movie unwatched', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Solo Watch', slug: 'solo-watch' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      const [play] = await db
        .insert(plays)
        .values({ userId, movieId: movie.id, watchedAt: new Date() })
        .returning()
      if (!play) throw new Error('failed to insert play')

      const res = await app.request('/api/v1/library/movies/solo-watch/plays', {
        method: 'DELETE',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [play.id] }),
      })
      expect(await json<WatchedStatus>(res)).toEqual({
        watched: false,
        watchedCount: 0,
        lastWatchedAt: null,
      })
    })
  })

  describe('PUT/DELETE /library/movies/{slug}/rating', () => {
    it('sets a rating, reflected in the detail endpoint, without logging a watch', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Rated Movie', slug: 'rated-movie' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      const res = await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 8 }),
      })
      expect(res.status).toBe(200)
      expect((await json<RatingStatus>(res)).rating).toBe(8)

      const detail = await json<MovieDetail>(
        await app.request(`/api/v1/library/movies/${movie.slug}`, { headers: { cookie } }),
      )
      expect(detail.myRating).toBe(8)
      expect(detail.watched).toBe(false)
      expect(await db.select().from(plays)).toHaveLength(0)
    })

    it('a rated movie with several plays still reports the correct play count (fan-out guard)', async () => {
      // GET /library/movies is a GROUP BY movies.id aggregate — the rating
      // join added alongside it must not multiply playCount, the same
      // "does not double-count" risk the shows gallery query already
      // guards against.
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Rated Rewatch', slug: 'rated-rewatch' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db.insert(plays).values([
        { userId, movieId: movie.id, watchedAt: new Date('2026-01-01') },
        { userId, movieId: movie.id, watchedAt: new Date('2026-01-02') },
        { userId, movieId: movie.id, watchedAt: new Date('2026-01-03') },
      ])

      await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 6 }),
      })

      const { movies: library } = await json<ListLibraryMoviesResponse>(
        await app.request('/api/v1/library/movies', { headers: { cookie } }),
      )
      expect(library.find((m) => m.slug === movie.slug)).toMatchObject({
        playCount: 3,
        myRating: 6,
      })
    })

    it('re-rating replaces rather than duplicates', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Re-rated Movie', slug: 're-rated-movie' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 4 }),
      })
      const second = await json<RatingStatus>(
        await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: 10 }),
        }),
      )
      expect(second.rating).toBe(10)

      const rows = await db
        .select()
        .from(ratings)
        .where(and(eq(ratings.entityType, 'movie'), eq(ratings.entityId, movie.id)))
      expect(rows).toHaveLength(1)
    })

    it('clears a rating, and clearing a never-rated movie is a harmless no-op', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Clear Rating Movie', slug: 'clear-rating-movie' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 6 }),
      })
      const cleared = await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(await json<RatingStatus>(cleared)).toEqual({ rating: null, ratedAt: null })

      const clearedAgain = await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(clearedAgain.status).toBe(200)
      expect(await json<RatingStatus>(clearedAgain)).toEqual({ rating: null, ratedAt: null })
    })

    it('404s for a movie that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/movies/no-such-movie/rating', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5 }),
      })
      expect(res.status).toBe(404)
    })

    it('rejects an out-of-range rating', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Invalid Rating Movie', slug: 'invalid-rating-movie' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')

      const res = await app.request(`/api/v1/library/movies/${movie.slug}/rating`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 0 }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /library/movies/{slug}/refresh', () => {
    it('returns 404 for an unknown slug', async () => {
      const cookie = await createUserAndCookie()
      const res = await app.request('/api/v1/library/movies/no-such-movie/refresh', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(404)
    })

    it('returns 404 when the movie has no tmdb external id', async () => {
      const cookie = await createUserAndCookie()
      await db.insert(movies).values({ title: 'No Match', slug: 'no-match' })
      const res = await app.request('/api/v1/library/movies/no-match/refresh', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(404)
    })

    it('refetches genres/rating from the provider but leaves the slug unchanged even when the title changes (regression)', async () => {
      const cookie = await createUserAndCookie()
      const [movie] = await db
        .insert(movies)
        .values({ title: 'Old Title', slug: 'old-title-slug' })
        .returning()
      if (!movie) throw new Error('failed to insert movie')
      await db.insert(externalIds).values({
        entityType: 'movie',
        entityId: movie.id,
        source: 'tmdb',
        externalId: '603',
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/movie/603') {
            return new Response(
              JSON.stringify({
                id: 603,
                title: 'New Title',
                release_date: '1999-03-31',
                runtime: 136,
                overview: 'Updated overview.',
                poster_path: '/poster.jpg',
                genres: [{ id: 28, name: 'Action' }],
                vote_average: 8.7,
                vote_count: 100,
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request('/api/v1/library/movies/old-title-slug/refresh', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(204)

      const [updated] = await db.select().from(movies).where(eq(movies.id, movie.id))
      expect(updated).toMatchObject({
        title: 'New Title',
        slug: 'old-title-slug',
        genres: ['Action'],
        voteAverage: 8.7,
      })
    })
  })

  describe('POST /library/movies/resolve', () => {
    it('creates a movie and external id, returning its slug', async () => {
      const cookie = await createUserAndCookie()

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/movie/27205') {
            return new Response(
              JSON.stringify({
                id: 27205,
                title: 'Inception',
                release_date: '2010-07-16',
                runtime: 148,
                overview: 'A thief who steals corporate secrets.',
                poster_path: '/poster.jpg',
                genres: [{ id: 878, name: 'Science Fiction' }],
                vote_average: 8.4,
                vote_count: 100,
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const res = await app.request('/api/v1/library/movies/resolve', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'tmdb', externalId: '27205' }),
      })
      expect(res.status).toBe(200)
      const { slug } = await json<{ slug: string }>(res)
      expect(slug).toBe('inception-2010')

      const [external] = await db
        .select()
        .from(externalIds)
        .where(and(eq(externalIds.entityType, 'movie'), eq(externalIds.externalId, '27205')))
      expect(external).toBeTruthy()
    })

    it('is idempotent — resolving the same external id twice returns the same slug and creates no second row', async () => {
      const cookie = await createUserAndCookie()

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/movie/27205') {
            return new Response(
              JSON.stringify({
                id: 27205,
                title: 'Inception',
                release_date: '2010-07-16',
                runtime: 148,
                overview: null,
                poster_path: null,
                genres: [],
                vote_average: 0,
                vote_count: 0,
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const first = await app.request('/api/v1/library/movies/resolve', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'tmdb', externalId: '27205' }),
      })
      const second = await app.request('/api/v1/library/movies/resolve', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'tmdb', externalId: '27205' }),
      })
      const { slug: slug1 } = await json<{ slug: string }>(first)
      const { slug: slug2 } = await json<{ slug: string }>(second)
      expect(slug1).toBe(slug2)

      const rows = await db.select().from(movies).where(eq(movies.slug, slug1))
      expect(rows).toHaveLength(1)
    })

    it('gives two same-title-and-year movies distinct slugs', async () => {
      const cookie = await createUserAndCookie()

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(input)
          if (url.pathname === '/3/movie/111' || url.pathname === '/3/movie/222') {
            const id = url.pathname === '/3/movie/111' ? 111 : 222
            return new Response(
              JSON.stringify({
                id,
                title: 'Same Name',
                release_date: '2020-01-01',
                runtime: 100,
                overview: null,
                poster_path: null,
                genres: [],
                vote_average: 0,
                vote_count: 0,
              }),
              { status: 200 },
            )
          }
          throw new Error(`Unexpected TMDB fetch in test: ${url}`)
        }),
      )

      const first = await app.request('/api/v1/library/movies/resolve', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'tmdb', externalId: '111' }),
      })
      const second = await app.request('/api/v1/library/movies/resolve', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'tmdb', externalId: '222' }),
      })
      const { slug: slug1 } = await json<{ slug: string }>(first)
      const { slug: slug2 } = await json<{ slug: string }>(second)
      expect(slug1).toBe('same-name-2020')
      expect(slug2).toBe('same-name-2020-2')
    })
  })
})
