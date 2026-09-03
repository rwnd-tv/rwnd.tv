import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loginAttempts, passwordResetTokens, sessions, userCredentials, users } from '@rwnd/db'
import type {
  AdminUserSummary,
  EnrollTotpResponse,
  ListAdminUsersResponse,
  ListSessionsResponse,
} from '@rwnd/shared'
import { generateTotp } from '../lib/totp.js'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createAdminAndCookie(email = 'admin@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'Admin' }),
  })
  const body = await json<{ id: string }>(res)
  return { id: body.id, cookie: extractCookie(res)! }
}

async function createUserAndCookie(email: string, opts: { role?: 'admin' | 'user' } = {}) {
  const id = await createLocalUser(db, email, 'correct-horse-battery-staple', opts)
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  })
  return { id, cookie: extractCookie(res)! }
}

describe('/api/v1/admin/users (M4, docs/TODO_ARCHIVE.md)', () => {
  beforeEach(() => resetDb(db))

  describe('GET /admin/users', () => {
    it('lists every user with role, lastLoginAt, emailVerifiedAt, mfaEnabled, sessionCount', async () => {
      const admin = await createAdminAndCookie()
      await createLocalUser(db, 'plain@example.com', 'correct-horse-battery-staple')

      const res = await app.request('/api/v1/admin/users', { headers: { cookie: admin.cookie } })
      expect(res.status).toBe(200)
      const body = await json<ListAdminUsersResponse>(res)
      expect(body.users).toHaveLength(2)

      const adminRow = body.users.find((u) => u.id === admin.id)!
      expect(adminRow.role).toBe('admin')
      // setup pre-verifies the first admin's email (routes/setup.ts).
      expect(adminRow.emailVerifiedAt).not.toBeNull()
      expect(adminRow.mfaEnabled).toBe(false)
      // No session created yet for the plain user (never logged in).
      const plainRow = body.users.find((u) => u.email === 'plain@example.com')!
      expect(plainRow.role).toBe('user')
      expect(plainRow.lastLoginAt).toBeNull()
      expect(plainRow.sessionCount).toBe(0)
    })

    it('stamps lastLoginAt and counts a session once a user actually logs in', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      const res = await app.request('/api/v1/admin/users', { headers: { cookie: admin.cookie } })
      const body = await json<ListAdminUsersResponse>(res)
      const row = body.users.find((u) => u.id === user.id)!
      expect(row.lastLoginAt).not.toBeNull()
      expect(row.sessionCount).toBe(1)
    })

    it('reports mfaEnabled only once TOTP enrollment is confirmed', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      const enrolled = await json<EnrollTotpResponse>(
        await app.request('/api/v1/auth/mfa/totp/enroll', {
          method: 'POST',
          headers: { cookie: user.cookie },
        }),
      )
      let list = await json<ListAdminUsersResponse>(
        await app.request('/api/v1/admin/users', { headers: { cookie: admin.cookie } }),
      )
      expect(list.users.find((u) => u.id === user.id)!.mfaEnabled).toBe(false)

      await app.request('/api/v1/auth/mfa/totp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: user.cookie },
        body: JSON.stringify({ code: generateTotp(enrolled.secret) } satisfies { code: string }),
      })
      list = await json<ListAdminUsersResponse>(
        await app.request('/api/v1/admin/users', { headers: { cookie: admin.cookie } }),
      )
      expect(list.users.find((u) => u.id === user.id)!.mfaEnabled).toBe(true)
    })

    it('rejects a non-admin', async () => {
      const user = await createUserAndCookie('plain@example.com')
      const res = await app.request('/api/v1/admin/users', { headers: { cookie: user.cookie } })
      expect(res.status).toBe(403)
    })

    it('rejects an unauthenticated request', async () => {
      const res = await app.request('/api/v1/admin/users')
      expect(res.status).toBe(401)
    })
  })

  describe('PATCH /admin/users/{id}', () => {
    it('promotes and demotes a user, changing what they can access', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      let res = await app.request(`/api/v1/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ role: 'admin' }),
      })
      expect(res.status).toBe(200)
      let body = await json<AdminUserSummary>(res)
      expect(body.role).toBe('admin')

      // The promoted user can now reach an admin-only route.
      res = await app.request('/api/v1/admin/users', { headers: { cookie: user.cookie } })
      expect(res.status).toBe(200)

      // Two admins now, so demoting this one is fine.
      res = await app.request(`/api/v1/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ role: 'user' }),
      })
      expect(res.status).toBe(200)
      body = await json<AdminUserSummary>(res)
      expect(body.role).toBe('user')

      res = await app.request('/api/v1/admin/users', { headers: { cookie: user.cookie } })
      expect(res.status).toBe(403)
    })

    it("refuses to demote the instance's last remaining admin", async () => {
      const admin = await createAdminAndCookie()
      const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ role: 'user' }),
      })
      expect(res.status).toBe(400)

      const [row] = await db.select().from(users).where(eq(users.id, admin.id))
      expect(row!.role).toBe('admin')
    })

    it('404s an unknown user id', async () => {
      const admin = await createAdminAndCookie()
      const res = await app.request('/api/v1/admin/users/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ role: 'admin' }),
      })
      expect(res.status).toBe(404)
    })

    it('rejects a non-admin', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('plain@example.com')
      const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: user.cookie },
        body: JSON.stringify({ role: 'user' }),
      })
      expect(res.status).toBe(403)
    })
  })

  describe('DELETE /admin/users/{id}', () => {
    it("deletes a user's account and every table referencing them", async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      const res = await app.request(`/api/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(204)

      const [row] = await db.select().from(users).where(eq(users.id, user.id))
      expect(row).toBeUndefined()
      const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id))
      expect(remainingSessions).toHaveLength(0)
      const remainingCredentials = await db
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.userId, user.id))
      expect(remainingCredentials).toHaveLength(0)
    })

    it("clears the deleted account's login lockout row, even though it has no FK", async () => {
      const admin = await createAdminAndCookie()
      const email = 'watcher@example.com'
      const user = await createUserAndCookie(email)

      // Record a failed login against this email so a login_attempts row
      // exists (recordFailedLogin, apps/api/src/lib/login-lockout.ts).
      await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      })
      let [lockoutRow] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email))
      expect(lockoutRow).toBeDefined()

      await app.request(`/api/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      ;[lockoutRow] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email))
      expect(lockoutRow).toBeUndefined()
    })

    it('refuses to delete your own account through this route', async () => {
      const admin = await createAdminAndCookie()
      const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(400)

      const [row] = await db.select().from(users).where(eq(users.id, admin.id))
      expect(row).toBeDefined()
    })

    it('one admin can delete another, as long as at least one remains', async () => {
      // The last-admin invariant is never actually reachable through this
      // route (assertNotLastAdmin's call site above is defense in depth,
      // not a live path): the self-guard above already means `id` is
      // always a *different* user from the caller, so if `id` is an
      // admin there are at least two admins before this delete and at
      // least one (the caller) after it. This test is that positive case
      // — proving the invariant doesn't over-block a legitimate delete.
      const admin = await createAdminAndCookie()
      const secondAdmin = await createUserAndCookie('second-admin@example.com', { role: 'admin' })

      const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
        method: 'DELETE',
        headers: { cookie: secondAdmin.cookie },
      })
      expect(res.status).toBe(204)

      const [row] = await db.select().from(users).where(eq(users.id, admin.id))
      expect(row).toBeUndefined()
    })

    it('404s an unknown user id', async () => {
      const admin = await createAdminAndCookie()
      const res = await app.request('/api/v1/admin/users/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(404)
    })

    it('rejects a non-admin', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('plain@example.com')
      const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
        method: 'DELETE',
        headers: { cookie: user.cookie },
      })
      expect(res.status).toBe(403)
    })
  })

  describe('sessions', () => {
    it("lists a user's sessions and revokes one", async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      let res = await app.request(`/api/v1/admin/users/${user.id}/sessions`, {
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(200)
      const listed = await json<ListSessionsResponse>(res)
      expect(listed.sessions).toHaveLength(1)
      // Viewed from the admin's own session, not the target's — never
      // true here since the admin isn't the one who owns this session.
      expect(listed.sessions[0]!.current).toBe(false)

      res = await app.request(`/api/v1/admin/users/${user.id}/sessions/${listed.sessions[0]!.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(204)

      // The revoked session's cookie no longer works.
      res = await app.request('/api/v1/admin/users', { headers: { cookie: user.cookie } })
      expect(res.status).toBe(401)
    })

    it('revokes every session for a user at once', async () => {
      const admin = await createAdminAndCookie()
      const email = 'watcher@example.com'
      const user = await createUserAndCookie(email)
      // A second concurrent session for the same account.
      await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
      })

      let res = await app.request(`/api/v1/admin/users/${user.id}/sessions`, {
        headers: { cookie: admin.cookie },
      })
      expect((await json<ListSessionsResponse>(res)).sessions).toHaveLength(2)

      res = await app.request(`/api/v1/admin/users/${user.id}/sessions`, {
        method: 'DELETE',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(204)

      res = await app.request(`/api/v1/admin/users/${user.id}/sessions`, {
        headers: { cookie: admin.cookie },
      })
      expect((await json<ListSessionsResponse>(res)).sessions).toHaveLength(0)
    })

    it('404s revoking a session that does not belong to the named user', async () => {
      const admin = await createAdminAndCookie()
      const userA = await createUserAndCookie('a@example.com')
      const userB = await createUserAndCookie('b@example.com')

      const listed = await json<ListSessionsResponse>(
        await app.request(`/api/v1/admin/users/${userA.id}/sessions`, {
          headers: { cookie: admin.cookie },
        }),
      )
      const res = await app.request(
        `/api/v1/admin/users/${userB.id}/sessions/${listed.sessions[0]!.id}`,
        { method: 'DELETE', headers: { cookie: admin.cookie } },
      )
      expect(res.status).toBe(404)
    })

    it('rejects a non-admin', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('plain@example.com')
      const res = await app.request(`/api/v1/admin/users/${admin.id}/sessions`, {
        headers: { cookie: user.cookie },
      })
      expect(res.status).toBe(403)
    })
  })

  describe('POST /admin/users/{id}/password-reset', () => {
    it('creates a reset token for a user with a local credential', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('watcher@example.com')

      const res = await app.request(`/api/v1/admin/users/${user.id}/password-reset`, {
        method: 'POST',
        headers: { cookie: admin.cookie },
      })
      // Delivery itself is best-effort (CI's SMTP always fails, same as
      // every other sender in lib/email.ts) — the durable, testable
      // behaviour is that a real reset token now exists for this user.
      // The plaintext token is only ever emailed, never returned by this
      // route, so it can't be redeemed from here directly.
      expect(res.status).toBe(204)
      const [tokenRow] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id))
      expect(tokenRow).toBeDefined()
    })

    it('rejects a request for a user with no local credential to reset', async () => {
      const admin = await createAdminAndCookie()
      // Every account today is a local credential (no OIDC adapter exists
      // yet, ADR 0003) — construct the no-credential case directly rather
      // than via any real route.
      const [userOnly] = await db
        .insert(users)
        .values({ email: 'no-credential@example.com', displayName: 'No Credential' })
        .returning({ id: users.id })

      const res = await app.request(`/api/v1/admin/users/${userOnly!.id}/password-reset`, {
        method: 'POST',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(400)
    })

    it('404s an unknown user id', async () => {
      const admin = await createAdminAndCookie()
      const res = await app.request(
        '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/password-reset',
        { method: 'POST', headers: { cookie: admin.cookie } },
      )
      expect(res.status).toBe(404)
    })

    it('rejects a non-admin', async () => {
      const admin = await createAdminAndCookie()
      const user = await createUserAndCookie('plain@example.com')
      const res = await app.request(`/api/v1/admin/users/${admin.id}/password-reset`, {
        method: 'POST',
        headers: { cookie: user.cookie },
      })
      expect(res.status).toBe(403)
    })
  })
})
