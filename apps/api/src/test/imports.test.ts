import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { and, eq } from 'drizzle-orm'
import {
  droppedShows,
  episodes,
  externalIds,
  importJobs,
  movies,
  plays,
  ratings,
  shows,
  traktConnections,
  watchlistItems,
} from '@rwnd/db'
import type { TraktConnectionStatus, User } from '@rwnd/shared'
import {
  createLocalUser,
  createTraktConnection,
  extractCookie,
  json,
  resetDb,
  testApp,
  testDb,
  waitFor,
} from './helpers.js'
import { loadEnv } from '../env.js'
import { createMetadataProviders } from '../providers/index.js'
import type { MetadataProvider } from '../providers/types.js'
import { runTraktImport } from '../import/trakt.js'
import type {
  TraktHiddenItem,
  TraktHistoryItem,
  TraktRatingItem,
  TraktWatchlistItem,
} from '../trakt/types.js'
import * as fx from './fixtures/trakt.js'

const db = testDb()
const app = testApp()
const env = loadEnv()
const providers = createMetadataProviders(env)

/**
 * A fake second provider for the cross-provider fallback tests below — the
 * test env only ever configures TMDB_API_KEY (same as every other test in
 * this suite), so exercising a real second provider means constructing one
 * directly rather than through env/createMetadataProviders. Only
 * getMovie/getShow/getSeason are implemented (findByExternalId always
 * returns null, same as a provider genuinely having no reverse-lookup
 * match) — this is about match.ts's own cross-provider walk, not TVDB's
 * real API shapes, which apps/api/src/providers/tvdb.test.ts already
 * covers.
 */
function fakeTvdbProvider(): MetadataProvider {
  return {
    source: 'tvdb',
    async searchMulti() {
      return []
    },
    async getMovie(externalId) {
      if (externalId !== String(fx.TVDB_ONLY_MOVIE_TVDB_ID)) {
        throw new Error(`Unexpected fake TVDB movie lookup: ${externalId}`)
      }
      return {
        externalId,
        title: 'A Title Only TVDB Has',
        year: 2019,
        runtimeMinutes: null,
        overview: null,
        posterPath: null,
        genres: [],
        voteAverage: null,
        imdbId: null,
      }
    },
    async getShow(externalId) {
      if (externalId !== String(fx.TVDB_ONLY_SHOW_TVDB_ID)) {
        throw new Error(`Unexpected fake TVDB show lookup: ${externalId}`)
      }
      return {
        externalId,
        title: 'A Show Only TVDB Has',
        year: 2020,
        overview: null,
        posterPath: null,
        status: null,
        genres: [],
        voteAverage: null,
        seasons: [],
        imdbId: null,
      }
    },
    async getEpisode() {
      throw new Error('Not used by these tests — matchEpisode resolves via getSeason')
    },
    async getSeason(externalId, seasonNumber) {
      if (externalId !== String(fx.TVDB_ONLY_SHOW_TVDB_ID) || seasonNumber !== 1) {
        throw new Error(`Unexpected fake TVDB season lookup: ${externalId} season ${seasonNumber}`)
      }
      return {
        overview: null,
        voteAverage: null,
        externalId: 'fake-tvdb-season-1',
        episodes: [
          {
            title: 'Pilot',
            seasonNumber: 1,
            episodeNumber: 1,
            runtimeMinutes: 55,
            firstAired: '2020-01-01',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: 'fake-tvdb-episode-1',
            imdbId: null,
          },
        ],
      }
    },
    async findByExternalId() {
      return null
    },
  }
}

async function createUserAndCookie(email = 'importer@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'correct-horse-battery-staple',
      displayName: 'Importer',
    }),
  })
  return extractCookie(res)!
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Routes stubbed `fetch` calls to whichever fixture applies, by hostname —
 * the importer talks to three different hosts (Trakt's OAuth host, Trakt's
 * API host, and TMDB), each asserted separately in apps/api/src/env.ts.
 * `seasonCalls`/`showCalls`, when passed, count /tv/{id}/season/{n} and
 * /tv/{id} requests respectively, so tests can assert provider.getSeason()
 * and resolveShow() are only called once per season/show, not once per
 * episode. `findCalls` similarly counts /find/{externalId} requests, for
 * the same "cached, not once per episode" assertion on the imdb/tvdb
 * reverse-lookup fallback (apps/api/src/import/match.ts).
 */
