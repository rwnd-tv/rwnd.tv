import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
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
import { createMetadataProvider } from '../providers/index.js'
import { runTraktImport } from '../import/trakt.js'
import type { TraktHistoryItem, TraktRatingItem, TraktWatchlistItem } from '../trakt/types.js'
import * as fx from './fixtures/trakt.js'

const db = testDb()
const app = testApp()
const env = loadEnv()
const provider = createMetadataProvider(env)

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
 * `seasonCalls`, when passed, counts /tv/{id}/season/{n} requests so tests
 * can assert provider.getSeason() is only called once per season.
 */
function createFetchStub(
  opts: {
    historyItems?: TraktHistoryItem[]
    ratingsItems?: TraktRatingItem[]
    watchlistItemsList?: TraktWatchlistItem[]
    seasonCalls?: { count: number }
  } = {},
) {
  const { historyItems = [], ratingsItems = [], watchlistItemsList = [], seasonCalls } = opts

  return vi.fn(async (input: string | URL) => {
    const url = new URL(input)

    if (url.hostname === 'api.themoviedb.org') {
      if (url.pathname === '/3/movie/603') return jsonResponse(fx.tmdbMatrixMovie)
      if (url.pathname === `/3/movie/${fx.TMDB_DELETED_MOVIE_ID}`) {
        return new Response('{"status_message":"Not Found"}', { status: 404 })
      }
      if (url.pathname === '/3/tv/1396') return jsonResponse(fx.tmdbBreakingBadShow)
      if (url.pathname === '/3/tv/1396/season/1') {
        if (seasonCalls) seasonCalls.count += 1
        return jsonResponse(fx.tmdbBreakingBadSeason1)
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
    await runTraktImport(db, provider, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(3)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures).toHaveLength(1)
    expect(finished?.failures[0]?.reason).toMatch(/No TMDB id/)

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

    // Re-running the same import must not create duplicate plays — this is
    // the plays_user_source_ref_idx partial unique index doing its job.
    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeRatings: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, provider, env, job2!.id)

    const allPlaysAfterReimport = await db.select().from(plays).where(eq(plays.userId, me.id))
    expect(allPlaysAfterReimport).toHaveLength(3)
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
    await runTraktImport(db, provider, env, job!.id)

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

  it('re-importing ratings updates a changed rating rather than skipping it', async () => {
    const cookie = await createUserAndCookie()
    const me = await json<User>(await app.request('/api/v1/auth/me', { headers: { cookie } }))
    await createTraktConnection(db, me.id)

    vi.stubGlobal('fetch', createFetchStub({ ratingsItems: [fx.matrixRatingItem(7)] }))
    const [job1] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeHistory: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, provider, env, job1!.id)

    const firstPass = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(firstPass).toHaveLength(1)
    expect(firstPass[0]?.rating).toBe(7)

    vi.stubGlobal('fetch', createFetchStub({ ratingsItems: [fx.matrixRatingItem(9)] }))
    const [job2] = await db
      .insert(importJobs)
      .values({ userId: me.id, includeHistory: false, includeWatchlist: false })
      .returning()
    await runTraktImport(db, provider, env, job2!.id)

    const secondPass = await db.select().from(ratings).where(eq(ratings.userId, me.id))
    expect(secondPass).toHaveLength(1)
    expect(secondPass[0]?.rating).toBe(9)
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
    await runTraktImport(db, provider, env, job!.id)

    const [finished] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id)).limit(1)
    expect(finished?.status).toBe('completed')
    expect(finished?.itemsImported).toBe(1)
    expect(finished?.itemsSkipped).toBe(1)
    expect(finished?.failures[0]?.reason).toMatch(/season/i)

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
    await runTraktImport(db, provider, env, job!.id)

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
