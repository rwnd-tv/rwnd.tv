import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { sessions } from '@rwnd/db'
import { revokeAllSessions, revokeOtherSessions } from '../lib/session.js'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

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
  afterEach(() => vi.unstubAllGlobals())

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

  it('rejects a breached new password on POST /auth/me/password (ASVS V2.1.7)', async () => {
    const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')

    const password = 'a-password-this-test-pretends-is-breached'
    const suffix = createHash('sha1').update(password).digest('hex').toUpperCase().slice(5)
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(`${suffix}:1`)))

    const res = await app.request('/api/v1/auth/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        currentPassword: 'correct-horse-battery-staple',
        newPassword: password,
      }),
    })
    expect(res.status).toBe(400)

    // Old password still works — nothing was actually changed.
    vi.unstubAllGlobals()
    const loginRes = await login('user@example.com', 'correct-horse-battery-staple')
    expect(loginRes.status).toBe(200)
  })

  describe('session list and revoke (M3 security review follow-up, F-24)', () => {
    it('lists every session for the account, newest first, marking which one is current', async () => {
      await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const second = await login('user@example.com', 'correct-horse-battery-staple')
      const cookieB = extractCookie(second)!

      const res = await app.request('/api/v1/auth/me/sessions', { headers: { cookie: cookieB } })
      expect(res.status).toBe(200)
      const body = await json<{ sessions: { id: string; current: boolean }[] }>(res)
      expect(body.sessions).toHaveLength(2)
      // Newest (the one making this request) first.
      expect(body.sessions[0]!.current).toBe(true)
      expect(body.sessions[1]!.current).toBe(false)
    })

    it('never returns another user’s sessions', async () => {
      // The setup-based createUserAndLogin only works once per instance —
      // a second user is created directly instead, same as other
      // multi-user tests in this suite (see createLocalUser's own doc
      // comment in helpers.ts).
      await createUserAndLogin('user-a@example.com', 'correct-horse-battery-staple')
      await createLocalUser(db, 'user-b@example.com', 'correct-horse-battery-staple')
      const cookieB = extractCookie(
        await login('user-b@example.com', 'correct-horse-battery-staple'),
      )!

      const res = await app.request('/api/v1/auth/me/sessions', { headers: { cookie: cookieB } })
      const body = await json<{ sessions: { id: string }[] }>(res)
      expect(body.sessions).toHaveLength(1)
    })

    it('revokes one session by id, without affecting the others', async () => {
      const cookieA = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const second = await login('user@example.com', 'correct-horse-battery-staple')
      const cookieB = extractCookie(second)!

      const list = await json<{ sessions: { id: string; current: boolean }[] }>(
        await app.request('/api/v1/auth/me/sessions', { headers: { cookie: cookieB } }),
      )
      const otherSessionId = list.sessions.find((s) => !s.current)!.id

      const del = await app.request(`/api/v1/auth/me/sessions/${otherSessionId}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      })
      expect(del.status).toBe(204)

      const afterA = await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } })
      const afterB = await app.request('/api/v1/auth/me', { headers: { cookie: cookieB } })
      expect(afterA.status).toBe(401) // the revoked session
      expect(afterB.status).toBe(200) // untouched
    })

    it('404s revoking a session id that belongs to a different user', async () => {
      const cookieA = await createUserAndLogin('user-a@example.com', 'correct-horse-battery-staple')
      await createLocalUser(db, 'user-b@example.com', 'correct-horse-battery-staple')
      const cookieB = extractCookie(
        await login('user-b@example.com', 'correct-horse-battery-staple'),
      )!
      const listA = await json<{ sessions: { id: string }[] }>(
        await app.request('/api/v1/auth/me/sessions', { headers: { cookie: cookieA } }),
      )

      const res = await app.request(`/api/v1/auth/me/sessions/${listA.sessions[0]!.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      })
      expect(res.status).toBe(404)

      // A's session is still there — B's attempt didn't touch it.
      const stillA = await app.request('/api/v1/auth/me', { headers: { cookie: cookieA } })
      expect(stillA.status).toBe(200)
    })

    it('404s revoking an id that never existed', async () => {
      const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const res = await app.request(
        '/api/v1/auth/me/sessions/00000000-0000-0000-0000-000000000000',
        { method: 'DELETE', headers: { cookie } },
      )
      expect(res.status).toBe(404)
    })

    it('allows revoking the current session — the next request with it then 401s', async () => {
      const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const list = await json<{ sessions: { id: string; current: boolean }[] }>(
        await app.request('/api/v1/auth/me/sessions', { headers: { cookie } }),
      )
      const currentId = list.sessions.find((s) => s.current)!.id

      const del = await app.request(`/api/v1/auth/me/sessions/${currentId}`, {
        method: 'DELETE',
        headers: { cookie },
      })
      expect(del.status).toBe(204)

      const after = await app.request('/api/v1/auth/me', { headers: { cookie } })
      expect(after.status).toBe(401)
    })

    it('bumps lastUsedAt on use, throttled rather than on every single request', async () => {
      const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const [row] = await db.select().from(sessions).limit(1)
      expect(row!.lastUsedAt).toBeNull()

      await db
        .update(sessions)
        .set({ lastUsedAt: new Date(Date.now() - 10 * 60 * 1000) })
        .where(eq(sessions.id, row!.id))

      await app.request('/api/v1/auth/me', { headers: { cookie } })

      const [updated] = await db.select().from(sessions).limit(1)
      expect(updated!.lastUsedAt).not.toBeNull()
      expect(updated!.lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 5000)
    })

    it('slides expiresAt forward on a throttled touch, and re-sends the cookie to match', async () => {
      const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      const [row] = await db.select().from(sessions).limit(1)

      // Simulate a session nearing its original expiry, last touched well
      // outside the throttle window — the shape a genuinely active but
      // infrequently-checking-in session would be in.
      const nearExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 days out
      await db
        .update(sessions)
        .set({ lastUsedAt: new Date(Date.now() - 10 * 60 * 1000), expiresAt: nearExpiry })
        .where(eq(sessions.id, row!.id))

      const res = await app.request('/api/v1/auth/me', { headers: { cookie } })
      expect(res.status).toBe(200)

      const [updated] = await db.select().from(sessions).limit(1)
      // Renewed to ~30 days out again, not left at the 2-day mark.
      const twentyNineDaysMs = 29 * 24 * 60 * 60 * 1000
      expect(updated!.expiresAt.getTime()).toBeGreaterThan(Date.now() + twentyNineDaysMs)

      // The cookie itself is re-sent with a matching new Expires — a
      // server-side-only extension would be moot once the browser drops
      // the original cookie at its un-renewed expiry.
      const setCookie = res.headers.get('set-cookie')!
      const expiresMatch = /Expires=([^;]+)/i.exec(setCookie)
      expect(expiresMatch).toBeTruthy()
      expect(new Date(expiresMatch![1]!).getTime()).toBeGreaterThan(Date.now() + twentyNineDaysMs)
    })

    it('does not re-send the cookie on a request inside the throttle window', async () => {
      const cookie = await createUserAndLogin('user@example.com', 'correct-horse-battery-staple')
      // The very next request is well inside the 60s throttle (lastUsedAt
      // is null → first touch always renews, so this asserts the *second*
      // request in quick succession, not the first).
      await app.request('/api/v1/auth/me', { headers: { cookie } })
      const res = await app.request('/api/v1/auth/me', { headers: { cookie } })
      expect(res.headers.get('set-cookie')).toBeNull()
    })
  })
})