function createFetchStub(
  opts: {
    historyItems?: TraktHistoryItem[]
    ratingsItems?: TraktRatingItem[]
    watchlistItemsList?: TraktWatchlistItem[]
    droppedItems?: TraktHiddenItem[]
    seasonCalls?: { count: number }
    showCalls?: { count: number }
    findCalls?: { count: number }
  } = {},
) {
  const {
    historyItems = [],
    ratingsItems = [],
    watchlistItemsList = [],
    droppedItems = [],
    seasonCalls,
    showCalls,
    findCalls,
  } = opts

  return vi.fn(async (input: string | URL) => {
    const url = new URL(input)

    if (url.hostname === 'api.themoviedb.org') {
      if (url.pathname === '/3/movie/603') return jsonResponse(fx.tmdbMatrixMovie)
      if (url.pathname === `/3/movie/${fx.TMDB_DELETED_MOVIE_ID}`) {
        return new Response('{"status_message":"Not Found"}', { status: 404 })
      }
      if (url.pathname === `/3/tv/${fx.TMDB_DELETED_SHOW_ID}`) {
        if (showCalls) showCalls.count += 1
        return new Response('{"status_message":"Not Found"}', { status: 404 })
      }
      if (url.pathname === '/3/tv/1396') return jsonResponse(fx.tmdbBreakingBadShow)
      if (url.pathname === '/3/tv/1396/season/1') {
        if (seasonCalls) seasonCalls.count += 1
        return jsonResponse(fx.tmdbBreakingBadSeason1)
      }
      if (url.pathname.startsWith('/3/find/')) {
        if (findCalls) findCalls.count += 1
        const externalId = url.pathname.slice('/3/find/'.length)
        // Real TMDB /find returns both arrays regardless of what the id
        // turns out to be — the caller (TmdbProvider.findByExternalId)
        // picks movie_results vs tv_results based on entityType, so the
        // stub only needs to know which known id maps to which hit, not
        // which array the caller asked for.
        if (externalId === 'tt0133093') {
          return jsonResponse({ movie_results: [{ id: fx.MATRIX_TMDB_ID }], tv_results: [] })
        }
        if (externalId === fx.NO_TMDB_ID_SHOW_IMDB_ID) {
          return jsonResponse({
            movie_results: [],
            tv_results: [{ id: fx.BREAKING_BAD_SHOW_TMDB_ID }],
          })
        }
        // Any other id (e.g. UNFINDABLE_SHOW_IMDB_ID) genuinely has no
        // match — the real endpoint's actual behaviour for an id it
        // doesn't recognise as belonging to anything.
        return jsonResponse({ movie_results: [], tv_results: [] })
      }
      throw new Error(`Unexpected TMDB fetch in test: ${url}`)
    }

    if (url.hostname === 'auth.trakt.tv') {
      if (url.pathname === '/oauth/device/code') return jsonResponse(fx.deviceCodeResponse)
      if (url.pathname === '/oauth/device/token') return jsonResponse(fx.tokenResponse)
      throw new Error(`Unexpected Trakt auth fetch in test: ${url}`)
    }

    if (url.hostname === 'api.trakt.tv') {
      if (url.pathname === '/users/settings') return jsonResponse(fx.settingsResponse)
      if (url.pathname === '/sync/history') {
        return jsonResponse(historyItems, {
          'X-Pagination-Page-Count': '1',
          'X-Pagination-Item-Count': String(historyItems.length),
        })
      }
      if (url.pathname === '/sync/ratings') {
        return jsonResponse(ratingsItems, {
          'X-Pagination-Page-Count': '1',
          'X-Pagination-Item-Count': String(ratingsItems.length),
        })
      }
      if (url.pathname === '/sync/watchlist') {
        return jsonResponse(watchlistItemsList, {
          'X-Pagination-Page-Count': '1',
          'X-Pagination-Item-Count': String(watchlistItemsList.length),
        })
      }
      if (url.pathname === '/users/hidden/dropped') {
        return jsonResponse(droppedItems, {
          'X-Pagination-Page-Count': '1',
          'X-Pagination-Item-Count': String(droppedItems.length),
        })
      }
      throw new Error(`Unexpected Trakt API fetch in test: ${url}`)
    }

    throw new Error(`Unexpected fetch in test: ${url}`)
  })
}

