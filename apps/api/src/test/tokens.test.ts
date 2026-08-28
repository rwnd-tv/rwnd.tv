import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { pendingWebhookEvents, plays, webhookAccountLinks } from '@rwnd/db'
import type { ApiToken, CreateApiTokenResponse, ListWebhookLinksResponse, User } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { createApp } from '../app.js'
import type { MetadataProvider } from '../providers/types.js'

const db = testDb()
const app = testApp()

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
          },
        ],
      }
    },
    async findByExternalId() {
      return null
    },
  }
}

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

async function loginAs(email: string, password: string) {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return extractCookie(res)!
}

async function createToken(cookie: string, name = 'Plex') {
  const res = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return json<CreateApiTokenResponse>(res)
}

describe('tokens', () => {
  beforeEach(() => resetDb(db))

  it('requires authentication', async () => {
    expect((await app.request('/api/v1/tokens')).status).toBe(401)
    expect((await app.request('/api/v1/tokens', { method: 'POST' })).status).toBe(401)
  })

  it('creates, lists, and revokes a token', async () => {
    const cookie = await createUserAndCookie()
    const created = await createToken(cookie)
    expect(created.token).toMatch(/^rwnd_/)

    const listRes = await app.request('/api/v1/tokens', { headers: { cookie } })
    const { tokens } = await json<{ tokens: ApiToken[] }>(listRes)
    expect(tokens.map((t) => t.id)).toEqual([created.id])

    const deleteRes = await app.request(`/api/v1/tokens/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(deleteRes.status).toBe(204)

    const afterRes = await app.request('/api/v1/tokens', { headers: { cookie } })
    expect((await json<{ tokens: ApiToken[] }>(afterRes)).tokens).toHaveLength(0)
  })

  it("does not let a user revoke another user's token", async () => {
    const cookieA = await createUserAndCookie('owner@example.com')
    const created = await createToken(cookieA)

    await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
    const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')

    const res = await app.request(`/api/v1/tokens/${created.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    })
    expect(res.status).toBe(404)
  })

  describe('GET /tokens/{id}/webhook-links', () => {
    it('returns an empty list plus every instance user as assignable', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const secondUserId = await createLocalUser(
        db,
        'second@example.com',
        'correct-horse-battery-staple',
      )
      const created = await createToken(cookie)

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<ListWebhookLinksResponse>(res)
      expect(body.links).toEqual([])
      expect(body.assignableUsers.map((u) => u.id).sort()).toEqual([userId, secondUserId].sort())
    })

    it("404s for a token that isn't the caller's own", async () => {
      const cookieA = await createUserAndCookie('owner@example.com')
      const created = await createToken(cookieA)
      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links`, {
        headers: { cookie: cookieB },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /tokens/{id}/webhook-links/{linkId}', () => {
    async function seedLink(tokenId: string) {
      const [link] = await db
        .insert(webhookAccountLinks)
        .values({
          tokenId,
          source: 'plex',
          externalAccountId: '2',
          externalAccountName: 'kid-profile',
        })
        .returning()
      if (!link) throw new Error('failed to insert link')
      return link
    }

    it('claims an unclaimed link', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      const managedUserId = await createLocalUser(
        db,
        'managed@example.com',
        'correct-horse-battery-staple',
      )

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: managedUserId }),
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, link.id))
      expect(updated?.userId).toBe(managedUserId)
    })

    it('clears a claim back to unclaimed with userId: null', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, link.id))

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: null }),
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, link.id))
      expect(updated?.userId).toBeNull()
    })

    it('replays pending events as real plays once claimed, then clears them', async () => {
      const customApp = createApp({ db, metadataProviders: [fakeTmdb()] })
      const cookie = extractCookie(
        await customApp.request('/api/v1/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'owner@example.com',
            password: 'correct-horse-battery-staple',
            displayName: 'W',
          }),
        }),
      )!
      const createdRes = await customApp.request('/api/v1/tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Plex' }),
      })
      const created = await json<CreateApiTokenResponse>(createdRes)
      const link = await seedLink(created.id)
      const managedUserId = await createLocalUser(
        db,
        'managed@example.com',
        'correct-horse-battery-staple',
      )

      const movieWatchedAt = new Date('2026-01-01T12:00:00.000Z')
      const episodeWatchedAt = new Date('2026-01-02T12:00:00.000Z')
      await db.insert(pendingWebhookEvents).values([
        {
          tokenId: created.id,
          source: 'plex',
          externalAccountId: '2',
          watchedAt: movieWatchedAt,
          event: { ids: { tmdb: '603' }, ratingKey: '5001', media: { type: 'movie' } },
        },
        {
          tokenId: created.id,
          source: 'plex',
          externalAccountId: '2',
          watchedAt: episodeWatchedAt,
          event: {
            ids: { tmdb: '1396' },
            ratingKey: '5002',
            media: {
              type: 'episode',
              showTitle: 'Breaking Bad',
              seasonNumber: 1,
              episodeNumber: 1,
            },
          },
        },
      ])

      const res = await customApp.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: managedUserId }),
      })
      expect(res.status).toBe(200)

      const loggedPlays = await db
        .select({ userId: plays.userId, watchedAt: plays.watchedAt })
        .from(plays)
        .where(eq(plays.userId, managedUserId))
      expect(loggedPlays).toHaveLength(2)
      expect(loggedPlays.map((p) => p.watchedAt.toISOString()).sort()).toEqual(
        [movieWatchedAt.toISOString(), episodeWatchedAt.toISOString()].sort(),
      )

      const remainingPending = await db
        .select()
        .from(pendingWebhookEvents)
        .where(eq(pendingWebhookEvents.tokenId, created.id))
      expect(remainingPending).toHaveLength(0)
    })

    it('replays every pending event even when one of them fails unexpectedly, and still clears all of them', async () => {
      const customApp = createApp({ db, metadataProviders: [fakeTmdb()] })
      const cookie = extractCookie(
        await customApp.request('/api/v1/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'owner2@example.com',
            password: 'correct-horse-battery-staple',
            displayName: 'W',
          }),
        }),
      )!
      const createdRes = await customApp.request('/api/v1/tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Plex' }),
      })
      const created = await json<CreateApiTokenResponse>(createdRes)
      const link = await seedLink(created.id)
      const managedUserId = await createLocalUser(
        db,
        'managed2@example.com',
        'correct-horse-battery-staple',
      )

      const goodWatchedAt = new Date('2026-01-01T12:00:00.000Z')
      const badWatchedAt = new Date('2026-01-02T12:00:00.000Z')
      await db.insert(pendingWebhookEvents).values([
        // Ordered so the failing event isn't last — a regression test for
        // this specifically has to prove a later event still runs, not
        // just that the batch as a whole doesn't crash.
        {
          tokenId: created.id,
          source: 'plex',
          externalAccountId: '2',
          watchedAt: badWatchedAt,
          // fakeTmdb's getMovie throws on any id other than '603' — this
          // simulates a genuine unexpected provider failure (a real bug, a
          // transient network error), not the ordinary "no configured
          // provider recognizes this title" case, which logWebhookPlay
          // already handles by returning normally rather than throwing.
          event: { ids: { tmdb: '999999' }, ratingKey: '5003', media: { type: 'movie' } },
        },
        {
          tokenId: created.id,
          source: 'plex',
          externalAccountId: '2',
          watchedAt: goodWatchedAt,
          event: { ids: { tmdb: '603' }, ratingKey: '5001', media: { type: 'movie' } },
        },
      ])

      const res = await customApp.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: managedUserId }),
      })
      expect(res.status).toBe(200)

      const loggedPlays = await db
        .select({ watchedAt: plays.watchedAt })
        .from(plays)
        .where(eq(plays.userId, managedUserId))
      expect(loggedPlays).toHaveLength(1)
      expect(loggedPlays[0]?.watchedAt.toISOString()).toBe(goodWatchedAt.toISOString())

      const remainingPending = await db
        .select()
        .from(pendingWebhookEvents)
        .where(eq(pendingWebhookEvents.tokenId, created.id))
      expect(remainingPending).toHaveLength(0)
    })

    it('rejects assigning to a user id that does not exist', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000000' }),
      })
      expect(res.status).toBe(400)
    })

    it("404s for a link that belongs to another user's token", async () => {
      const cookieA = await createUserAndCookie('owner@example.com')
      const createdA = await createToken(cookieA)
      const link = await seedLink(createdA.id)

      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')
      const createdB = await createToken(cookieB, 'Other token')

      const res = await app.request(`/api/v1/tokens/${createdB.id}/webhook-links/${link.id}`, {
        method: 'PATCH',
        headers: { cookie: cookieB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: null }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /tokens/{id}/webhook-links/{linkId}', () => {
    it('removes a link', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const [link] = await db
        .insert(webhookAccountLinks)
        .values({
          tokenId: created.id,
          source: 'plex',
          externalAccountId: '2',
          externalAccountName: 'kid-profile',
        })
        .returning()
      if (!link) throw new Error('failed to insert link')

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(res.status).toBe(204)

      const rows = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, link.id))
      expect(rows).toHaveLength(0)
    })
  })
})
