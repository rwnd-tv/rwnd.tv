import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { plays, webhookAccountLinks, webhookLinkCodes, pendingWebhookEvents } from '@rwnd/db'
import type {
  CreateApiTokenResponse,
  CreateWebhookLinkCodeResponse,
  User,
  WebhookAccountLink,
} from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { createApp } from '../app.js'
import { hashSecret, generateSecret } from '../lib/tokens.js'
import type { MetadataProvider } from '../providers/types.js'

const db = testDb()
const app = testApp()

/** `testApp()`'s wrapper and a raw `createApp()` instance both satisfy
 * this — every helper below only ever needs `.request()`, and this way
 * the same helpers work against either the shared module-level `app` or
 * a one-off `createApp({ db, metadataProviders })` for the replay test,
 * which needs its own provider stub. */
type RequestableApp = {
  request: (input: string | Request, init?: RequestInit) => Response | Promise<Response>
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
        releaseDate: null,
        releaseDates: null,
      }
    },
    async getShow() {
      throw new Error('Not used — this file only exercises the movie path')
    },
    async getEpisode() {
      throw new Error('Not used — this file only exercises the movie path')
    },
    async getSeason() {
      throw new Error('Not used — this file only exercises the movie path')
    },
    async findByExternalId() {
      return null
    },
  }
}

async function setupAndCookie(customApp: RequestableApp, email: string) {
  const res = await customApp.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

async function createUserAndCookie(email = 'owner@example.com') {
  return setupAndCookie(app, email)
}

async function loginAs(email: string, password: string) {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return extractCookie(res)!
}

async function meId(customApp: RequestableApp, cookie: string) {
  const res = await customApp.request('/api/v1/auth/me', { headers: { cookie } })
  return (await json<User>(res)).id
}

async function createToken(customApp: RequestableApp, cookie: string) {
  const res = await customApp.request('/api/v1/tokens', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Plex' }),
  })
  return json<CreateApiTokenResponse>(res)
}

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

/** Generates a real link code through the actual route (`ownerCookie`
 * must belong to the token's own creator), returning the plaintext code
 * alongside the link it targets. */