describe('Trakt import', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  it('pairs via the device flow and stores an encrypted connection, never returning tokens', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()

    const startRes = await app.request('/api/v1/import/trakt/device', {
      method: 'POST',
      headers: { cookie },
    })
    expect(startRes.status).toBe(202)
    const pairing = await json<{ userCode: string; verificationUrl: string }>(startRes)
    expect(pairing.userCode).toBe(fx.deviceCodeResponse.user_code)
    expect(JSON.stringify(pairing)).not.toMatch(/token/i)

    const status = await waitFor(
      async () => {
        const res = await app.request('/api/v1/import/trakt/connection', { headers: { cookie } })
        const body = await json<TraktConnectionStatus>(res)
        return body.connected ? body : undefined
      },
      { timeoutMs: 4000 },
    )
    expect(status.username).toBe(fx.settingsResponse.user.username)
    expect(JSON.stringify(status)).not.toMatch(/test-access-token|test-refresh-token/)

    const [row] = await db.select().from(traktConnections).limit(1)
    expect(row?.accessTokenEncrypted).not.toBe('test-access-token')
    // iv:ciphertext:tag — see apps/api/src/lib/crypto.ts.
    expect(row?.accessTokenEncrypted.split(':')).toHaveLength(3)
  }, 10_000)

  it('imports history into local records, resolving a whole season in one TMDB call, and is idempotent on re-run', async () => {
    const seasonCalls = { count: 0 }
    vi.stubGlobal(
      'fetch',
      createFetchStub({
        historyItems: [
          fx.matrixHistoryItem,
          fx.pilotHistoryItem,
          fx.secondEpisodeHistoryItem,
          fx.unmatchedHistoryItem,
        ],
        seasonCalls,
      }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(3)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures).toHaveLength(1)
    expect(finished?.failures[0]?.reason).toMatch(
      /No match for this movie from any configured metadata provider/,
    )

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(3)

    const [movieRow] = await db.select().from(movies).limit(1)
    expect(movieRow?.title).toBe('The Matrix')
    const [showRow] = await db.select().from(shows).limit(1)
    expect(showRow?.title).toBe('Breaking Bad')
    const episodeRows = await db.select().from(episodes)
    expect(episodeRows).toHaveLength(2)

    // Two watched episodes, same season — only one provider.getSeason() call.
    expect(seasonCalls.count).toBe(1)

    const movieExternalIds = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'movie'), eq(externalIds.entityId, movieRow!.id)))
    expect(movieExternalIds.map((r) => r.source).sort()).toEqual(['imdb', 'tmdb', 'trakt'])

    // The show fixture carries a tvdb id (movies' don't, realistically —
    // TheTVDB doesn't cover movies) — backfilled alongside trakt/imdb even
    // though nothing currently matches by tvdb, for a future provider that
    // might, and so self-hosters exporting their data get it too.
    const showExternalIds = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'show'), eq(externalIds.entityId, showRow!.id)))
    expect(showExternalIds.map((r) => r.source).sort()).toEqual(['imdb', 'tmdb', 'trakt', 'tvdb'])

    // Re-running the same import must not create duplicate plays — this is
    // the plays_user_source_ref_idx partial unique index doing its job.
    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const allPlaysAfterReimport = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlaysAfterReimport).toHaveLength(3)
  })

  it("skips a history item that already has a 'plex' play for the same movie on the same day (cross-source dedup)", async () => {
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.matrixHistoryItem] }))

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    // First pass resolves and creates the movie locally (and its own
    // 'import' play) — deleted afterward so the *second* pass below is a
    // genuinely fresh attempt at this exact history item, isolating the
    // cross-source check from plays_user_source_ref_idx's own same-source
    // dedup, which would otherwise mask it.
    const [job1] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)
    const [movie] = await db.select().from(movies).where(eq(movies.title, 'The Matrix')).limit(1)
    await db.delete(plays).where(eq(plays.userId, me.id))

    // Simulates Trakt's own separate Plex scrobbling already having logged
    // this same real watch via rwnd.tv's direct webhook, same day.
    await db.insert(plays).values({
      userId: me.id,
      movieId: movie!.id,
      watchedAt: new Date('2024-01-01T09:00:00.000Z'),
      source: 'plex',
      sourceRef: '5001:2024-01-01',
    })

    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const [finished] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job2!.id))
      .limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(0)
    expect(finished?.itemsSkipped).toBe(1)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
    expect(allPlays[0]?.source).toBe('plex')
  })

  it('backfills a missing tvdb id on re-import even for an already-resolved show', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    // Simulates a show resolved before tvdb backfill existed — same
    // trakt/tmdb ids as the real fixture, but no tvdb.
    const showWithoutTvdb: TraktHistoryItem = {
      ...fx.pilotHistoryItem,
      show: { ...fx.pilotHistoryItem.show!, ids: { ...fx.pilotHistoryItem.show!.ids, tvdb: null } },
    }

    vi.stubGlobal('fetch', createFetchStub({ historyItems: [showWithoutTvdb] }))
    const [job1] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)

    const [showRow] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad')).limit(1)
    const firstPassIds = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'show'), eq(externalIds.entityId, showRow!.id)))
    expect(firstPassIds.map((r) => r.source).sort()).toEqual(['imdb', 'tmdb', 'trakt'])

    // Re-import with the real fixture, which does carry a tvdb id — the
    // show is already resolved (fast path), but should still pick it up.
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.pilotHistoryItem] }))
    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const secondPassIds = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'show'), eq(externalIds.entityId, showRow!.id)))
    expect(secondPassIds.map((r) => r.source).sort()).toEqual(['imdb', 'tmdb', 'trakt', 'tvdb'])
  })

  it('records a TMDB lookup failure as a skipped item instead of aborting the whole job', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchStub({
        // A movie TMDB 404s on, sandwiched between two movies that resolve
        // fine — the failure in the middle must not stop the one after it.
        historyItems: [fx.matrixHistoryItem, fx.tmdbDeletedMovieHistoryItem],
      }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.error).toBeNull()
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures).toHaveLength(1)
    expect(finished?.failures[0]?.reason).toMatch(/TMDB lookup failed.*404/)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
  })

  it('caches a show-level TMDB failure so it is only retried once, not once per episode', async () => {
    const showCalls = { count: 0 }
    vi.stubGlobal(
      'fetch',
      createFetchStub({
        historyItems: [fx.undeadShowHistoryItem1, fx.undeadShowHistoryItem2],
        showCalls,
      }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsSkipped).toBe(2)
    expect(finished?.failures).toHaveLength(2)
    for (const failure of finished?.failures ?? []) {
      expect(failure.reason).toMatch(/TMDB lookup failed.*404/)
    }

    // Two episodes of the same unresolvable show — only one TMDB show lookup.
    expect(showCalls.count).toBe(1)

    // Titles must identify *which* episode (S/E number) — without that,
    // every failure from the same broken show is indistinguishable in the
    // failures list, even though they're different episodes.
    const titles = finished?.failures.map((f) => f.title)
    expect(new Set(titles).size).toBe(2)
    expect(titles).toContain('A Show TMDB No Longer Has S1 E1')
    expect(titles).toContain('A Show TMDB No Longer Has S1 E2')

    // Structured show/season/episode fields, not just the flat title — this
    // is what lets the UI group failures into a tree.
    const episodeNumbers = finished?.failures.map((f) => f.episode).sort()
    expect(episodeNumbers).toEqual([1, 2])
    for (const failure of finished?.failures ?? []) {
      expect(failure.show).toBe('A Show TMDB No Longer Has')
      expect(failure.season).toBe(1)
    }
  })

  it('imports a movie whose tmdb id is null by resolving its imdb id via TMDB /find', async () => {
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.noTmdbIdMovieHistoryItem] }))

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(0)

    // Resolved via /find to MATRIX_TMDB_ID, then through the normal
    // getMovie fixture — the local row should carry the real tmdb id, not
    // just the imdb one it was found by.
    const [movie] = await db.select().from(movies).where(eq(movies.title, 'The Matrix')).limit(1)
    expect(movie).toBeDefined()
    const ids = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'movie'), eq(externalIds.entityId, movie!.id)))
    expect(ids.map((r) => `${r.source}:${r.externalId}`).sort()).toEqual([
      `imdb:tt0133093`,
      `tmdb:${fx.MATRIX_TMDB_ID}`,
      'trakt:9',
    ])
  })

  it('imports a show whose tmdb id is null by resolving its imdb id via TMDB /find, then resolves its episode normally', async () => {
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.showFoundViaImdbHistoryItem] }))

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(0)

    const [showRow] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad')).limit(1)
    expect(showRow).toBeDefined()
    const episodeRows = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, showRow!.id), eq(episodes.seasonNumber, 1)))
    // getSeason's fixture inserts both of Breaking Bad's season-1 episodes,
    // same as the normal (tmdb-id-present) path does — only one was
    // actually watched, but resolving a season resolves it whole.
    expect(episodeRows).toHaveLength(2)
  })

  it("falls through to the imdb lookup when Trakt's own tmdb id 404s, rather than reporting a failure", async () => {
    vi.stubGlobal(
      'fetch',
      createFetchStub({ historyItems: [fx.staleTmdbButFindableMovieHistoryItem] }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(0)
    expect(finished?.failures).toHaveLength(0)
  })

  it('falls through to a second configured provider when the primary one has no id at all for a movie', async () => {
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.tvdbOnlyMovieHistoryItem] }))

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    // TMDB (real, HTTP-stubbed) first, then the fake TVDB provider — TMDB
    // has no tmdb/imdb id to try at all, so this only succeeds if match.ts
    // actually moves on to the next provider rather than giving up.
    await runTraktImport(db, [providers[0]!, fakeTvdbProvider()], env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(0)
    expect(finished?.failures).toHaveLength(0)

    const [movie] = await db
      .select()
      .from(movies)
      .where(eq(movies.title, 'A Title Only TVDB Has'))
      .limit(1)
    expect(movie).toBeDefined()
    expect(movie?.metadataSource).toBe('tvdb')
    const ids = await db
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.entityType, 'movie'), eq(externalIds.entityId, movie!.id)))
    expect(ids.map((r) => `${r.source}:${r.externalId}`).sort()).toEqual([
      `trakt:13`,
      `tvdb:${fx.TVDB_ONLY_MOVIE_TVDB_ID}`,
    ])
  })

  it('falls through to a second configured provider for a show, then resolves its episode via that same provider', async () => {
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.tvdbOnlyShowHistoryItem] }))

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, [providers[0]!, fakeTvdbProvider()], env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(0)
    expect(finished?.failures).toHaveLength(0)

    const [showRow] = await db
      .select()
      .from(shows)
      .where(eq(shows.title, 'A Show Only TVDB Has'))
      .limit(1)
    expect(showRow).toBeDefined()
    expect(showRow?.metadataSource).toBe('tvdb')
    // Resolved via the fake provider's getSeason, not TMDB's — proves
    // matchEpisode used the provider matchShow actually resolved the show
    // through, not the primary/TMDB one.
    const [episodeRow] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, showRow!.id), eq(episodes.seasonNumber, 1)))
    expect(episodeRow?.title).toBe('Pilot')
    expect(episodeRow?.runtimeMinutes).toBe(55)
  })

  it('makes exactly one /find call across multiple watched episodes of a show nothing can find', async () => {
    const findCalls = { count: 0 }
    vi.stubGlobal(
      'fetch',
      createFetchStub({
        historyItems: [fx.unfindableShowHistoryItem1, fx.unfindableShowHistoryItem2],
        findCalls,
      }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsSkipped).toBe(2)
    expect(finished?.failures).toHaveLength(2)
    for (const failure of finished?.failures ?? []) {
      expect(failure.reason).toMatch(/No match for this show from any configured metadata provider/)
    }

    // The regression this guards: without caching the "no candidate id
    // found at all" outcome in showFailures (not just a thrown resolve
    // error), a show with N watched episodes makes N redundant /find
    // calls instead of one.
    expect(findCalls.count).toBe(1)
  })

  it('survives an unexpected per-item error instead of losing the rest of the page', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchStub({
        // A well-formed item, then a malformed one that throws from
        // outside any of import/match.ts's provider-error try/catches —
        // the malformed item must not cost the successful one its place
        // in the job's own counters.
        historyItems: [fx.matrixHistoryItem, fx.malformedHistoryItem],
      }),
    )

    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsProcessed).toBe(2)
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures.some((f) => f.reason.match(/Unexpected error/))).toBe(true)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
  })

  it('re-importing ratings updates a changed rating rather than skipping it', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    vi.stubGlobal('fetch', createFetchStub({ ratingsItems: [fx.matrixRatingItem(7)] }))
    const [job1] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeHistory: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)

    const firstPass = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(firstPass).toHaveLength(1)
    expect(firstPass[0]?.rating).toBe(7)

    vi.stubGlobal('fetch', createFetchStub({ ratingsItems: [fx.matrixRatingItem(9)] }))
    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeHistory: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const secondPass = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(secondPass).toHaveLength(1)
    expect(secondPass[0]?.rating).toBe(9)
  })

  it('reports itemsImported accurately — only new/changed ratings, watchlist entries, and dropped shows count, not every successfully-matched item on re-import', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    const unchangedFixtures = {
      ratingsItems: [fx.matrixRatingItem(7)],
      watchlistItemsList: [fx.matrixWatchlistItem],
      droppedItems: [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')],
    }

    vi.stubGlobal('fetch', createFetchStub(unchangedFixtures))
    const [job1] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: true,
        includeWatchlist: true,
      })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)
    const [finished1] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job1!.id))
      .limit(1)
    // First pass: all three are genuinely new rows.
    expect(finished1?.itemsImported).toBe(3)
    expect(finished1?.itemsSkipped).toBe(0)

    // Re-running against the exact same Trakt data — nothing has actually
    // changed, so nothing should count as "imported" this time.
    vi.stubGlobal('fetch', createFetchStub(unchangedFixtures))
    const [job2] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: true,
        includeWatchlist: true,
      })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)
    const [finished2] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job2!.id))
      .limit(1)
    expect(finished2?.itemsImported).toBe(0)
    expect(finished2?.itemsSkipped).toBe(3)

    // A genuinely changed rating still counts as imported, not skipped.
    vi.stubGlobal(
      'fetch',
      createFetchStub({ ...unchangedFixtures, ratingsItems: [fx.matrixRatingItem(9)] }),
    )
    const [job3] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: true,
        includeWatchlist: true,
      })
      .returning()
    await runTraktImport(db, providers, env, job3!.id)
    const [finished3] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job3!.id))
      .limit(1)
    expect(finished3?.itemsImported).toBe(1)
    expect(finished3?.itemsSkipped).toBe(2)
  })

  it('imports a dropped show, and re-importing with a new hidden_at updates it rather than duplicating', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    vi.stubGlobal(
      'fetch',
      createFetchStub({ droppedItems: [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')] }),
    )
    const [job1] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: false,
        includeWatchlist: false,
      })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)

    const firstPass = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(firstPass).toHaveLength(1)
    expect(firstPass[0]?.traktDroppedAt?.toISOString()).toBe('2024-02-01T00:00:00.000Z')

    vi.stubGlobal(
      'fetch',
      createFetchStub({ droppedItems: [fx.breakingBadDroppedItem('2024-03-01T00:00:00.000Z')] }),
    )
    const [job2] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: false,
        includeWatchlist: false,
      })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const secondPass = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(secondPass).toHaveLength(1)
    expect(secondPass[0]?.traktDroppedAt?.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('does not revert a manually-set drop/undrop on a later re-import', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    // First import: Trakt reports the show as dropped, creating a
    // trakt-sourced row.
    vi.stubGlobal(
      'fetch',
      createFetchStub({ droppedItems: [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')] }),
    )
    const [job1] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: false,
        includeWatchlist: false,
      })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)

    const [row] = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(row?.traktDropped).toBe(true)
    expect(row?.manualDropped).toBeNull()

    // The user manually undrops it in rwnd.tv — same effect as
    // DELETE /library/shows/{slug}/dropped, an active override since it
    // disagrees with Trakt's own (still "dropped") state — see
    // apps/api/src/routes/library/shows.ts.
    await db
      .update(droppedShows)
      .set({ manualDropped: false, manualDroppedAt: new Date('2024-02-15T00:00:00.000Z') })
      .where(eq(droppedShows.id, row!.id))

    // Trakt still reports the show as dropped — a naive re-import would
    // silently overwrite the manual override.
    vi.stubGlobal(
      'fetch',
      createFetchStub({ droppedItems: [fx.breakingBadDroppedItem('2024-03-01T00:00:00.000Z')] }),
    )
    const [job2] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: false,
        includeWatchlist: false,
      })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const [after] = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(after?.traktDropped).toBe(true)
    expect(after?.manualDropped).toBe(false)
  })

  it('clears a manual drop override once Trakt catches up and agrees', async () => {
    // The user manually drops a show in rwnd.tv while Trakt has no opinion
    // on it yet (a bare override, traktDropped still null), then a later
    // import reports Trakt now also considers it dropped — the redundant
    // override should auto-clear to null rather than stay pinned to true
    // forever. See processDroppedItem in apps/api/src/import/trakt.ts.
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    // History import first, just to get the show matched/created locally
    // — dropping is unrelated to watch history, but this is the simplest
    // existing way to resolve a real show row to attach the manual
    // override to.
    vi.stubGlobal('fetch', createFetchStub({ historyItems: [fx.pilotHistoryItem] }))
    const [job1] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, providers, env, job1!.id)
    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad')).limit(1)
    if (!show) throw new Error('history import did not create the show')

    await db.insert(droppedShows).values({
      userId: me.id,
      showId: show.id,
      manualDropped: true,
      manualDroppedAt: new Date('2024-01-15T00:00:00.000Z'),
    })

    vi.stubGlobal(
      'fetch',
      createFetchStub({ droppedItems: [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')] }),
    )
    const [job2] = await db
      .insert(importJobs)
      .values({
        userId: me.id,
        includeHistory: false,
        includeRatings: false,
        includeWatchlist: false,
      })
      .returning()
    await runTraktImport(db, providers, env, job2!.id)

    const [after] = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(after?.traktDropped).toBe(true)
    expect(after?.manualDropped).toBeNull()
  })

  it('reports a season-level watchlist entry as unmatched instead of inserting it', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    vi.stubGlobal(
      'fetch',
      createFetchStub({
        watchlistItemsList: [fx.matrixWatchlistItem, fx.seasonWatchlistItem],
      }),
    )

    const [job] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeHistory: false, includeRatings: false })
      .returning()
    await runTraktImport(db, providers, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures[0]?.reason).toMatch(/season/i)
    expect(finished?.failures[0]?.show).toBe('Some Other Show')
    expect(finished?.failures[0]?.season).toBe(1)
    expect(finished?.failures[0]?.episode).toBeUndefined()

    const items = await db.select().from(watchlistItems).where(eq(watchlistItems.userId, me.id))
    expect(items).toHaveLength(1)
  })

  it("does not let a user read another user's import job", async () => {
    const cookieA = await createUserAndCookie('owner@example.com')
    const meA = await json<User>(
      await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } }),
    )
    await createTraktConnection(db, meA.id)
    vi.stubGlobal('fetch', createFetchStub())

    const [job] = await db.insert(importJobs).values({ userId: meA.id }).returning()
    await runTraktImport(db, providers, env, job!.id)

    await createLocalUser(db, 'other-importer@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'other-importer@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookieB = extractCookie(loginB)!

    const res = await app.request(`/api/v1/import/jobs/${job!.id}`, {
      headers: { cookie: cookieB },
    })
    expect(res.status).toBe(404)
  })
})

