import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { invites } from '@rwnd/db'
import type { CreateInviteResponse, ListInvitesResponse } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createAdminAndCookie() {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Admin',
    }),
  })
  return extractCookie(res)!
}

async function createUserAndCookie(email: string) {
  await createLocalUser(db, email, 'correct-horse-battery-staple')
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  })
  return extractCookie(res)!
}

describe('/api/v1/invites (F-22, M3 security review follow-up)', () => {
  beforeEach(() => resetDb(db))

  it('POST creates an invite and returns the plaintext code once', async () => {
    const cookie = await createAdminAndCookie()
    const res = await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } })
    expect(res.status).toBe(201)
    const body = await json<CreateInviteResponse>(res)
    expect(body.code).toBeTruthy()
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
    // No email was given, so nothing should have been attempted.
    expect(body.emailSent).toBe(false)

    // Only the hash is ever stored — the plaintext code never lands in the DB.
    const [row] = await db.select().from(invites).where(eq(invites.id, body.id))
    expect(row!.codeHash).not.toBe(body.code)
  })

  it('POST accepts an optional email without failing invite creation regardless of delivery outcome', async () => {
    const cookie = await createAdminAndCookie()
    const res = await app.request('/api/v1/invites', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    expect(res.status).toBe(201)
    const body = await json<CreateInviteResponse>(res)
    expect(body.code).toBeTruthy()
    expect(typeof body.emailSent).toBe('boolean')
  })

  it('POST rejects a non-admin', async () => {
    const cookie = await createUserAndCookie('regular@example.com')
    const res = await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } })
    expect(res.status).toBe(403)
  })

  it('POST rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/invites', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('GET lists invites newest first, marking pending/used/expired status', async () => {
    const cookie = await createAdminAndCookie()

    const first = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } }),
    )
    const second = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } }),
    )

    // Simulate one already redeemed, one already expired — both still
    // listed, just with a different computed status. `usedBy` just needs
    // to point at a real user row (its FK), so the admin's own id (every
    // invite's `createdBy`) stands in for whoever actually redeemed it.
    const [invite] = await db.select().from(invites).where(eq(invites.id, first.id))
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, first.id))
    await db.update(invites).set({ usedBy: invite!.createdBy }).where(eq(invites.id, second.id))

    const res = await app.request('/api/v1/invites', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<ListInvitesResponse>(res)
    expect(body.invites).toHaveLength(2)
    // Newest first: `second` was created after `first`.
    expect(body.invites[0]).toMatchObject({ id: second.id, status: 'used' })
    expect(body.invites[1]).toMatchObject({ id: first.id, status: 'expired' })
  })

  it('GET shows a freshly created invite as pending', async () => {
    const cookie = await createAdminAndCookie()
    const created = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } }),
    )
    const body = await json<ListInvitesResponse>(
      await app.request('/api/v1/invites', { headers: { cookie } }),
    )
    expect(body.invites[0]).toMatchObject({ id: created.id, status: 'pending' })
  })

  it('GET rejects a non-admin', async () => {
    const cookie = await createUserAndCookie('regular@example.com')
    const res = await app.request('/api/v1/invites', { headers: { cookie } })
    expect(res.status).toBe(403)
  })

  it('DELETE revokes an invite', async () => {
    const cookie = await createAdminAndCookie()
    const created = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } }),
    )

    const res = await app.request(`/api/v1/invites/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(res.status).toBe(204)

    const rows = await db.select().from(invites).where(eq(invites.id, created.id))
    expect(rows).toHaveLength(0)
  })

  it('DELETE 404s an invite id that never existed', async () => {
    const cookie = await createAdminAndCookie()
    const res = await app.request('/api/v1/invites/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(res.status).toBe(404)
  })

  it('DELETE rejects a non-admin', async () => {
    const adminCookie = await createAdminAndCookie()
    const created = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie: adminCookie } }),
    )

    const cookie = await createUserAndCookie('regular@example.com')
    const res = await app.request(`/api/v1/invites/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(res.status).toBe(403)
  })

  it('a created invite code actually redeems at registration', async () => {
    const adminCookie = await createAdminAndCookie()
    await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ registrationMode: 'invite' }),
    })
    const created = await json<CreateInviteResponse>(
      await app.request('/api/v1/invites', { method: 'POST', headers: { cookie: adminCookie } }),
    )

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'New User',
        inviteCode: created.code,
      }),
    })
    expect(res.status).toBe(201)

    const [row] = await db.select().from(invites).where(eq(invites.id, created.id))
    expect(row!.usedBy).not.toBeNull()
  })
})
