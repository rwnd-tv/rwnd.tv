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

const DEFAULT_ACCOUNT = { user_id: '1', user: 'james', username: 'james' }

function tautulliMoviePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'watched',
    media_type: 'movie',
    rating_key: 'item-movie-1',
    themoviedb_id: '603',
    server_machine_id: 'server-a',
    ...DEFAULT_ACCOUNT,
    ...overrides,
  }
}

function tautulliEpisodePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'watched',
    media_type: 'episode',
    rating_key: 'item-episode-1',
    show_name: 'Breaking Bad',
    season_num: '1',
    episode_num: '1',
    themoviedb_id: '1396',
    server_machine_id: 'server-a',
    ...DEFAULT_ACCOUNT,
    ...overrides,
  }
}

function postWebhook(app: ReturnType<typeof createApp>, token: string, payload: unknown) {
  return postJsonWebhook(app, 'tautulli', token, payload)
}

describe('POST /webhooks/tautulli/:token', () => {
  beforeEach(() => resetDb(db))

  it('rejects a missing or invalid token', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const res = await postWebhook(app, 'not-a-real-token', tautulliMoviePayload())
    expect(res.status).toBe(401)
  })

  it('logs a movie watch end to end for an already-linked account', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const res = await postWebhook(app, token, tautulliMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('tautulli')
  })

  it('logs an episode watch end to end, resolving the show then the episode', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const res = await postWebhook(app, token, tautulliEpisodePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(show).toBeDefined()
  })

  it("replaces an existing 'import' play for the same movie with a live Tautulli webhook (origin outranks import)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, tautulliMoviePayload())
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

    const res = await postWebhook(app, token, tautulliMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('tautulli')
  })

  it("does not dedupe against an existing 'plex' play for the same movie (two origin sources never suppress each other, even plex/tautulli)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, tautulliMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!
    await db.delete(plays).where(eq(plays.userId, userId))

    // The Plex/Tautulli same-server duplicate is prevented at *link* time
    // (hasConflictingServerLink, apps/api/src/lib/webhook-accounts.ts — see
    // the describe block below), not by reconcilePlayDuplicates itself —
    // so at the play layer, plex and tautulli behave like any other two
    // origin sources: never suppressing each other, regardless of timing.
    await db.insert(plays).values({
      userId,
      movieId,
      watchedAt: new Date(),
      source: 'plex',
      sourceRef: 'plex-ratingkey-1:2026-01-01',
    })

    const res = await postWebhook(app, token, tautulliMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.map((p) => p.source).sort()).toEqual(['plex', 'tautulli'])
  })

  it('is idempotent — the same event delivered twice within the same-source retry window logs one play, not two', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    await postWebhook(app, token, tautulliMoviePayload())
    await postWebhook(app, token, tautulliMoviePayload())

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('logs a second play for a genuine rewatch on the same source outside the retry window', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await postWebhook(app, token, tautulliMoviePayload())
    const movieRows = await db.select().from(plays).where(eq(plays.userId, userId))
    const movieId = movieRows[0]!.movieId!

    await db
      .update(plays)
      .set({ watchedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(plays.movieId, movieId))

    const res = await postWebhook(app, token, tautulliMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(2)
    expect(history.every((p) => p.source === 'tautulli')).toBe(true)
  })

  it('does not create two plays when the same event is delivered twice concurrently', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const [resA, resB] = await Promise.all([
      postWebhook(app, token, tautulliMoviePayload()),
      postWebhook(app, token, tautulliMoviePayload()),
    ])
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it("200s as a no-op for an action other than 'watched'", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const res = await postWebhook(app, token, tautulliMoviePayload({ action: 'stop' }))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it("200s as a no-op for Tautulli's own empty-body Test Webhook", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const res = await app.request(`/api/v1/webhooks/tautulli/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('400s on malformed JSON', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app, 'tautulli', '1', 'james')

    const res = await app.request(`/api/v1/webhooks/tautulli/${token}`, {
      method: 'POST',
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /webhooks/tautulli/:token — multi-user attribution', () => {
  beforeEach(() => resetDb(db))

  const MANAGED_ACCOUNT = { user_id: '2', user: 'kid-profile', username: 'kid-profile' }

  it('creates an unlinked link and a pending event, logging nothing, for an account seen for the first time', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, tautulliMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.source).toBe('tautulli')
    expect(link?.externalAccountId).toBe('2')
    expect(link?.externalAccountName).toBe('kid-profile')
    expect(link?.externalServerId).toBe('server-a')
    expect(link?.userId).toBeNull()

    const [pending] = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending?.source).toBe('tautulli')
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

    await postWebhook(app, token, tautulliMoviePayload(MANAGED_ACCOUNT))
    await db
      .update(webhookAccountLinks)
      .set({ userId: managedUserId })
      .where(eq(webhookAccountLinks.tokenId, tokenId))

    const res = await postWebhook(app, token, tautulliMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select({ userId: plays.userId }).from(plays)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(managedUserId)
  })
})

// Every request below sets Content-Type: application/json even though it
// sends no body — hono/csrf treats a bodyless POST with no Content-Type
// as text/plain (form-encodable) by default, and these calls go straight
// to the raw app (not testApp()'s wrapper, which injects
// Sec-Fetch-Site: same-origin instead) — see tokens.test.ts's own
// identical comment for the full explanation.
describe('linking a Tautulli account — same-server conflict with an existing Plex link', () => {
  beforeEach(() => resetDb(db))

  it('refuses to self-link a Tautulli account for the same server an already-linked Plex account is on', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, tokenId } = await createTokenAndCookie(app)
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await db.insert(webhookAccountLinks).values({
      tokenId,
      source: 'plex',
      externalAccountId: '1',
      externalAccountName: 'james',
      externalServerId: 'server-a',
      userId,
    })
    const [tautulliLink] = await db
      .insert(webhookAccountLinks)
      .values({
        tokenId,
        source: 'tautulli',
        externalAccountId: '1',
        externalAccountName: 'james',
        externalServerId: 'server-a',
      })
      .returning()

    const res = await app.request(
      `/api/v1/tokens/${tokenId}/webhook-links/${tautulliLink!.id}/link`,
      { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } },
    )
    expect(res.status).toBe(409)

    const [reloaded] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.id, tautulliLink!.id))
    expect(reloaded?.userId).toBeNull()
  })

  it('allows linking a Tautulli account for a genuinely different server', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, tokenId } = await createTokenAndCookie(app)
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await db.insert(webhookAccountLinks).values({
      tokenId,
      source: 'plex',
      externalAccountId: '1',
      externalAccountName: 'james',
      externalServerId: 'server-a',
      userId,
    })
    const [tautulliLink] = await db
      .insert(webhookAccountLinks)
      .values({
        tokenId,
        source: 'tautulli',
        externalAccountId: '1',
        externalAccountName: 'james',
        externalServerId: 'server-b',
      })
      .returning()

    const res = await app.request(
      `/api/v1/tokens/${tokenId}/webhook-links/${tautulliLink!.id}/link`,
      { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } },
    )
    expect(res.status).toBe(200)
  })

  it('allows linking when either side has not yet reported a server id', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, tokenId } = await createTokenAndCookie(app)
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    await db.insert(webhookAccountLinks).values({
      tokenId,
      source: 'plex',
      externalAccountId: '1',
      externalAccountName: 'james',
      externalServerId: null,
      userId,
    })
    const [tautulliLink] = await db
      .insert(webhookAccountLinks)
      .values({
        tokenId,
        source: 'tautulli',
        externalAccountId: '1',
        externalAccountName: 'james',
        externalServerId: 'server-a',
      })
      .returning()

    const res = await app.request(
      `/api/v1/tokens/${tokenId}/webhook-links/${tautulliLink!.id}/link`,
      { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } },
    )
    expect(res.status).toBe(200)
  })
})