describe('Trakt ZIP-upload import (POST /import/trakt/zip)', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  /** Builds a synthetic "Export now" ZIP from `{ filename: parsedJsonBody }`
   * — real shard/dropped-file names in, JSON re-encoded and zipped, same
   * shape apps/api/src/import/trakt-zip-parse.ts expects to unzip back out. */
  function buildZipFile(files: Record<string, unknown>): File {
    const entries: Record<string, Uint8Array> = {}
    for (const [name, content] of Object.entries(files)) {
      entries[name] = strToU8(JSON.stringify(content))
    }
    return new File([zipSync(entries)], 'trakt-export.zip', { type: 'application/zip' })
  }

  function postZip(
    cookie: string,
    files: Record<string, unknown> | null,
    opts: { history?: boolean; ratings?: boolean; watchlist?: boolean; dropped?: boolean } = {},
  ) {
    const form = new FormData()
    if (files) form.set('file', buildZipFile(files))
    if (opts.history !== undefined) form.set('history', String(opts.history))
    if (opts.ratings !== undefined) form.set('ratings', String(opts.ratings))
    if (opts.watchlist !== undefined) form.set('watchlist', String(opts.watchlist))
    if (opts.dropped !== undefined) form.set('dropped', String(opts.dropped))
    return app.request('/api/v1/import/trakt/zip', {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
  }

  async function waitForCompletion(cookie: string, jobId: string) {
    return waitFor(async () => {
      const res = await app.request(`/api/v1/import/jobs/${jobId}`, { headers: { cookie } })
      const body = await json<{ status: string }>(res)
      return body.status === 'completed' ? body : undefined
    })
  }

  it('imports watch history and dropped shows end to end from an uploaded export, without needing a Trakt connection', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()

    const res = await postZip(cookie, {
      'watched-history-1.json': [fx.matrixHistoryItem, fx.pilotHistoryItem],
      'watched-history-2.json': [fx.secondEpisodeHistoryItem],
      'hidden-progress-watched.json': [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')],
    })
    expect(res.status).toBe(202)
    const job = await json<{ id: string; source: string }>(res)
    expect(job.source).toBe('trakt_zip')

    await waitForCompletion(cookie, job.id)

    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(3)
    expect(allPlays.every((p) => p.source === 'import')).toBe(true)

    const dropped = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.traktDropped).toBe(true)
  })

  it('imports ratings (concatenated across the per-type files) and watchlist end to end from an uploaded export', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    // Confirmed 2026-08-25 against a real populated export: an episode
    // rating lives in ratings-episodes.json, same TraktRatingItem shape as
    // a movie rating in ratings-movies.json — this exercises both files
    // being read and concatenated into one list.
    const episodeRating: TraktRatingItem = {
      rated_at: '2024-01-20T00:00:00.000Z',
      rating: 8,
      type: 'episode',
      show: fx.pilotHistoryItem.show,
      episode: fx.pilotHistoryItem.episode,
    }

    const res = await postZip(cookie, {
      'watched-history-1.json': [],
      'ratings-movies.json': [fx.matrixRatingItem(7)],
      'ratings-episodes.json': [episodeRating],
      'lists-watchlist.json': [fx.matrixWatchlistItem],
    })
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(ratingRows.map((r) => r.rating).sort()).toEqual([7, 8])

    const watchlistRows = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, me.id))
    expect(watchlistRows).toHaveLength(1)
  })

  it('respects the ratings/watchlist include toggles', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const res = await postZip(
      cookie,
      {
        'watched-history-1.json': [],
        'ratings-movies.json': [fx.matrixRatingItem(7)],
        'lists-watchlist.json': [fx.matrixWatchlistItem],
      },
      { ratings: false, watchlist: true },
    )
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(ratingRows).toHaveLength(0)
    const watchlistRows = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, me.id))
    expect(watchlistRows).toHaveLength(1)
  })

  it('rejects a non-ZIP upload', async () => {
    const cookie = await createUserAndCookie()
    const form = new FormData()
    form.set('file', new File([strToU8('not a zip')], 'notes.txt', { type: 'text/plain' }))
    const res = await app.request('/api/v1/import/trakt/zip', {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    expect(res.status).toBe(400)
  })

  it('rejects an upload missing the file field', async () => {
    const cookie = await createUserAndCookie()
    const res = await postZip(cookie, null)
    expect(res.status).toBe(400)
  })

  it("rejects an export ZIP with no watched-history-*.json files — it doesn't look like a real export", async () => {
    const cookie = await createUserAndCookie()
    const res = await postZip(cookie, { 'user-profile.json': { username: 'nobody' } })
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/watched-history/)
  })

  it('rejects starting a second import while one is already in progress', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const first = await postZip(cookie, { 'watched-history-1.json': [fx.matrixHistoryItem] })
    expect(first.status).toBe(202)

    const second = await postZip(cookie, { 'watched-history-1.json': [fx.pilotHistoryItem] })
    expect(second.status).toBe(409)
  })

  it('is idempotent on re-upload of the same export, same as the OAuth import path', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    const files = { 'watched-history-1.json': [fx.matrixHistoryItem] }

    const first = await postZip(cookie, files)
    const firstJob = await json<{ id: string }>(first)
    await waitForCompletion(cookie, firstJob.id)

    const second = await postZip(cookie, files)
    const secondJob = await json<{ id: string }>(second)
    await waitForCompletion(cookie, secondJob.id)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
  })

  it('respects the history/dropped include toggles', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const res = await postZip(
      cookie,
      {
        'watched-history-1.json': [fx.matrixHistoryItem],
        'hidden-progress-watched.json': [fx.breakingBadDroppedItem('2024-02-01T00:00:00.000Z')],
      },
      { history: false, dropped: true },
    )
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(0)
    const dropped = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(dropped).toHaveLength(1)
  })

  it("does not let a user read another user's ZIP import job", async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookieA = await createUserAndCookie('zip-owner@example.com')
    const resA = await postZip(cookieA, { 'watched-history-1.json': [fx.matrixHistoryItem] })
    const jobA = await json<{ id: string }>(resA)

    await createLocalUser(db, 'zip-other@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'zip-other@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookieB = extractCookie(loginB)!

    const res = await app.request(`/api/v1/import/jobs/${jobA.id}`, {
      headers: { cookie: cookieB },
    })
    expect(res.status).toBe(404)
  })
})

