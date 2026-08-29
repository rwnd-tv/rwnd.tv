import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { emailChangeTokens, emailVerificationTokens, passwordResetTokens, users } from '@rwnd/db'
import {
  createEmailChangeToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from '../lib/account-tokens.js'
import { createLocalUser, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

describe('account-recovery token flows (reset / verify / email-change)', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  describe('password reset', () => {
    it('is single-use — redeeming twice fails the second time', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createPasswordResetToken(db, userId)

      const first = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'new-correct-horse-battery-staple' }),
      })
      expect(first.status).toBe(204)

      const second = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'another-new-password-123' }),
      })
      expect(second.status).toBe(400)
    })

    it('rejects an expired token, consuming it on that failed attempt too', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createPasswordResetToken(db, userId)
      const [row] = await db.select().from(passwordResetTokens).limit(1)
      await db
        .update(passwordResetTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(passwordResetTokens.id, row!.id))

      const first = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'new-correct-horse-battery-staple' }),
      })
      expect(first.status).toBe(400)

      // redeemPasswordResetToken deletes the row before checking expiry
      // (see lib/account-tokens.ts's doc comment) — a second attempt with
      // the same expired token must fail identically, not succeed because
      // the row happened to survive the first failed check.
      const second = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'another-new-password-123' }),
      })
      expect(second.status).toBe(400)
    })

    it('rejects an unknown token', async () => {
      const res = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token', password: 'new-password-123456' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects a breached new password without consuming the token (ASVS V2.1.7)', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createPasswordResetToken(db, userId)

      const password = 'a-password-this-test-pretends-is-breached'
      const suffix = createHash('sha1').update(password).digest('hex').toUpperCase().slice(5)
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(`${suffix}:1`)))

      const rejected = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      expect(rejected.status).toBe(400)

      // The single-use token is still valid — checked before redemption
      // specifically so a rejected weak password doesn't force a whole new
      // "forgot password" round trip (see routes/auth.ts's doc comment).
      vi.unstubAllGlobals()
      const succeeds = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: 'new-correct-horse-battery-staple' }),
      })
      expect(succeeds.status).toBe(204)
    })

    it('creating a new token does not invalidate a previous one (no delete-on-create, unlike verification)', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const first = await createPasswordResetToken(db, userId)
      await createPasswordResetToken(db, userId)

      const res = await app.request('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: first, password: 'new-correct-horse-battery-staple' }),
      })
      expect(res.status).toBe(204)
    })
  })

  describe('email verification', () => {
    it('is single-use and marks the account verified', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createEmailVerificationToken(db, userId)

      const first = await app.request('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(first.status).toBe(204)

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      expect(user!.emailVerifiedAt).not.toBeNull()

      const second = await app.request('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(second.status).toBe(400)
    })

    it('rejects an expired token', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createEmailVerificationToken(db, userId)
      const [row] = await db.select().from(emailVerificationTokens).limit(1)
      await db
        .update(emailVerificationTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(emailVerificationTokens.id, row!.id))

      const res = await app.request('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(res.status).toBe(400)
    })

    it('issuing a new verification token invalidates the previous one', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const stale = await createEmailVerificationToken(db, userId)
      await createEmailVerificationToken(db, userId)

      const res = await app.request('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: stale }),
      })
      expect(res.status).toBe(400)

      const rows = await db.select().from(emailVerificationTokens)
      expect(rows).toHaveLength(1)
    })

    it('rejects an unknown token', async () => {
      const res = await app.request('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('email change', () => {
    it('is single-use and only then updates the address', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const token = await createEmailChangeToken(db, userId, 'newaddress@example.com')

      const first = await app.request('/api/v1/auth/confirm-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(first.status).toBe(204)

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      expect(user!.email).toBe('newaddress@example.com')

      const second = await app.request('/api/v1/auth/confirm-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(second.status).toBe(400)
    })

    it('rejects the confirmation if the address was claimed by someone else in the meantime', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      await createLocalUser(db, 'already-taken@example.com', 'another-password-123')
      const token = await createEmailChangeToken(db, userId, 'already-taken@example.com')

      const res = await app.request('/api/v1/auth/confirm-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      expect(res.status).toBe(409)

      // Re-checked at redemption time per the function's doc comment — the
      // token itself is still consumed (deleted) either way, not left
      // replayable.
      const rows = await db.select().from(emailChangeTokens)
      expect(rows).toHaveLength(0)
    })

    it('issuing a new email-change token invalidates the previous one', async () => {
      const userId = await createLocalUser(db, 'user@example.com', 'correct-horse-battery-staple')
      const stale = await createEmailChangeToken(db, userId, 'first-attempt@example.com')
      await createEmailChangeToken(db, userId, 'second-attempt@example.com')

      const res = await app.request('/api/v1/auth/confirm-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: stale }),
      })
      expect(res.status).toBe(400)
    })
  })
})