async function generateCode(
  customApp: RequestableApp,
  ownerCookie: string,
  tokenId: string,
  linkId: string,
) {
  const res = await customApp.request(
    `/api/v1/tokens/${tokenId}/webhook-links/${linkId}/link-code`,
    {
      method: 'POST',
      headers: { cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  return json<CreateWebhookLinkCodeResponse>(res)
}

describe('POST /webhook-links/redeem', () => {
  beforeEach(() => resetDb(db))

  it('links the account to the redeemer and marks the code used', async () => {
    const ownerCookie = await createUserAndCookie('owner@example.com')
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, link.id)

    const redeemerId = await createLocalUser(
      db,
      'redeemer@example.com',
      'correct-horse-battery-staple',
    )
    const redeemerCookie = await loginAs('redeemer@example.com', 'correct-horse-battery-staple')

    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(200)
    const body = await json<WebhookAccountLink>(res)
    expect(body.userId).toBe(redeemerId)
    expect(body.userDisplayName).toBe('redeemer@example.com')

    const [updatedLink] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.id, link.id))
    expect(updatedLink?.userId).toBe(redeemerId)

    const [usedCode] = await db
      .select()
      .from(webhookLinkCodes)
      .where(eq(webhookLinkCodes.codeHash, hashSecret(code)))
    expect(usedCode?.usedBy).toBe(redeemerId)
  })

  it('replays the pending watch into the redeemer’s own history, not the token owner’s', async () => {
    const customApp = createApp({ db, metadataProviders: [fakeTmdb()] })
    const ownerCookie = await setupAndCookie(customApp, 'owner2@example.com')
    const ownerId = await meId(customApp, ownerCookie)
    const token = await createToken(customApp, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(customApp, ownerCookie, token.id, link.id)

    const watchedAt = new Date('2026-01-01T12:00:00.000Z')
    await db.insert(pendingWebhookEvents).values({
      tokenId: token.id,
      source: 'plex',
      externalAccountId: '2',
      watchedAt,
      event: { ids: { tmdb: '603' }, ratingKey: '5001', media: { type: 'movie' } },
    })

    const redeemerId = await createLocalUser(
      db,
      'redeemer2@example.com',
      'correct-horse-battery-staple',
    )
    const redeemerCookie = extractCookie(
      await customApp.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'redeemer2@example.com',
          password: 'correct-horse-battery-staple',
        }),
      }),
    )!

    const res = await customApp.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(200)

    const redeemerPlays = await db
      .select({ watchedAt: plays.watchedAt })
      .from(plays)
      .where(eq(plays.userId, redeemerId))
    expect(redeemerPlays).toHaveLength(1)
    expect(redeemerPlays[0]?.watchedAt.toISOString()).toBe(watchedAt.toISOString())

    const ownerPlays = await db.select().from(plays).where(eq(plays.userId, ownerId))
    expect(ownerPlays).toHaveLength(0)

    const remainingPending = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, token.id))
    expect(remainingPending).toHaveLength(0)
  })

  it('400s on an unknown code', async () => {
    const cookie = await createUserAndCookie()
    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'not-a-real-code' }),
    })
    expect(res.status).toBe(400)
  })

  it('400s on an expired code', async () => {
    const ownerCookie = await createUserAndCookie('owner3@example.com')
    const ownerId = await meId(app, ownerCookie)
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const code = generateSecret(9)
    await db.insert(webhookLinkCodes).values({
      linkId: link.id,
      codeHash: hashSecret(code),
      createdBy: ownerId,
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(400)
  })

  it('cannot be redeemed a second time', async () => {
    const ownerCookie = await createUserAndCookie('owner4@example.com')
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, link.id)

    await createLocalUser(db, 'redeemer4@example.com', 'correct-horse-battery-staple')
    const redeemerCookie = await loginAs('redeemer4@example.com', 'correct-horse-battery-staple')
    const first = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(first.status).toBe(200)

    await createLocalUser(db, 'second-redeemer4@example.com', 'correct-horse-battery-staple')
    const secondCookie = await loginAs(
      'second-redeemer4@example.com',
      'correct-horse-battery-staple',
    )
    const second = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: secondCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(second.status).toBe(400)
  })

  it('409s when the link was linked by someone else between code generation and redemption', async () => {
    const ownerCookie = await createUserAndCookie('owner5@example.com')
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, link.id)

    // Simulates the owner linking it themselves ("This is me") after
    // handing the code out but before it's redeemed.
    await db
      .update(webhookAccountLinks)
      .set({ userId: await meId(app, ownerCookie) })
      .where(eq(webhookAccountLinks.id, link.id))

    await createLocalUser(db, 'redeemer5@example.com', 'correct-horse-battery-staple')
    const redeemerCookie = await loginAs('redeemer5@example.com', 'correct-horse-battery-staple')
    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(409)
  })

  it('409s redeeming a code when the redeemer already has a linked account for this source', async () => {
    const ownerCookie = await createUserAndCookie('owner6@example.com')
    const token = await createToken(app, ownerCookie)
    const firstLink = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, firstLink.id)

    // The redeemer already has a different Plex account linked, under a
    // token of their own.
    await createLocalUser(db, 'redeemer6@example.com', 'correct-horse-battery-staple')
    const redeemerCookie = await loginAs('redeemer6@example.com', 'correct-horse-battery-staple')
    const redeemerToken = await createToken(app, redeemerCookie)
    const redeemerOwnLink = await seedLink(redeemerToken.id)
    await app.request(
      `/api/v1/tokens/${redeemerToken.id}/webhook-links/${redeemerOwnLink.id}/link`,
      { method: 'POST', headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' } },
    )

    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(409)

    const [unchanged] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.id, firstLink.id))
    expect(unchanged?.userId).toBeNull()
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'whatever' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /webhook-links/mine', () => {
  beforeEach(() => resetDb(db))

  it('lists only the caller’s own linked accounts, across tokens they don’t own', async () => {
    const ownerCookie = await createUserAndCookie('owner7@example.com')
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, link.id)

    const redeemerId = await createLocalUser(
      db,
      'redeemer7@example.com',
      'correct-horse-battery-staple',
    )
    const redeemerCookie = await loginAs('redeemer7@example.com', 'correct-horse-battery-staple')
    await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    const res = await app.request('/api/v1/webhook-links/mine', {
      headers: { cookie: redeemerCookie },
    })
    expect(res.status).toBe(200)
    const body = await json<{ links: WebhookAccountLink[] }>(res)
    expect(body.links).toHaveLength(1)
    expect(body.links[0]?.id).toBe(link.id)
    expect(body.links[0]?.userId).toBe(redeemerId)

    // The token owner's own GET (a different route) sees it too, but this
    // route is scoped by who linked it, not token ownership — the owner
    // has no linked accounts of their own here.
    const ownerRes = await app.request('/api/v1/webhook-links/mine', {
      headers: { cookie: ownerCookie },
    })
    const ownerBody = await json<{ links: WebhookAccountLink[] }>(ownerRes)
    expect(ownerBody.links).toHaveLength(0)
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/webhook-links/mine')
    expect(res.status).toBe(401)
  })
})