describe('CSV import (POST /import/csv)', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  type CsvRow = Record<string, string>

  const HISTORY_HEADER = [
    'type',
    'title',
    'show_title',
    'season_number',
    'episode_number',
    'watched_at',
    'source',
    'tmdb_id',
    'tvdb_id',
  ]
  const RATINGS_HEADER = [
    'type',
    'title',
    'show_title',
    'season_number',
    'episode_number',
    'rating',
    'rated_at',
    'tmdb_id',
    'tvdb_id',
  ]
  const WATCHLIST_HEADER = [
    'type',
    'title',
    'show_title',
    'season_number',
    'episode_number',
    'listed_at',
    'notes',
    'tmdb_id',
    'tvdb_id',
  ]
  const DROPPED_HEADER = ['show_title', 'tmdb_id', 'tvdb_id', 'dropped_at']

  /** Builds one CSV file's text — real RFC 4180 shape (BOM, CRLF), same as
   * apps/api/src/lib/csv.ts's own writeCsv, so this exercises the real
   * parser rather than a simplified stand-in. */
  function buildCsv(header: string[], rows: CsvRow[]): string {
    const lines = [
      header.join(','),
      ...rows.map((row) => header.map((column) => row[column] ?? '').join(',')),
    ]
    return '﻿' + lines.join('\r\n') + '\r\n'
  }

  function buildCsvZipFile(
    files: {
      history?: CsvRow[]
      ratings?: CsvRow[]
      watchlist?: CsvRow[]
      dropped?: CsvRow[]
    } = {},
  ): File {
    const entries: Record<string, Uint8Array> = {
      'history.csv': strToU8(buildCsv(HISTORY_HEADER, files.history ?? [])),
      'ratings.csv': strToU8(buildCsv(RATINGS_HEADER, files.ratings ?? [])),
      'watchlist.csv': strToU8(buildCsv(WATCHLIST_HEADER, files.watchlist ?? [])),
      'dropped-shows.csv': strToU8(buildCsv(DROPPED_HEADER, files.dropped ?? [])),
    }
    return new File([zipSync(entries)], 'rwnd-tv-export.zip', { type: 'application/zip' })
  }

  function postCsv(
    cookie: string,
    files: Parameters<typeof buildCsvZipFile>[0] | null,
    opts: { history?: boolean; ratings?: boolean; watchlist?: boolean; dropped?: boolean } = {},
  ) {
    const form = new FormData()
    if (files) form.set('file', buildCsvZipFile(files))
    if (opts.history !== undefined) form.set('history', String(opts.history))
    if (opts.ratings !== undefined) form.set('ratings', String(opts.ratings))
    if (opts.watchlist !== undefined) form.set('watchlist', String(opts.watchlist))
    if (opts.dropped !== undefined) form.set('dropped', String(opts.dropped))
    return app.request('/api/v1/import/csv', {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
  }

  async function waitForCompletion(cookie: string, jobId: string) {
    return waitFor(async () => {
      const res = await app.request(`/api/v1/import/jobs/${jobId}`, { headers: { cookie } })
      const body = await json<{ status: string }>(res)
      return body.status === 'completed' ? body : undefined
    })
  }

  const matrixHistoryRow: CsvRow = {
    type: 'movie',
    title: 'The Matrix',
    watched_at: '2024-01-01T12:00:00.000Z',
    source: 'manual',
    tmdb_id: String(fx.MATRIX_TMDB_ID),
  }
  const pilotHistoryRow: CsvRow = {
    type: 'episode',
    title: 'Pilot',
    show_title: 'Breaking Bad',
    season_number: '1',
    episode_number: '1',
    watched_at: '2024-01-02T12:00:00.000Z',
    source: 'manual',
    tmdb_id: String(fx.BREAKING_BAD_SHOW_TMDB_ID),
  }
  const secondEpisodeHistoryRow: CsvRow = {
    ...pilotHistoryRow,
    episode_number: '2',
    watched_at: '2024-01-03T12:00:00.000Z',
  }
  const breakingBadDroppedRow: CsvRow = {
    show_title: 'Breaking Bad',
    tmdb_id: String(fx.BREAKING_BAD_SHOW_TMDB_ID),
    dropped_at: '2024-02-01T00:00:00.000Z',
  }

  it('imports watch history and dropped shows end to end from an uploaded rwnd.tv export', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()

    const res = await postCsv(cookie, {
      history: [matrixHistoryRow, pilotHistoryRow, secondEpisodeHistoryRow],
      dropped: [breakingBadDroppedRow],
    })
    expect(res.status).toBe(202)
    const job = await json<{ id: string; source: string }>(res)
    expect(job.source).toBe('csv')

    await waitForCompletion(cookie, job.id)

    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(3)
    expect(allPlays.every((p) => p.source === 'import')).toBe(true)

    // manualDropped, not traktDropped — this data didn't come from a
    // Trakt sync, so it's recorded as the user's own manual choice (see
    // apps/api/src/import/csv.ts's processDroppedRow).
    const dropped = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.manualDropped).toBe(true)
    expect(dropped[0]?.traktDropped).toBeNull()
  })

  it('imports ratings (including a note-carrying watchlist entry) end to end', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const res = await postCsv(cookie, {
      ratings: [
        { ...matrixHistoryRow, rating: '7', rated_at: '2024-01-15T00:00:00.000Z' },
        { ...pilotHistoryRow, rating: '8', rated_at: '2024-01-20T00:00:00.000Z' },
      ],
      watchlist: [
        {
          ...matrixHistoryRow,
          listed_at: '2024-01-10T00:00:00.000Z',
          notes: 'watch with friends',
        },
      ],
    })
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(ratingRows.map((r) => r.rating).sort()).toEqual([7, 8])

    const watchlistRows = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, me.id))
    expect(watchlistRows).toHaveLength(1)
    // Unlike the Trakt importer (which never writes notes at all — see
    // trakt.ts's own processWatchlistItem), the CSV round-trip does.
    expect(watchlistRows[0]?.notes).toBe('watch with friends')
  })

  it('respects the ratings/watchlist include toggles', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const res = await postCsv(
      cookie,
      {
        ratings: [{ ...matrixHistoryRow, rating: '7', rated_at: '2024-01-15T00:00:00.000Z' }],
        watchlist: [{ ...matrixHistoryRow, listed_at: '2024-01-10T00:00:00.000Z', notes: '' }],
      },
      { ratings: false, watchlist: true },
    )
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(ratingRows).toHaveLength(0)
    const watchlistRows = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, me.id))
    expect(watchlistRows).toHaveLength(1)
  })

  it('caches season resolution across multiple episodes of the same show', async () => {
    const seasonCalls = { count: 0 }
    vi.stubGlobal('fetch', createFetchStub({ seasonCalls }))
    const cookie = await createUserAndCookie()

    const res = await postCsv(cookie, {
      history: [pilotHistoryRow, secondEpisodeHistoryRow],
    })
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    expect(seasonCalls.count).toBe(1)
  })

  it('rejects a non-ZIP upload', async () => {
    const cookie = await createUserAndCookie()
    const form = new FormData()
    form.set('file', new File([strToU8('not a zip')], 'notes.txt', { type: 'text/plain' }))
    const res = await app.request('/api/v1/import/csv', {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    expect(res.status).toBe(400)
  })

  it('rejects an upload missing the file field', async () => {
    const cookie = await createUserAndCookie()
    const res = await postCsv(cookie, null)
    expect(res.status).toBe(400)
  })

  it("rejects a ZIP that doesn't look like an rwnd.tv export", async () => {
    const cookie = await createUserAndCookie()
    const entries: Record<string, Uint8Array> = {
      'user-profile.json': strToU8(JSON.stringify({ username: 'nobody' })),
    }
    const form = new FormData()
    form.set('file', new File([zipSync(entries)], 'wrong.zip', { type: 'application/zip' }))
    const res = await app.request('/api/v1/import/csv', {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/rwnd\.tv/)
  })

  it('rejects starting a second import while one is already in progress', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const first = await postCsv(cookie, { history: [matrixHistoryRow] })
    expect(first.status).toBe(202)

    const second = await postCsv(cookie, { history: [pilotHistoryRow] })
    expect(second.status).toBe(409)
  })

  it('is idempotent on re-upload of the same export — no duplicate plays', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    const files = { history: [matrixHistoryRow] }

    const first = await postCsv(cookie, files)
    const firstJob = await json<{ id: string }>(first)
    await waitForCompletion(cookie, firstJob.id)

    const second = await postCsv(cookie, files)
    const secondJob = await json<{ id: string }>(second)
    const completed = await waitForCompletion(cookie, secondJob.id)

    // The synthetic sourceRef (apps/api/src/import/csv.ts's own
    // processHistoryRow) makes the re-upload a correct no-op via the
    // existing plays_user_source_ref_idx partial unique index.
    expect(completed).toMatchObject({ status: 'completed' })
    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
  })

  // Regression: found live testing this feature. The synthetic sourceRef
  // above only guards a CSV-imported play against *another CSV import* of
  // the same row — it does nothing against the plays this CSV was
  // originally exported from in the first place (a manual watch, a Plex
  // scrobble, an earlier real Trakt import), which have their own
  // different sourceRefs (or none) and so never collide with the unique
  // index on their own. Confirmed live before this test existed: re-
  // importing a real ~11,000-row export back into the same account
  // duplicated every single history row. existingPlayKeys (csv.ts) is the
  // actual fix — this test is what would have caught it.
  it('does not duplicate a play that already exists under a different source', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const manualPlay = await app.request('/api/v1/plays', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movie: { source: 'tmdb', externalId: String(fx.MATRIX_TMDB_ID) },
        watchedAt: matrixHistoryRow.watched_at,
      }),
    })
    expect(manualPlay.status).toBe(201)

    const res = await postCsv(cookie, { history: [matrixHistoryRow] })
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(1)
    expect(allPlays[0]?.source).toBe('manual')
  })

  // Regression: found live testing this feature (same round-trip that
  // caught the duplicate-plays bug above). A show already effectively
  // dropped via Trakt alone (manualDropped null, deferring to Trakt) got
  // hard-converted into a manual override on every CSV re-import, even
  // though nothing about its dropped-ness actually changed — a real
  // record mutation (visible as a spurious "added"/"removed" pair in the
  // JSON Backup diff) counted as "imported" for no real reason.
  it('does not convert a Trakt-only drop into a manual override on re-import', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const historyRes = await postCsv(cookie, { history: [pilotHistoryRow] })
    const historyJob = await json<{ id: string }>(historyRes)
    await waitForCompletion(cookie, historyJob.id)
    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad')).limit(1)
    if (!show) throw new Error('history import did not create the show')

    await db.insert(droppedShows).values({
      userId: me.id,
      showId: show.id,
      traktDropped: true,
      traktDroppedAt: new Date('2024-02-01T00:00:00.000Z'),
    })

    const res = await postCsv(cookie, { dropped: [breakingBadDroppedRow] })
    const job = await json<{ id: string; itemsImported: number }>(res)
    await waitForCompletion(cookie, job.id)

    const [after] = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(after?.traktDropped).toBe(true)
    expect(after?.manualDropped).toBeNull()

    const finished = await json<{ itemsImported: number }>(
      await app.request(`/api/v1/import/jobs/${job.id}`, { headers: { cookie } }),
    )
    expect(finished.itemsImported).toBe(0)
  })

  it('respects the history/dropped include toggles', async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))

    const res = await postCsv(
      cookie,
      { history: [matrixHistoryRow], dropped: [breakingBadDroppedRow] },
      { history: false, dropped: true },
    )
    const job = await json<{ id: string }>(res)
    await waitForCompletion(cookie, job.id)

    const allPlays = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlays).toHaveLength(0)
    const dropped = await db.select().from(droppedShows).where(eq(droppedShows.userId, me.id))
    expect(dropped).toHaveLength(1)
  })

  it("does not let a user read another user's CSV import job", async () => {
    vi.stubGlobal('fetch', createFetchStub())
    const cookieA = await createUserAndCookie('csv-owner@example.com')
    const resA = await postCsv(cookieA, { history: [matrixHistoryRow] })
    const jobA = await json<{ id: string }>(resA)

    await createLocalUser(db, 'csv-other@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'csv-other@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookieB = extractCookie(loginB)!

    const res = await app.request(`/api/v1/import/jobs/${jobA.id}`, {
      headers: { cookie: cookieB },
    })
    expect(res.status).toBe(404)
  })
})
