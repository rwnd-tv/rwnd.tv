import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { pendingWebhookEvents, plays, shows, webhookAccountLinks } from '@rwnd/db'
import { createLocalUser, json, resetDb, testDb } from './helpers.js'
import {
  createLinkedTokenAndCookie,
  createTokenAndCookie,
  fakeTmdb,
  postJsonWebhook,
} from './webhook-fixtures.js'
import { createApp } from '../app.js'

const db = testDb()

const DEFAULT_ACCOUNT = { UserId: '1', NotificationUsername: 'james' }

function jellyfinMoviePayload(overrides: Record<string, unknown> = {}) {
  return {
    NotificationType: 'PlaybackStop',
    ItemType: 'Movie',
    ItemId: 'item-movie-1',
    PlayedToCompletion: true,
    Provider_tmdb: '603',
    ...DEFAULT_ACCOUNT,
    ...overrides,
  }
}

function jellyfinEpisodePayload(overrides: Record<string, unknown> = {}) {
  return {
    NotificationType: 'PlaybackStop',
    ItemType: 'Episode',
    ItemId: 'item-episode-1',
    SeriesName: 'Breaking Bad',
    SeasonNumber: 1,
    EpisodeNumber: 1,
    PlayedToCompletion: true,
    Provider_tmdb: '1396',
    ...DEFAULT_ACCOUNT,
    ...overrides,
  }
}

function postWebhook(app: ReturnType<typeof createApp>, token: string, payload: unknown) {
  return postJsonWebhook(app, 'jellyfin', token, payload)
}

describe('POST /webhooks/jellyfin/:token', () => {
  beforeEach(() => resetDb(db))

  it('rejects a missing or invalid token', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const res = await postWebhook(app, 'not-a-real-token', jellyfinMoviePayload())
    expect(res.status).toBe(401)
  })

  it('logs a movie watch end to end for an already-linked account', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    const res = await postWebhook(app, token, jellyfinMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('jellyfin')
  })

  it('logs an episode watch end to end, resolving the show then the episode', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    const res = await postWebhook(app, token, jellyfinEpisodePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(show).toBeDefined()
  })

  it("replaces an existing 'import' play for the same movie with a live Jellyfin webhook (origin outranks import)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, jellyfinMoviePayload())
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

    const res = await postWebhook(app, token, jellyfinMoviePayload())
    expect(res.status).toBe(200)

    // Origin sources always win over import (apps/api/src/lib/plays.ts's
    // reconcilePlayDuplicates) — the live webhook replaces the relayed
    // import row rather than deferring to it.
    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('jellyfin')
  })

  it("does not dedupe against an existing 'plex' play for the same movie (two origin sources never suppress each other)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, jellyfinMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!
    await db.delete(plays).where(eq(plays.userId, userId))

    // Simulates the same movie also watched via Plex on the same server,
    // same day — confirmed live 2026-09-11 (Jellyfin then Emby, same
    // episode, an hour apart) that two origin sources must both be kept
    // as real plays, never deduped against each other regardless of how
    // close together they land (apps/api/src/lib/plays.ts's
    // reconcilePlayDuplicates).
    await db.insert(plays).values({
      userId,
      movieId,
      watchedAt: new Date(),
      source: 'plex',
      sourceRef: 'plex-ratingkey-1:2026-01-01',
    })

    const res = await postWebhook(app, token, jellyfinMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.map((p) => p.source).sort()).toEqual(['jellyfin', 'plex'])
  })

  it('is idempotent — the same event delivered twice within the same-source retry window logs one play, not two', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    await postWebhook(app, token, jellyfinMoviePayload())
    await postWebhook(app, token, jellyfinMoviePayload())

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('logs a second play for a genuine rewatch on the same source outside the retry window', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, jellyfinMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!

    // Backdate the existing play past SAME_SOURCE_RETRY_WINDOW_MS (5 min,
    // apps/api/src/lib/plays.ts) — a real rewatch on the same source, not
    // a retry of the same delivery, must still be logged, unlike the old
    // dailySourceRef day-bucket this replaced.
    await db
      .update(plays)
      .set({ watchedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(plays.movieId, movieId))

    const res = await postWebhook(app, token, jellyfinMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.every((p) => p.source === 'jellyfin')).toBe(true)
  })

  it('does not create two plays when the same event is delivered twice concurrently', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    // Simulates two near-simultaneous deliveries racing each other (e.g. a
    // slow response triggering an immediate retry) rather than arriving
    // one after the other — reconcilePlayDuplicates's pg_advisory_xact_lock
    // (apps/api/src/lib/plays.ts) is what actually prevents both requests
    // from each seeing "no conflict yet" and both inserting; without it
    // this is exactly the interleaving a check-then-insert sequence is
    // vulnerable to.
    const [resA, resB] = await Promise.all([
      postWebhook(app, token, jellyfinMoviePayload()),
      postWebhook(app, token, jellyfinMoviePayload()),
    ])
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('200s as a no-op for a non-completed PlaybackStop', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    const res = await postWebhook(app, token, jellyfinMoviePayload({ PlayedToCompletion: false }))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('400s on malformed JSON', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'jellyfin', '1', 'james')

    const res = await app.request(`/api/v1/webhooks/jellyfin/${token}`, {
      method: 'POST',
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /webhooks/jellyfin/:token — multi-user attribution', () => {
  beforeEach(() => resetDb(db))

  const MANAGED_ACCOUNT = { UserId: '2', NotificationUsername: 'kid-profile' }

  it('creates an unlinked link and a pending event, logging nothing, for an account seen for the first time', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, jellyfinMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.source).toBe('jellyfin')
    expect(link?.externalAccountId).toBe('2')
    expect(link?.externalAccountName).toBe('kid-profile')
    expect(link?.userId).toBeNull()

    const [pending] = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending?.source).toBe('jellyfin')
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

    await postWebhook(app, token, jellyfinMoviePayload(MANAGED_ACCOUNT))
    await db
      .update(webhookAccountLinks)
      .set({ userId: managedUserId })
      .where(eq(webhookAccountLinks.tokenId, tokenId))

    const res = await postWebhook(app, token, jellyfinMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select({ userId: plays.userId }).from(plays)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(managedUserId)
  })
})
