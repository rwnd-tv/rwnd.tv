import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { sessions } from '@rwnd/db'
import { revokeAllSessions, revokeOtherSessions } from '../lib/session.js'
import { extractCookie, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndLogin(email: string, password: string): Promise<string> {
  const created = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Test User' }),
  })
  return extractCookie(created)!
}

async function login(email: string, password: string): Promise<Response> {
  return app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

describe('session cookie and lifecycle', () => {
  beforeEach(() => resetDb(db))

  it('sets HttpOnly, SameSite=Lax, Path=/, and a ~30-day expiry on the session cookie', async () => {
    const res = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Test User',
      }),
    })
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//i)
    // NODE_ENV is 'test' under vitest, so env.ts's COOKIE_SECURE default
    // (NODE_ENV === 'production') is false — no Secure attribute here.
    // This is a characterization test of the current default, not an
    // endorsement — see docs/TODO.md / the security review's findings
    // register for COOKIE_SECURE's production-default gap.
    expect(setCookie).not.toMatch(/Secure/i)

    const expiresMatch = /Expires=([^;]+)/i.exec(setCookie)
    expect(expiresMatch).toBeTruthy()
    const expiresAt = new Date(expiresMatch![1]!).getTime()
    const expectedMs = 30 * 24 * 60 * 60 * 1000
    // Generous tolerance — just confirming this is a ~30-day cookie, not
    // asserting an exact timestamp against a slow CI runner.
    expect(expiresAt - Date.now()).toBeGreaterThan(expectedMs - 60_000)
    expect(expiresAt - Date.now()).toBeLessThan(expectedMs + 60_000)
  })

  it('rejects a session past its expiry and lazily deletes the row', async () => {
    const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')

    const before = await app.request('/api/v1/auth/me', { headers: { cookie } })
    expect(before.status).toBe(200)

    const rowsBefore = await db.select().from(sessions)
    expect(rowsBefore).toHaveLength(1)
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, rowsBefore[0]!.id))

    const after = await app.request('/api/v1/auth/me', { headers: { cookie } })
    expect(after.status).toBe(401)

    // resolveSession() deletes an expired row the moment it's looked up.
    const rowsAfter = await db.select().from(sessions)
    expect(rowsAfter).toHaveLength(0)
  })

  it('revokeAllSessions (password reset) invalidates every session for the account', async () => {
    await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
    const first = await login('user@example.com', 'correct-horse-battery-staple')
    const second = await login('user@example.com', 'correct-horse-battery-staple')
    const cookieA = extractCookie(first)!
    const cookieB = extractCookie(second)!

    const [row] = await db.select().from(sessions).limit(1)
    await revokeAllSessions(db, row!.userId)

    const afterA = await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } })
    const afterB = await app.request('/api/v1/auth/me', { headers: { cookie: cookieB } })
    expect(afterA.status).toBe(401)
    expect(afterB.status).toBe(401)
  })

  it('revokeOtherSessions (password change) keeps the calling session alive', async () => {
    await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
    const first = await login('user@example.com', 'correct-horse-battery-staple')
    const second = await login('user@example.com', 'correct-horse-battery-staple')
    const cookieA = extractCookie(first)!
    const cookieB = extractCookie(second)!
    const tokenA = cookieA.split('=')[1]!

    const [row] = await db.select().from(sessions).limit(1)
    await revokeOtherSessions(db, row!.userId, tokenA)

    const afterA = await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } })
    const afterB = await app.request('/api/v1/auth/me', { headers: { cookie: cookieB } })
    expect(afterA.status).toBe(200)
    expect(afterB.status).toBe(401)
  })

  it('POST /auth/me/password actually revokes other sessions end to end', async () => {
    const cookieA = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
    const second = await login('user@example.com', 'correct-horse-battery-staple')
    const cookieB = extractCookie(second)!

    const change = await app.request('/api/v1/auth/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        currentPassword: 'correct-horse-battery-staple',
        newPassword: 'new-correct-horse-battery-staple',
      }),
    })
    expect(change.status).toBe(204)

    const afterA = await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } })
    const afterB = await app.request('/api/v1/auth/me', { headers: { cookie: cookieB } })
    expect(afterA.status).toBe(200)
    expect(afterB.status).toBe(401)
  })
})
