import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { episodes, movies, pendingWebhookEvents, plays, shows, webhookAccountLinks } from '@rwnd/db'
import type { CreateApiTokenResponse } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testDb } from './helpers.js'
import { createApp } from '../app.js'
import type { MetadataProvider } from '../providers/types.js'

const db = testDb()

async function createUserAndCookie(
  app: ReturnType<typeof createApp>,
  email = 'watcher@example.com',
) {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

function fakeTmdb(): MetadataProvider {
  return {
    source: 'tmdb',
    async searchMulti() {
      return []
    },
    async getMovie(externalId) {
      if (externalId !== '603') throw new Error(`Unexpected movie lookup: ${externalId}`)
      return {
        externalId,
        title: 'The Matrix',
        year: 1999,
        runtimeMinutes: 136,
        overview: null,
        posterPath: null,
        genres: [],
        voteAverage: null,
        imdbId: null,
      }
    },
    async getShow(externalId) {
      if (externalId !== '1396') throw new Error(`Unexpected show lookup: ${externalId}`)
      return {
        externalId,
        title: 'Breaking Bad',
        year: 2008,
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
      throw new Error('Not used — webhook episode resolution goes through getSeason')
    },
    async getSeason(externalId, seasonNumber) {
      if (externalId !== '1396' || seasonNumber !== 1) {
        throw new Error(`Unexpected season lookup: ${externalId} season ${seasonNumber}`)
      }
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: [
          {
            title: 'Pilot',
            seasonNumber: 1,
            episodeNumber: 1,
            runtimeMinutes: 58,
            firstAired: '2008-01-20',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
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

/** Simulates TvdbProvider.getShow's own episode-id fallback (see tvdb.ts):
 * externalId '11569546' actually identifies an episode, not the show
 * itself, so getShow redirects and returns the real show under a
 * *different* externalId ('387219') — live-verified 2026-08-24 via a real
 * Plex webhook for an F1 qualifying session. getSeason asserts it's called
 * with the corrected id, not the original one the webhook carried — the
 * regression this guards against (resolveShow forwarding the wrong id to
 * every downstream episode/season lookup). */
function fakeTvdbWithEpisodeRedirect(): MetadataProvider {
  return {
    source: 'tvdb',
    async searchMulti() {
      return []
    },
    async getMovie() {
      throw new Error('Not used')
    },
    async getShow(externalId) {
      // '387219' is the show's own real id (no redirect needed) — accepted
      // too so a test can first resolve the show normally, then separately
      // exercise the episode-id-redirect path against an *already-known*
      // show (see the "does not create a duplicate show" test below).
      if (externalId !== '11569546' && externalId !== '387219') {
        throw new Error(`Unexpected show lookup: ${externalId}`)
      }
      return {
        externalId: '387219',
        title: 'Formula 1',
        year: 2018,
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
      throw new Error('Not used — webhook episode resolution goes through getSeason')
    },
    async getSeason(externalId, seasonNumber) {
      if (externalId !== '387219' || seasonNumber !== 2026) {
        throw new Error(`Unexpected season lookup: ${externalId} season ${seasonNumber}`)
      }
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: [
          {
            title: 'Netherlands (Qualifying)',
            seasonNumber: 2026,
            episodeNumber: 66,
            runtimeMinutes: 60,
            firstAired: '2026-08-22',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
            imdbId: null,
          },
          {
            title: 'Netherlands (Practice)',
            seasonNumber: 2026,
            episodeNumber: 65,
            runtimeMinutes: 60,
            firstAired: '2026-08-21',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
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

/** Account id "1" carries no special meaning any more — Plex's own docs
 * claim it's always the server owner, but that doesn't hold for real
 * payloads (see `resolveWebhookAccount`'s doc comment), so every
 * account, including this one, starts unclaimed like any other. Tests
 * that aren't specifically exercising the unclaimed/claim flow use
 * `createClaimedTokenAndCookie` below instead, which pre-claims it. */
const DEFAULT_ACCOUNT = { id: 1, title: 'james' }

async function createTokenAndCookie(app: ReturnType<typeof createApp>) {
  const cookie = await createUserAndCookie(app)
  const res = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Plex' }),
  })
  const { id: tokenId, token } = await json<CreateApiTokenResponse>(res)
  return { cookie, token, tokenId }
}

/** For tests about what happens *after* an account is already linked —
 * pre-seeds the claim directly (bypassing the claim route itself, which
 * has its own dedicated tests in tokens.test.ts) so these tests can
 * focus purely on webhook behavior. */
async function createClaimedTokenAndCookie(app: ReturnType<typeof createApp>) {
  const { cookie, token, tokenId } = await createTokenAndCookie(app)
  const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
  const { id: userId } = await json<{ id: string }>(meRes)
  await db.insert(webhookAccountLinks).values({
    tokenId,
    source: 'plex',
    externalAccountId: DEFAULT_ACCOUNT.id.toString(),
    externalAccountName: DEFAULT_ACCOUNT.title,
    userId,
  })
  return { cookie, token, tokenId }
}

function plexMoviePayload(account: Record<string, unknown> = DEFAULT_ACCOUNT) {
  return {
    event: 'media.scrobble',
    Account: account,
    Metadata: { type: 'movie', ratingKey: '5001', Guid: [{ id: 'tmdb://603' }] },
  }
}

function plexEpisodePayload(account: Record<string, unknown> = DEFAULT_ACCOUNT) {
  return {
    event: 'media.scrobble',
    Account: account,
    Metadata: {
      type: 'episode',
      ratingKey: '5002',
      grandparentTitle: 'Breaking Bad',
      parentIndex: 1,
      index: 1,
      Guid: [{ id: 'tmdb://1396' }],
    },
  }
}

async function postWebhook(app: ReturnType<typeof createApp>, token: string, payload: unknown) {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  return app.request(`/api/v1/webhooks/plex/${token}`, { method: 'POST', body: form })
}

describe('POST /webhooks/plex/:token', () => {
  beforeEach(() => resetDb(db))

  it('rejects a missing or invalid token', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const res = await postWebhook(app, 'not-a-real-token', plexMoviePayload())
    expect(res.status).toBe(401)
  })

  it('logs a movie watch end to end for an already-claimed account', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('plex')
  })

  it('logs an episode watch end to end, resolving the show then the episode', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, plexEpisodePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(show).toBeDefined()
  })

  it("skips logging a movie watch that already has an 'import' play for the same movie on the same day (cross-source dedup)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createClaimedTokenAndCookie(app)
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    // First delivery resolves and creates the movie locally, then is
    // deleted — isolates the cross-source check from the webhook's own
    // sourceRef-based idempotency, which would otherwise mask it.
    await postWebhook(app, token, plexMoviePayload())
    const [movie] = await db.select().from(movies).where(eq(movies.title, 'The Matrix')).limit(1)
    await db.delete(plays).where(eq(plays.userId, userId))

    // Simulates Trakt's own separate Plex scrobbling already having
    // logged this same real watch via a Trakt import, same day.
    await db.insert(plays).values({
      userId,
      movieId: movie!.id,
      watchedAt: new Date(),
      source: 'import',
      sourceRef: 'trakt-history-item-1',
    })

    const res = await postWebhook(app, token, plexMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('import')
  })

  it('resolves a show whose own native id actually identifies one of its episodes (TVDB id-space collision regression)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTvdbWithEpisodeRedirect()] })
    const { cookie, token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32915',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 66,
        Guid: [{ id: 'tvdb://11569546' }],
      },
    })
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Formula 1'))
    expect(show).toBeDefined()
  })

  it('does not create a duplicate show when a later event redirects to an id already known under its own', async () => {
    const app = createApp({ db, metadataProviders: [fakeTvdbWithEpisodeRedirect()] })
    const { cookie, token } = await createClaimedTokenAndCookie(app)

    // First delivery resolves the show via its own real id (no redirect
    // needed) — same as an ordinary earlier watch.
    const first = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32914',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 65,
        Guid: [{ id: 'tvdb://387219' }],
      },
    })
    expect(first.status).toBe(200)

    // Second delivery, a different episode, arrives with an id that
    // redirects to the *same* show (387219) — before the fix, resolveShow
    // couldn't tell this was already-known and created a second "Formula
    // 1" show with the wrong (uncorrected) external id, live-verified
    // 2026-08-24.
    const second = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32915',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 66,
        Guid: [{ id: 'tvdb://11569546' }],
      },
    })
    expect(second.status).toBe(200)

    const formula1Shows = await db.select().from(shows).where(eq(shows.title, 'Formula 1'))
    expect(formula1Shows).toHaveLength(1)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(2)
  })

  it('is idempotent — the same scrobble delivered twice logs one play, not two', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createClaimedTokenAndCookie(app)

    await postWebhook(app, token, plexMoviePayload())
    await postWebhook(app, token, plexMoviePayload())

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(1)
    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('200s without logging anything when no configured provider recognizes the title', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: { type: 'movie', ratingKey: '9999', Guid: [{ id: 'tmdb://404404' }] },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('200s as a no-op for a non-scrobble event', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.play',
      Metadata: { type: 'movie', ratingKey: '5001', Guid: [{ id: 'tmdb://603' }] },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('200s without logging anything for an episode not found in the resolved season', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createClaimedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '5003',
        grandparentTitle: 'Breaking Bad',
        parentIndex: 1,
        index: 99,
        Guid: [{ id: 'tmdb://1396' }],
      },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(episodes)
    expect(rows).toHaveLength(1) // the season's one real episode, resolved; no phantom row for #99
  })
})

