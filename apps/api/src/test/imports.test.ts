import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    // apps/api/src/routes/library.ts.
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
