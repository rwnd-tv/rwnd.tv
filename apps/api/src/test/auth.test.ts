import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { instanceSettings, invites, users } from '@rwnd/db'
import type { User } from '@rwnd/shared'
import { generateSecret, hashSecret } from '../lib/tokens.js'
import { extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUser(email: string, password: string) {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Test User' }),
  })
  return res
}

describe('auth', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await createUser('user@example.com', 'correct-horse-battery-staple')

    const wrong = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'wrong-password' }),
    })
    expect(wrong.status).toBe(401)

    const right = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'correct-horse-battery-staple' }),
    })
    expect(right.status).toBe(200)
    expect(right.headers.get('set-cookie')).toMatch(/rwnd_session=/)
  })

  describe('security-event logging (M3 security review)', () => {
    afterEach(() => vi.restoreAllMocks())

    it('logs login_failure without ever including the attempted email, and login_success with the user id', async () => {
      await createUser('user@example.com', 'correct-horse-battery-staple')
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'wrong-password' }),
      })
      const failureCall = spy.mock.calls.find(([prefix]) => prefix === '[security] login_failure')
      expect(failureCall).toBeTruthy()
      expect(String(failureCall![1])).not.toContain('user@example.com')

      const loginRes = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      const { id: userId } = await json<User>(loginRes)
      const successCall = spy.mock.calls.find(([prefix]) => prefix === '[security] login_success')
      expect(successCall).toBeTruthy()
      const payload = JSON.parse(String(successCall![1])) as { userId: string }
      expect(payload.userId).toBe(userId)
    })
  })

  it('returns the same error for unknown email and wrong password', async () => {
    await createUser('user@example.com', 'correct-horse-battery-staple')

    const unknownEmail = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever12345' }),
    })
    const wrongPassword = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'wrong-password' }),
    })

    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.status).toBe(401)
    expect(await json(unknownEmail)).toEqual(await json(wrongPassword))
  })

  it('invalidates the session on logout', async () => {
    const created = await createUser('user@example.com', 'correct-horse-battery-staple')
    const cookie = extractCookie(created)!

    const meBefore = await app.request('/api/v1/auth/me', { headers: { cookie } })
    expect(meBefore.status).toBe(200)

    const logout = await app.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie } })
    expect(logout.status).toBe(204)

    const meAfter = await app.request('/api/v1/auth/me', { headers: { cookie } })
    expect(meAfter.status).toBe(401)
  })

  it('rejects registration when the instance is closed (the default)', async () => {
    await createUser('admin@example.com', 'correct-horse-battery-staple')

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'New User',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('allows registration when the instance is open', async () => {
    await createUser('admin@example.com', 'correct-horse-battery-staple')
    await db
      .insert(instanceSettings)
      .values({ id: 1, registrationMode: 'open' })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { registrationMode: 'open' },
      })

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'New User',
      }),
    })
    expect(res.status).toBe(201)
    const body = await json<User>(res)
    expect(body.role).toBe('user')
  })

  it('rejects registration with a breached password (ASVS V2.1.7)', async () => {
    await createUser('admin@example.com', 'correct-horse-battery-staple')
    await db
      .insert(instanceSettings)
      .values({ id: 1, registrationMode: 'open' })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { registrationMode: 'open' } })

    // Overrides fetch-defaults.ts's default "not found" stub. The real
    // isPasswordPwned() only ever checks the SHA-1 suffix it computed from
    // the submitted password, so the stub has to answer with that exact
    // suffix (range response format is SUFFIX:COUNT, one per line) to
    // simulate a genuine match rather than an unrelated one.
    const password = 'a-password-this-test-pretends-is-breached'
    const suffix = createHash('sha1').update(password).digest('hex').toUpperCase().slice(5)
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(`${suffix}:1`)))

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password,
        displayName: 'New User',
      }),
    })
    expect(res.status).toBe(400)

    const rows = await db.select().from(users).where(eq(users.email, 'newuser@example.com'))
    expect(rows).toHaveLength(0)
  })

  it('rejects an invite-gated registration without a valid code', async () => {
    await createUser('admin@example.com', 'correct-horse-battery-staple')
    await db
      .insert(instanceSettings)
      .values({ id: 1, registrationMode: 'invite' })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { registrationMode: 'invite' },
      })

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'New User',
        inviteCode: 'not-a-real-code',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 409 for a duplicate email, without letting it enumerate accounts via a different response for a real one', async () => {
    await createUser('admin@example.com', 'correct-horse-battery-staple')
    await db
      .insert(instanceSettings)
      .values({ id: 1, registrationMode: 'open' })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { registrationMode: 'open' } })

    const res = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'another-password-123',
        displayName: 'Impersonator',
      }),
    })
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: 'Email already in use' })
  })

  describe('invite redemption (M3 security review, F-13)', () => {
    async function setUpInvite(): Promise<{ code: string; adminId: string }> {
      const adminRes = await createUser('admin@example.com', 'correct-horse-battery-staple')
      const admin = await json<User>(adminRes)
      await db
        .insert(instanceSettings)
        .values({ id: 1, registrationMode: 'invite' })
        .onConflictDoUpdate({ target: instanceSettings.id, set: { registrationMode: 'invite' } })

      const code = generateSecret(16)
      await db.insert(invites).values({
        codeHash: hashSecret(code),
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      return { code, adminId: admin.id }
    }

    function registerWithCode(email: string, code: string) {
      return app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'correct-horse-battery-staple',
          displayName: 'Invitee',
          inviteCode: code,
        }),
      })
    }

    it('rejects a second, sequential attempt to redeem an already-used code', async () => {
      const { code } = await setUpInvite()

      const first = await registerWithCode('first@example.com', code)
      expect(first.status).toBe(201)

      const second = await registerWithCode('second@example.com', code)
      expect(second.status).toBe(403)
    })

    it('lets exactly one of two concurrent redemptions of the same code succeed', async () => {
      const { code } = await setUpInvite()

      const [a, b] = await Promise.all([
        registerWithCode('racer-a@example.com', code),
        registerWithCode('racer-b@example.com', code),
      ])

      expect([a.status, b.status].sort()).toEqual([201, 403])

      const created = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, ['racer-a@example.com', 'racer-b@example.com']))
      expect(created).toHaveLength(1)
    })
  })
})