describe('POST /webhooks/plex/:token — multi-user attribution', () => {
  beforeEach(() => resetDb(db))

  const MANAGED_ACCOUNT = { id: 2, title: 'kid-profile' }

  it('account id 1 is not auto-claimed — regression guard for the flawed "owner is always 1" assumption', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload(DEFAULT_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.externalAccountId).toBe('1')
    expect(link?.userId).toBeNull()
  })

  it('creates an unclaimed link and a pending event, logging nothing, for an account seen for the first time', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.externalAccountId).toBe('2')
    expect(link?.externalAccountName).toBe('kid-profile')
    expect(link?.userId).toBeNull()

    const [pending] = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending?.externalAccountId).toBe('2')
    expect(pending?.event.media).toEqual({ type: 'movie' })
    expect(pending?.event.ids).toEqual({ tmdb: '603' })
  })

  it('still logs nothing on a second event from the same still-unclaimed account (no duplicate link row, one more pending event)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const links = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(links).toHaveLength(1)

    const pending = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending).toHaveLength(2)
  })

  it('logs against the linked user, with their own locale, once claimed', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)
    const managedUserId = await createLocalUser(
      db,
      'managed@example.com',
      'correct-horse-battery-staple',
    )

    // First event discovers the account, unclaimed.
    await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    // Simulates the Settings UI's claim action (the claim route's own
    // replay behavior is covered in tokens.test.ts).
    await db
      .update(webhookAccountLinks)
      .set({ userId: managedUserId })
      .where(eq(webhookAccountLinks.tokenId, tokenId))

    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select({ userId: plays.userId }).from(plays)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(managedUserId)
  })
})
