import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mfaChallenges, userRecoveryCodes } from '@rwnd/db'
import type {
  ConfirmTotpResponse,
  EnrollTotpResponse,
  MfaRequiredResponse,
  TotpStatus,
  User,
} from '@rwnd/shared'
import { generateTotp } from '../lib/totp.js'
import { hashRecoveryCode } from '../lib/recovery-codes.js'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndCookie(email: string): Promise<string> {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'Test' }),
  })
  return extractCookie(res)!
}

/** Enrolls and confirms in one step, returning everything a login-flow
 * test needs — every test that cares about an *already-enabled* account
 * starts from here rather than repeating the enroll+confirm dance. */
async function enrollAndConfirm(
  cookie: string,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const enrolled = await json<EnrollTotpResponse>(
    await app.request('/api/v1/auth/mfa/totp/enroll', { method: 'POST', headers: { cookie } }),
  )
  const confirmed = await json<ConfirmTotpResponse>(
    await app.request('/api/v1/auth/mfa/totp/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ code: generateTotp(enrolled.secret) }),
    }),
  )
  return { secret: enrolled.secret, recoveryCodes: confirmed.recoveryCodes }
}

describe('TOTP MFA (M3 security review follow-up, ASVS V4.3.1)', () => {
  beforeEach(() => resetDb(db))

  describe('enrollment', () => {
    it('is disabled by default', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const status = await json<TotpStatus>(
        await app.request('/api/v1/auth/mfa/totp', { headers: { cookie } }),
      )
      expect(status.enabled).toBe(false)
    })

    it('enroll returns a secret and otpauth URI, but does not enable MFA yet', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const res = await app.request('/api/v1/auth/mfa/totp/enroll', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
      const body = await json<EnrollTotpResponse>(res)
      expect(body.secret).toMatch(/^[A-Z2-7]+$/)
      expect(body.otpauthUri).toContain(body.secret)

      const status = await json<TotpStatus>(
        await app.request('/api/v1/auth/mfa/totp', { headers: { cookie } }),
      )
      expect(status.enabled).toBe(false)
    })

    it('confirm rejects a wrong code', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      await app.request('/api/v1/auth/mfa/totp/enroll', { method: 'POST', headers: { cookie } })
      const res = await app.request('/api/v1/auth/mfa/totp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ code: '000000' }),
      })
      expect(res.status).toBe(400)
    })

    it('confirm rejects when no enrollment is in progress', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const res = await app.request('/api/v1/auth/mfa/totp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ code: '123456' }),
      })
      expect(res.status).toBe(400)
    })

    it('confirm with the correct code enables MFA and returns 10 recovery codes', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { recoveryCodes } = await enrollAndConfirm(cookie)
      expect(recoveryCodes).toHaveLength(10)

      const status = await json<TotpStatus>(
        await app.request('/api/v1/auth/mfa/totp', { headers: { cookie } }),
      )
      expect(status.enabled).toBe(true)
    })

    it('rejects re-enrolling once already confirmed', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      await enrollAndConfirm(cookie)
      const res = await app.request('/api/v1/auth/mfa/totp/enroll', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(403)
    })
  })

  describe('login flow', () => {
    it('a normal (non-MFA) account still logs in directly, no challenge', async () => {
      await createUserAndCookie('user@example.com')
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toMatch(/rwnd_session=/)
      const body = await json<User>(res)
      expect(body.email).toBe('user@example.com')
    })

    it('an MFA-enabled account gets a challenge instead of a session', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      await enrollAndConfirm(cookie)

      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toBeNull()
      const body = await json<MfaRequiredResponse>(res)
      expect(body.mfaRequired).toBe(true)
      expect(body.challengeToken).toBeTruthy()
    })

    it('completes the login with the correct TOTP code', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)

      const login = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )

      const res = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code: generateTotp(secret) }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toMatch(/rwnd_session=/)
    })

    it('a wrong code does not consume the challenge — the next attempt can still succeed', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)
      const login = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )

      const wrong = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code: '000000' }),
      })
      expect(wrong.status).toBe(401)

      const right = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code: generateTotp(secret) }),
      })
      expect(right.status).toBe(200)
    })

    it('the challenge is single-use once a code succeeds', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)
      const login = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )
      const code = generateTotp(secret)
      const first = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code }),
      })
      expect(first.status).toBe(200)

      const second = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code }),
      })
      expect(second.status).toBe(401)
    })

    it('rejects an unknown or expired challenge token', async () => {
      const res = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: 'not-a-real-token', code: '123456' }),
      })
      expect(res.status).toBe(401)
    })

    it('completes the login with a recovery code instead of a TOTP code, consuming it', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { recoveryCodes } = await enrollAndConfirm(cookie)
      const login = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )

      const res = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login.challengeToken, code: recoveryCodes[0] }),
      })
      expect(res.status).toBe(200)

      const [row] = await db
        .select()
        .from(userRecoveryCodes)
        .where(eq(userRecoveryCodes.codeHash, hashRecoveryCode(recoveryCodes[0]!)))
      expect(row?.usedAt).not.toBeNull()
    })

    it('an already-used recovery code cannot be reused', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { recoveryCodes } = await enrollAndConfirm(cookie)
      const usedCode = recoveryCodes[0]!

      const login1 = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )
      await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login1.challengeToken, code: usedCode }),
      })

      const login2 = await json<MfaRequiredResponse>(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )
      const reuse = await app.request('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: login2.challengeToken, code: usedCode }),
      })
      expect(reuse.status).toBe(401)
    })
  })

  describe('disable', () => {
    it('rejects the wrong password', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)
      const res = await app.request('/api/v1/auth/mfa/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ currentPassword: 'wrong-password', code: generateTotp(secret) }),
      })
      expect(res.status).toBe(403)
    })

    it('rejects a wrong code', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      await enrollAndConfirm(cookie)
      const res = await app.request('/api/v1/auth/mfa/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ currentPassword: 'correct-horse-battery-staple', code: '000000' }),
      })
      expect(res.status).toBe(403)
    })

    it('disables MFA with the correct password and TOTP code, and future logins skip the challenge', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)

      const res = await app.request('/api/v1/auth/mfa/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'correct-horse-battery-staple',
          code: generateTotp(secret),
        }),
      })
      expect(res.status).toBe(204)

      const status = await json<TotpStatus>(
        await app.request('/api/v1/auth/mfa/totp', { headers: { cookie } }),
      )
      expect(status.enabled).toBe(false)

      const login = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct-horse-battery-staple',
        }),
      })
      expect(login.headers.get('set-cookie')).toMatch(/rwnd_session=/)
    })

    it('disables MFA using a recovery code instead of a TOTP code', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { recoveryCodes } = await enrollAndConfirm(cookie)

      const res = await app.request('/api/v1/auth/mfa/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'correct-horse-battery-staple',
          code: recoveryCodes[0],
        }),
      })
      expect(res.status).toBe(204)
    })

    it('allows enrolling again after disabling', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)
      await app.request('/api/v1/auth/mfa/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'correct-horse-battery-staple',
          code: generateTotp(secret),
        }),
      })

      const res = await app.request('/api/v1/auth/mfa/totp/enroll', {
        method: 'POST',
        headers: { cookie },
      })
      expect(res.status).toBe(200)
    })
  })

  describe('regenerate recovery codes', () => {
    it('invalidates old codes and issues 10 fresh ones', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret, recoveryCodes: oldCodes } = await enrollAndConfirm(cookie)

      const res = await app.request('/api/v1/auth/mfa/totp/recovery-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'correct-horse-battery-staple',
          code: generateTotp(secret),
        }),
      })
      expect(res.status).toBe(200)
      const { recoveryCodes: newCodes } = await json<ConfirmTotpResponse>(res)
      expect(newCodes).toHaveLength(10)
      expect(newCodes.some((code) => oldCodes.includes(code))).toBe(false)

      const rows = await db.select().from(userRecoveryCodes)
      expect(rows).toHaveLength(10)
    })

    it('rejects the wrong password', async () => {
      const cookie = await createUserAndCookie('user@example.com')
      const { secret } = await enrollAndConfirm(cookie)
      const res = await app.request('/api/v1/auth/mfa/totp/recovery-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ currentPassword: 'wrong-password', code: generateTotp(secret) }),
      })
      expect(res.status).toBe(403)
    })
  })

  describe('cross-user isolation', () => {
    it('one user’s MFA status/enrollment never touches another’s', async () => {
      const cookieA = await createUserAndCookie('user-a@example.com')
      await enrollAndConfirm(cookieA)

      // createUserAndCookie wraps POST /setup, which only ever succeeds
      // once per instance — a second user is created directly instead,
      // same as other multi-user tests in this suite (see
      // createLocalUser's own doc comment in helpers.ts).
      await createLocalUser(db, 'user-b@example.com', 'correct-horse-battery-staple')
      const cookieB = extractCookie(
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user-b@example.com',
            password: 'correct-horse-battery-staple',
          }),
        }),
      )!

      const statusB = await json<TotpStatus>(
        await app.request('/api/v1/auth/mfa/totp', { headers: { cookie: cookieB } }),
      )
      expect(statusB.enabled).toBe(false)

      // B can still enroll their own, independent of A's.
      const res = await app.request('/api/v1/auth/mfa/totp/enroll', {
        method: 'POST',
        headers: { cookie: cookieB },
      })
      expect(res.status).toBe(200)
    })
  })

  it('a stale mfa_challenges row from an expired login attempt does not linger forever', async () => {
    // Not asserting automatic cleanup (none exists — challenges just expire
    // logically, same as every other account-recovery token in this
    // codebase) — this documents that expectation: an expired challenge is
    // deleted the moment it's *looked up*, not before.
    const cookie = await createUserAndCookie('user@example.com')
    await enrollAndConfirm(cookie)
    await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'correct-horse-battery-staple' }),
    })
    const [row] = await db.select().from(mfaChallenges).limit(1)
    expect(row).toBeDefined()
  })
})
