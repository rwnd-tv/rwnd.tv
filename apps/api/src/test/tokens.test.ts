import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { pendingWebhookEvents, plays, webhookAccountLinks, webhookLinkCodes } from '@rwnd/db'
import type {
  ApiToken,
  CreateApiTokenResponse,
  CreateWebhookLinkCodeResponse,
  ListWebhookLinksResponse,
  User,
  WebhookAccountLink,
} from '@rwnd/shared'
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
        imdbId: null,
        releaseDate: null,
        releaseDates: null,
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

/** Seeds one unlinked webhook account link directly, bypassing a real
 * webhook delivery — used by every link/link-code test below, which
 * only care about the link already existing, not how it got there
 * (`webhooks.test.ts` covers that). `externalAccountId` defaults to '2'
 * but must be overridden for a second link under the same token — it's
 * part of that table's own uniqueness constraint alongside tokenId/source. */
async function seedLink(tokenId: string, externalAccountId = '2') {
  const [link] = await db
    .insert(webhookAccountLinks)
    .values({
      tokenId,
      source: 'plex',
      externalAccountId,
      externalAccountName: 'kid-profile',
    })
    .returning()
  if (!link) throw new Error('failed to insert link')
  return link
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
    it('returns an empty list, with no assignableUsers field at all', async () => {
      const cookie = await createUserAndCookie()
      await createLocalUser(db, 'second@example.com', 'correct-horse-battery-staple')
      const created = await createToken(cookie)

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links`, {
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<ListWebhookLinksResponse>(res)
      expect(body.links).toEqual([])
      // Regression guard for the consent rework (docs/adr/0007-security-posture.md's
      // addendum) — this response used to hand back every instance user's
      // id and display name here, letting any token owner enumerate the
      // whole instance. It must not come back.
      expect(body).not.toHaveProperty('assignableUsers')
    })

    it('includes the linked user’s display name once a link is linked', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      const managedUserId = await createLocalUser(
        db,
        'managed@example.com',
        'correct-horse-battery-staple',
      )
      await db
        .update(webhookAccountLinks)
        .set({ userId: managedUserId })
        .where(eq(webhookAccountLinks.id, link.id))

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links`, {
        headers: { cookie },
      })
      const body = await json<ListWebhookLinksResponse>(res)
      expect(body.links[0]?.userId).toBe(managedUserId)
      expect(body.links[0]?.userDisplayName).toBe('managed@example.com')
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

    it('marks an unlinked link callerCanLinkAsSelf, and false once the caller has linked a different one', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      const before = await json<ListWebhookLinksResponse>(
        await app.request(`/api/v1/tokens/${created.id}/webhook-links`, { headers: { cookie } }),
      )
      expect(before.links[0]?.callerCanLinkAsSelf).toBe(true)

      // A second unlinked link, linked by the caller — under the same
      // token, but the 1-to-1 rule is source-wide, not per-token.
      const otherLink = await seedLink(created.id, '3')
      const userId = await meId(cookie)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, otherLink.id))

      const after = await json<ListWebhookLinksResponse>(
        await app.request(`/api/v1/tokens/${created.id}/webhook-links`, { headers: { cookie } }),
      )
      const stillUnlinked = after.links.find((l) => l.id === link.id)
      expect(stillUnlinked?.callerCanLinkAsSelf).toBe(false)
    })

    it('orders links alphabetically by name, case-insensitively, stable across a link/unlink update', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)

      // Inserted in an order that's neither alphabetical nor firstSeenAt
      // order, so the assertions below can't pass by coincidence — an
      // earlier version of this sort used firstSeenAt (found arbitrary,
      // James asked for alphabetical instead), and before either, no
      // explicit ORDER BY at all let an UPDATE (link/unlink is just an
      // UPDATE) shuffle a row's position in the result (found
      // 2026-09-02: James saw one account jump between the middle and
      // the bottom of the list depending on whether it was linked).
      // Mixed casing (BOB/alice/Charlie) is deliberate too: this
      // instance's database collation (en_US.utf8) sorts plain text
      // byte-wise within that locale's rules, which groups every
      // capitalized name ahead of every lowercase one — found
      // 2026-09-02, James saw "Carol", "Test", "jamesbulman" (both
      // capitals first) — so a case-*sensitive* sort would produce
      // ['BOB', 'Charlie', 'alice'] here, not the alphabetical order
      // asserted below.
      const [bob] = await db
        .insert(webhookAccountLinks)
        .values([
          {
            tokenId: created.id,
            source: 'plex',
            externalAccountId: '3',
            externalAccountName: 'BOB',
            firstSeenAt: new Date('2026-01-03T00:00:00.000Z'),
          },
          {
            tokenId: created.id,
            source: 'plex',
            externalAccountId: '1',
            externalAccountName: 'Charlie',
            firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            tokenId: created.id,
            source: 'plex',
            externalAccountId: '2',
            externalAccountName: 'alice',
            firstSeenAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ])
        .returning()

      async function names() {
        const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links`, {
          headers: { cookie },
        })
        const body = await json<ListWebhookLinksResponse>(res)
        return body.links.map((l) => l.externalAccountName)
      }

      expect(await names()).toEqual(['alice', 'BOB', 'Charlie'])

      // Link then unlink BOB — an UPDATE against that row — and confirm
      // the order hasn't moved.
      const linkRes = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${bob!.id}/link`,
        {
          method: 'POST',
          headers: { cookie },
        },
      )
      expect(linkRes.status).toBe(200)
      expect(await names()).toEqual(['alice', 'BOB', 'Charlie'])

      const unlinkRes = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${bob!.id}/unlink`,
        { method: 'POST', headers: { cookie } },
      )
      expect(unlinkRes.status).toBe(200)
      expect(await names()).toEqual(['alice', 'BOB', 'Charlie'])
    })
  })

  describe('POST /tokens/{id}/webhook-links/{linkId}/link', () => {
    it('links an unlinked link to the caller themselves', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}/link`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<WebhookAccountLink>(res)
      expect(body.userId).toBe(userId)
      expect(body.userDisplayName).toBe('W')

      const [updated] = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, link.id))
      expect(updated?.userId).toBe(userId)
    })

    it('replays pending events as real plays once linked, then clears them', async () => {
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
      const ownerId = await meId(cookie)
      const createdRes = await customApp.request('/api/v1/tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Plex' }),
      })
      const created = await json<CreateApiTokenResponse>(createdRes)
      const link = await seedLink(created.id)

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

      const res = await customApp.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/link`,
        // Content-Type: application/json, even with no body — hono/csrf
        // treats a bodyless POST with no Content-Type as text/plain
        // (form-encodable) by default, and this call goes straight to the
        // raw customApp (not testApp()'s wrapper, which injects
        // Sec-Fetch-Site: same-origin instead) — see helpers.ts's
        // testApp() doc comment for the full explanation.
        { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } },
      )
      expect(res.status).toBe(200)

      const loggedPlays = await db
        .select({ userId: plays.userId, watchedAt: plays.watchedAt })
        .from(plays)
        .where(eq(plays.userId, ownerId))
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
      const ownerId = await meId(cookie)
      const createdRes = await customApp.request('/api/v1/tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Plex' }),
      })
      const created = await json<CreateApiTokenResponse>(createdRes)
      const link = await seedLink(created.id)

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

      const res = await customApp.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/link`,
        // Content-Type: application/json, even with no body — hono/csrf
        // treats a bodyless POST with no Content-Type as text/plain
        // (form-encodable) by default, and this call goes straight to the
        // raw customApp (not testApp()'s wrapper, which injects
        // Sec-Fetch-Site: same-origin instead) — see helpers.ts's
        // testApp() doc comment for the full explanation.
        { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } },
      )
      expect(res.status).toBe(200)

      const loggedPlays = await db
        .select({ watchedAt: plays.watchedAt })
        .from(plays)
        .where(eq(plays.userId, ownerId))
      expect(loggedPlays).toHaveLength(1)
      expect(loggedPlays[0]?.watchedAt.toISOString()).toBe(goodWatchedAt.toISOString())

      const remainingPending = await db
        .select()
        .from(pendingWebhookEvents)
        .where(eq(pendingWebhookEvents.tokenId, created.id))
      expect(remainingPending).toHaveLength(0)
    })

    it('409s on a link that is already linked', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, link.id))

      const res = await app.request(`/api/v1/tokens/${created.id}/webhook-links/${link.id}/link`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(409)
    })

    it('409s self-linking a second Plex account, even under a different token', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const firstToken = await createToken(cookie, 'First token')
      const firstLink = await seedLink(firstToken.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, firstLink.id))

      const secondToken = await createToken(cookie, 'Second token')
      const secondLink = await seedLink(secondToken.id)

      const res = await app.request(
        `/api/v1/tokens/${secondToken.id}/webhook-links/${secondLink.id}/link`,
        { method: 'POST', headers: { cookie } },
      )
      expect(res.status).toBe(409)

      const [unchanged] = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, secondLink.id))
      expect(unchanged?.userId).toBeNull()
    })

    it("404s for a link that belongs to another user's token", async () => {
      const cookieA = await createUserAndCookie('owner@example.com')
      const createdA = await createToken(cookieA)
      const link = await seedLink(createdA.id)

      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')
      const createdB = await createToken(cookieB, 'Other token')

      const res = await app.request(`/api/v1/tokens/${createdB.id}/webhook-links/${link.id}/link`, {
        method: 'POST',
        headers: { cookie: cookieB },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /tokens/{id}/webhook-links/{linkId}/link-code', () => {
    it('generates a one-time code for someone else to link', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      const res = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/link-code`,
        {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      expect(res.status).toBe(201)
      const body = await json<CreateWebhookLinkCodeResponse>(res)
      expect(body.code).toBeTruthy()
      expect(body.emailSent).toBe(false)
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

      const codes = await db
        .select()
        .from(webhookLinkCodes)
        .where(eq(webhookLinkCodes.linkId, link.id))
      expect(codes).toHaveLength(1)
      expect(codes[0]?.usedBy).toBeNull()
    })

    it('generating a new code supersedes the prior unused one', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      async function generate() {
        const res = await app.request(
          `/api/v1/tokens/${created.id}/webhook-links/${link.id}/link-code`,
          {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        )
        return json<CreateWebhookLinkCodeResponse>(res)
      }

      const first = await generate()
      const second = await generate()
      expect(first.code).not.toBe(second.code)

      const codes = await db
        .select()
        .from(webhookLinkCodes)
        .where(and(eq(webhookLinkCodes.linkId, link.id), isNull(webhookLinkCodes.usedBy)))
      // Only the second code's row should still be live — the first was
      // deleted outright, not just marked used, when the second was made.
      expect(codes).toHaveLength(1)
    })

    it('409s on a link that is already linked', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, link.id))

      const res = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/link-code`,
        {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      expect(res.status).toBe(409)
    })

    it("404s for a link that belongs to another user's token", async () => {
      const cookieA = await createUserAndCookie('owner@example.com')
      const createdA = await createToken(cookieA)
      const link = await seedLink(createdA.id)

      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')
      const createdB = await createToken(cookieB, 'Other token')

      const res = await app.request(
        `/api/v1/tokens/${createdB.id}/webhook-links/${link.id}/link-code`,
        {
          method: 'POST',
          headers: { cookie: cookieB, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('POST /tokens/{id}/webhook-links/{linkId}/unlink', () => {
    it('clears the link back to unlinked, keeping the row', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, link.id))

      const res = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/unlink`,
        { method: 'POST', headers: { cookie } },
      )
      expect(res.status).toBe(200)
      const body = await json<WebhookAccountLink>(res)
      expect(body.userId).toBeNull()
      expect(body.callerCanLinkAsSelf).toBe(true)

      const [row] = await db
        .select()
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.id, link.id))
      expect(row).toBeDefined()
      expect(row?.userId).toBeNull()
    })

    it('409s on a link that is not linked', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

      const res = await app.request(
        `/api/v1/tokens/${created.id}/webhook-links/${link.id}/unlink`,
        { method: 'POST', headers: { cookie } },
      )
      expect(res.status).toBe(409)
    })

    it("404s for a link that belongs to another user's token", async () => {
      const cookieA = await createUserAndCookie('owner@example.com')
      const createdA = await createToken(cookieA)
      const link = await seedLink(createdA.id)
      const ownerId = await meId(cookieA)
      await db
        .update(webhookAccountLinks)
        .set({ userId: ownerId })
        .where(eq(webhookAccountLinks.id, link.id))

      await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
      const cookieB = await loginAs('other@example.com', 'correct-horse-battery-staple')
      const createdB = await createToken(cookieB, 'Other token')

      const res = await app.request(
        `/api/v1/tokens/${createdB.id}/webhook-links/${link.id}/unlink`,
        { method: 'POST', headers: { cookie: cookieB } },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /tokens/{id}/webhook-links/{linkId}', () => {
    it('removes an unlinked link', async () => {
      const cookie = await createUserAndCookie()
      const created = await createToken(cookie)
      const link = await seedLink(created.id)

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

    it('removes a linked account too', async () => {
      const cookie = await createUserAndCookie()
      const userId = await meId(cookie)
      const created = await createToken(cookie)
      const link = await seedLink(created.id)
      await db
        .update(webhookAccountLinks)
        .set({ userId })
        .where(eq(webhookAccountLinks.id, link.id))

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
