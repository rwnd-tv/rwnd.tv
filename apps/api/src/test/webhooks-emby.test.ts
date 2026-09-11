import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { pendingWebhookEvents, plays, shows, webhookAccountLinks } from '@rwnd/db'
import { createLocalUser, json, resetDb, testDb } from './helpers.js'
import {
  createLinkedTokenAndCookie,
  createTokenAndCookie,
  fakeTmdb,
  postMultipartWebhook,
} from './webhook-fixtures.js'
import { createApp } from '../app.js'

const db = testDb()

const DEFAULT_ACCOUNT = { Id: '1', Name: 'james' }

function embyMoviePayload(itemOverrides: Record<string, unknown> = {}, user = DEFAULT_ACCOUNT) {
  return {
    Event: 'playback.stop',
    User: user,
    Item: { Type: 'Movie', Id: 'item-movie-1', ProviderIds: { Tmdb: '603' }, ...itemOverrides },
    PlaybackInfo: { PlayedToCompletion: true },
  }
}

function embyEpisodePayload(itemOverrides: Record<string, unknown> = {}, user = DEFAULT_ACCOUNT) {
  return {
    Event: 'playback.stop',
    User: user,
    Item: {
      Type: 'Episode',
      Id: 'item-episode-1',
      SeriesName: 'Breaking Bad',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      ProviderIds: { Tmdb: '1396' },
      ...itemOverrides,
    },
    PlaybackInfo: { PlayedToCompletion: true },
  }
}

function postWebhook(app: ReturnType<typeof createApp>, token: string, payload: unknown) {
  return postMultipartWebhook(app, 'emby', token, 'data', payload)
}

describe('POST /webhooks/emby/:token', () => {
  beforeEach(() => resetDb(db))

  it('rejects a missing or invalid token', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const res = await postWebhook(app, 'not-a-real-token', embyMoviePayload())
    expect(res.status).toBe(401)
  })

  it('logs a movie watch end to end for an already-linked account', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    const res = await postWebhook(app, token, embyMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('emby')
  })

  it('logs an episode watch end to end, resolving the show then the episode', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    const res = await postWebhook(app, token, embyEpisodePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(show).toBeDefined()
  })

  it("replaces an existing 'import' play for the same movie with a live Emby webhook (origin outranks import)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, embyMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!
    await db.delete(plays).where(eq(plays.userId, userId))

    await db.insert(plays).values({
      userId,
      movieId,
      watchedAt: new Date(),
      source: 'import',
      sourceRef: 'trakt-history-item-1',
    })

    const res = await postWebhook(app, token, embyMoviePayload())
    expect(res.status).toBe(200)

    // Origin sources always win over import (apps/api/src/lib/plays.ts's
    // reconcilePlayDuplicates) — the live webhook replaces the relayed
    // import row rather than deferring to it.
    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('emby')
  })

  it("does not dedupe against an existing 'jellyfin' play for the same movie (two origin sources never suppress each other)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, embyMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!
    await db.delete(plays).where(eq(plays.userId, userId))

    await db.insert(plays).values({
      userId,
      movieId,
      watchedAt: new Date(),
      source: 'jellyfin',
      sourceRef: 'jellyfin-item-1:2026-01-01',
    })

    const res = await postWebhook(app, token, embyMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.map((p) => p.source).sort()).toEqual(['emby', 'jellyfin'])
  })

  it('logs a separate play for the same movie watched on a different origin source an hour later', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, embyMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!
    await db.delete(plays).where(eq(plays.userId, userId))

    // Confirmed live 2026-09-11: the same episode played on Jellyfin then
    // Emby about an hour apart is two genuinely separate plays, not one —
    // origin sources never dedupe against each other regardless of
    // timing (apps/api/src/lib/plays.ts's reconcilePlayDuplicates). This
    // regression-tests the exact live scenario; the window-independence
    // itself is also covered above.
    await db.insert(plays).values({
      userId,
      movieId,
      watchedAt: new Date(Date.now() - 60 * 60 * 1000),
      source: 'jellyfin',
      sourceRef: 'jellyfin-item-1:2026-01-01',
    })

    const res = await postWebhook(app, token, embyMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.map((p) => p.source).sort()).toEqual(['emby', 'jellyfin'])
  })

  it('is idempotent — the same event delivered twice logs one play, not two', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    await postWebhook(app, token, embyMoviePayload())
    await postWebhook(app, token, embyMoviePayload())

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('200s as a no-op for playback.start', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    const payload = embyMoviePayload()
    const res = await postWebhook(app, token, { ...payload, Event: 'playback.start' })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('200s as a no-op for the plugin test button (system.webhooktest)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    const res = await postWebhook(app, token, {
      Title: 'Test Notification',
      Event: 'system.webhooktest',
      User: DEFAULT_ACCOUNT,
      Server: { Name: 'test', Id: 'srv-1' },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('400s on malformed multipart body', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'emby', '1', 'james')

    const res = await app.request(`/api/v1/webhooks/emby/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not a form',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /webhooks/emby/:token — multi-user attribution', () => {
  beforeEach(() => resetDb(db))

  const MANAGED_ACCOUNT = { Id: '2', Name: 'kid-profile' }

  it('creates an unlinked link and a pending event, logging nothing, for an account seen for the first time', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, embyMoviePayload({}, MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.source).toBe('emby')
    expect(link?.externalAccountId).toBe('2')
    expect(link?.externalAccountName).toBe('kid-profile')
    expect(link?.userId).toBeNull()

    const [pending] = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending?.source).toBe('emby')
    expect(pending?.event.media).toEqual({ type: 'movie' })
  })

  it('logs against the linked user, with their own locale, once linked (replay)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)
    const managedUserId = await createLocalUser(
      db,
      'managed@example.com',
      'correct-horse-battery-staple',
    )

    await postWebhook(app, token, embyMoviePayload({}, MANAGED_ACCOUNT))
    await db
      .update(webhookAccountLinks)
      .set({ userId: managedUserId })
      .where(eq(webhookAccountLinks.tokenId, tokenId))

    const res = await postWebhook(app, token, embyMoviePayload({}, MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select({ userId: plays.userId }).from(plays)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(managedUserId)
  })
})