describe('POST /webhook-links/mine/{linkId}/unlink', () => {
  beforeEach(() => resetDb(db))

  it('clears the link, keeping the row, and lets it be re-linked afterward', async () => {
    const ownerCookie = await createUserAndCookie('owner8@example.com')
    const token = await createToken(app, ownerCookie)
    const link = await seedLink(token.id)
    const { code } = await generateCode(app, ownerCookie, token.id, link.id)

    await createLocalUser(db, 'redeemer8@example.com', 'correct-horse-battery-staple')
    const redeemerCookie = await loginAs('redeemer8@example.com', 'correct-horse-battery-staple')
    await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    const res = await app.request(`/api/v1/webhook-links/mine/${link.id}/unlink`, {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = await json<WebhookAccountLink>(res)
    expect(body.userId).toBeNull()

    const [row] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.id, link.id))
    expect(row).toBeDefined()
    expect(row?.userId).toBeNull()

    // Re-linkable afterward — same as the token-owner-side "Unlink".
    const secondCode = await generateCode(app, ownerCookie, token.id, link.id)
    const relink = await app.request('/api/v1/webhook-links/redeem', {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: secondCode.code }),
    })
    expect(relink.status).toBe(200)
  })

  it('404s on a link not linked to the caller (unlinked, linked to someone else, or unknown id)', async () => {
    const ownerCookie = await createUserAndCookie('owner9@example.com')
    const token = await createToken(app, ownerCookie)
    const unlinkedLink = await seedLink(token.id)

    await createLocalUser(db, 'redeemer9@example.com', 'correct-horse-battery-staple')
    const redeemerCookie = await loginAs('redeemer9@example.com', 'correct-horse-battery-staple')

    const unlinkedRes = await app.request(`/api/v1/webhook-links/mine/${unlinkedLink.id}/unlink`, {
      method: 'POST',
      headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' },
    })
    expect(unlinkedRes.status).toBe(404)

    // Linked, but to someone else (the token owner, via "This is me").
    await app.request(`/api/v1/tokens/${token.id}/webhook-links/${unlinkedLink.id}/link`, {
      method: 'POST',
      headers: { cookie: ownerCookie, 'Content-Type': 'application/json' },
    })
    const linkedToSomeoneElseRes = await app.request(
      `/api/v1/webhook-links/mine/${unlinkedLink.id}/unlink`,
      { method: 'POST', headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' } },
    )
    expect(linkedToSomeoneElseRes.status).toBe(404)

    const unknownRes = await app.request(
      `/api/v1/webhook-links/mine/00000000-0000-0000-0000-000000000000/unlink`,
      { method: 'POST', headers: { cookie: redeemerCookie, 'Content-Type': 'application/json' } },
    )
    expect(unknownRes.status).toBe(404)
  })

  it('requires authentication', async () => {
    const res = await app.request(
      `/api/v1/webhook-links/mine/00000000-0000-0000-0000-000000000000/unlink`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    )
    expect(res.status).toBe(401)
  })
})
