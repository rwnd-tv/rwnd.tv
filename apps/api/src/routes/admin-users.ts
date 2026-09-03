import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm'
import {
  adminUserSummarySchema,
  listAdminUsersResponseSchema,
  listSessionsResponseSchema,
  updateUserRoleRequestSchema,
  userSchema,
} from '@rwnd/shared'
import { sessions, userCredentials, users, userTotp } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { requireAdmin } from '../middleware/auth.js'
import { requireEmailConfigured } from './auth.js'
import { assertNotLastAdmin, LastAdminError } from '../lib/admins.js'
import {
  findSessionId,
  listSessions,
  revokeAllSessions,
  revokeSessionById,
} from '../lib/session.js'
import { clearLoginAttempts } from '../lib/login-lockout.js'
import { createPasswordResetToken } from '../lib/account-tokens.js'
import { sendPasswordResetEmail } from '../lib/email.js'
import { getSessionToken } from '../lib/cookies.js'
import { serializeUser } from '../lib/serialize.js'
import { logSecurityEvent } from '../lib/security-log.js'

/**
 * Admin-only user management (M4, docs/TODO_ARCHIVE.md): list every user on
 * the instance, promote/demote, revoke another user's sessions, trigger a
 * password reset for them, or delete their account. Mounted under
 * `/admin/users` rather than `/users` — the "Public/shareable profile
 * pages" roadmap item (not yet scheduled) will want `/users/{id}` for a
 * non-admin surface, so this admin namespace deliberately doesn't squat on
 * that path.
 *
 * Every route here is `requireAdmin`-gated. The last-admin invariant (an
 * instance can never reach zero admins) is enforced by
 * `lib/admins.ts#assertNotLastAdmin`, shared with `DELETE /auth/me`'s
 * self-service path (routes/auth.ts).
 */
export const adminUserRoutes = new OpenAPIHono<AppEnv>()

const userIdParam = z.object({ id: z.string().uuid() })
const sessionIdParam = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() })

adminUserRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/admin/users',
    summary: 'List every user on the instance, ordered by display name (admin only)',
    middleware: [requireAdmin] as const,
    responses: {
      200: {
        description: 'Users',
        content: { 'application/json': { schema: listAdminUsersResponseSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const db = c.get('db')

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .orderBy(asc(users.displayName))

    // Two batch queries rather than a per-row lookup — a self-hosted
    // instance has a handful of users, but there's no reason to make it
    // N+1 anyway. mfaEnabled and sessionCount are computed here, never
    // stored (see admin-users.ts's shared schema doc comment).
    const [confirmedTotpRows, sessionCountRows] = await Promise.all([
      db.select({ userId: userTotp.userId }).from(userTotp).where(isNotNull(userTotp.confirmedAt)),
      db
        .select({ userId: sessions.userId, count: sql<number>`count(*)`.mapWith(Number) })
        .from(sessions)
        .groupBy(sessions.userId),
    ])
    const mfaEnabledUserIds = new Set(confirmedTotpRows.map((row) => row.userId))
    const sessionCountByUser = new Map(sessionCountRows.map((row) => [row.userId, row.count]))

    return c.json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
        mfaEnabled: mfaEnabledUserIds.has(row.id),
        sessionCount: sessionCountByUser.get(row.id) ?? 0,
      })),
    })
  },
)

/**
 * Single-user counterpart to the list above — backs AdminUserPage.tsx (M4
 * "split the list into a summary list plus a per-user detail page" work,
 * docs/TODO_ARCHIVE.md), same reasoning every other detail page in this app
 * (`GET /library/shows/{slug}`, `GET /watchlists/{id}`) fetches its one item
 * directly rather than the page filtering an already-fetched list.
 */
adminUserRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/admin/users/{id}',
    summary: 'Get one user on the instance (admin only)',
    middleware: [requireAdmin] as const,
    request: { params: userIdParam },
    responses: {
      200: {
        description: 'User',
        content: { 'application/json': { schema: adminUserSummarySchema } },
      },
      403: { description: 'Admin only' },
      404: { description: 'User not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!row) return c.json({ error: 'User not found' }, 404)

    const [[totpRow], [sessionCountRow]] = await Promise.all([
      db
        .select({ id: userTotp.id })
        .from(userTotp)
        .where(and(eq(userTotp.userId, id), isNotNull(userTotp.confirmedAt)))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(sessions)
        .where(eq(sessions.userId, id)),
    ])

    return c.json({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
      mfaEnabled: Boolean(totpRow),
      sessionCount: sessionCountRow!.count,
    })
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/admin/users/{id}',
    summary: "Promote or demote a user's role (admin only)",
    middleware: [requireAdmin] as const,
    request: {
      params: userIdParam,
      body: { content: { 'application/json': { schema: updateUserRoleRequestSchema } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: userSchema } } },
      400: {
        description: "Can't demote the last remaining admin, or change the owner's role here",
      },
      403: { description: 'Admin only' },
      404: { description: 'User not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { role } = c.req.valid('json')
    const db = c.get('db')
    const admin = c.get('user')!

    // The owner's role is only ever changed via
    // POST /auth/me/transfer-ownership (routes/auth.ts) — never through
    // this generic promote/demote route, regardless of who's calling,
    // including the owner acting on themselves. `updateUserRoleRequestSchema`
    // already can't set `role: 'owner'`; this is the other direction, an
    // existing owner being demoted away from it.
    const [target] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (target?.role === 'owner') {
      return c.json(
        {
          error:
            "Can't change the owner's role here — transfer ownership from the Account page instead",
        },
        400,
      )
    }

    try {
      const updated = await db.transaction(async (tx) => {
        if (role === 'user') {
          // Only demotion can threaten the invariant — promoting to
          // admin only ever adds one, never removes the last.
          await assertNotLastAdmin(tx, id)
        }
        // ne(users.role, 'owner') is defense in depth against the target
        // becoming the owner between the check above and this write (e.g.
        // a concurrent ownership transfer) — the same "provably
        // unreachable in the common case, kept anyway" reasoning as
        // DELETE /admin/users/{id} below.
        const [row] = await tx
          .update(users)
          .set({ role })
          .where(and(eq(users.id, id), ne(users.role, 'owner')))
          .returning()
        return row ?? null
      })

      if (!updated) return c.json({ error: 'User not found' }, 404)

      logSecurityEvent('admin_user_role_changed', { userId: id, role, adminId: admin.id })
      return c.json(serializeUser(updated), 200)
    } catch (err) {
      if (err instanceof LastAdminError) {
        return c.json({ error: err.message }, 400)
      }
      throw err
    }
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/admin/users/{id}',
    summary: "Permanently delete a user's account (admin only)",
    middleware: [requireAdmin] as const,
    request: { params: userIdParam },
    // Every other table referencing this user cascades on delete — see
    // routes/auth.ts's DELETE /auth/me for the same list. Two are worth
    // flagging here specifically: `invites.createdBy` and
    // `webhook_link_codes.createdBy` also cascade, so deleting an admin
    // deletes every still-pending invite/link code they created; and
    // `webhook_account_links.userId` is nullable but still `ON DELETE
    // cascade`, so deleting a user destroys that detected-Plex-account
    // mapping row entirely (including its firstSeenAt history) rather
    // than resetting it to the normal unlinked state. Whether that link
    // row should instead be `set null` is a real question but a separate
    // change (see docs/TODO.md). `login_attempts` has no FK at all (it's
    // keyed by email, not userId) so it can't cascade — cleared
    // explicitly below instead, or a lockout would silently outlive the
    // account and apply to anyone who later reuses the address.
    responses: {
      204: { description: 'Deleted' },
      400: {
        description: "Can't delete your own account here, or the owner's account",
      },
      403: { description: 'Admin only' },
      404: { description: 'User not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const admin = c.get('user')!

    // Deleting your own account here would route around DELETE /auth/me's
    // re-typed-password-and-email confirmation — that route is where an
    // admin deletes themselves, same as anyone else.
    if (id === admin.id) {
      return c.json({ error: 'Delete your own account from Account settings instead' }, 400)
    }

    // The owner can never be deleted by another admin — only by
    // themselves, and only after transferring ownership first (which
    // makes them a plain admin, at which point DELETE /auth/me applies
    // normally). See routes/auth.ts's POST /auth/me/transfer-ownership.
    const [target] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (target?.role === 'owner') {
      return c.json({ error: "Can't delete the owner's account" }, 400)
    }

    try {
      const deleted = await db.transaction(async (tx) => {
        // Provably unreachable given the self-guard above: reaching this
        // line means the caller (an admin) and `id` are two different
        // users, so if `id` is also an admin there are at least two
        // admins before this delete and at least one (the caller) after
        // it — never "last". Kept anyway as defense in depth: cheap, and
        // it stays correct even if the self-guard above is ever changed
        // without this line being revisited. See lib/admins.ts.
        await assertNotLastAdmin(tx, id)
        // ne(users.role, 'owner') is defense in depth against the target
        // becoming the owner between the check above and this write, same
        // reasoning as PATCH /admin/users/{id}'s equivalent guard.
        const rows = await tx
          .delete(users)
          .where(and(eq(users.id, id), ne(users.role, 'owner')))
          .returning({ id: users.id, email: users.email })
        // Not a cascade — login_attempts is keyed by email with no FK
        // (see its doc comment), so it would otherwise silently outlive
        // the account and apply to anyone who later reuses this address.
        if (rows[0]) await clearLoginAttempts(tx, rows[0].email)
        return rows
      })

      if (deleted.length === 0) return c.json({ error: 'User not found' }, 404)

      logSecurityEvent('admin_user_deleted', { userId: id, adminId: admin.id })
      return c.body(null, 204)
    } catch (err) {
      if (err instanceof LastAdminError) {
        return c.json({ error: err.message }, 400)
      }
      throw err
    }
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/admin/users/{id}/sessions',
    summary: "List a user's active sessions, newest first (admin only)",
    middleware: [requireAdmin] as const,
    request: { params: userIdParam },
    responses: {
      200: {
        description: 'Sessions',
        content: { 'application/json': { schema: listSessionsResponseSchema } },
      },
      403: { description: 'Admin only' },
      404: { description: 'User not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
    if (!target) return c.json({ error: 'User not found' }, 404)

    // `current` is only ever true when an admin is looking at their own
    // row (an admin viewing someone else's sessions has no session of
    // theirs in this list to match) — same computation as
    // GET /auth/me/sessions, just against `id` instead of the caller.
    const env = loadEnv()
    const currentToken = getSessionToken(c, env)
    const currentSessionId = currentToken ? await findSessionId(db, currentToken) : null

    const rows = await listSessions(db, id)
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === currentSessionId,
      })),
    })
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/admin/users/{id}/sessions/{sessionId}',
    summary: "Revoke one of a user's sessions (admin only)",
    middleware: [requireAdmin] as const,
    request: { params: sessionIdParam },
    responses: {
      204: { description: 'Revoked' },
      403: { description: 'Admin only' },
      404: { description: 'Session not found' },
    },
  }),
  async (c) => {
    const { id, sessionId } = c.req.valid('param')
    const db = c.get('db')
    const admin = c.get('user')!

    const revoked = await revokeSessionById(db, id, sessionId)
    if (!revoked) return c.json({ error: 'Session not found' }, 404)

    logSecurityEvent('admin_user_sessions_revoked', { userId: id, adminId: admin.id })
    return c.body(null, 204)
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/admin/users/{id}/sessions',
    summary: "Revoke every one of a user's sessions (admin only)",
    middleware: [requireAdmin] as const,
    request: { params: userIdParam },
    responses: {
      204: { description: 'Revoked' },
      403: { description: 'Admin only' },
      404: { description: 'User not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const admin = c.get('user')!

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
    if (!target) return c.json({ error: 'User not found' }, 404)

    await revokeAllSessions(db, id)
    logSecurityEvent('admin_user_sessions_revoked', { userId: id, adminId: admin.id })
    return c.body(null, 204)
  },
)

adminUserRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{id}/password-reset',
    summary: 'Send a user a password reset email (admin only)',
    // Reuses routes/auth.ts's own mail-sending gate rather than
    // duplicating it — see that middleware's doc comment.
    middleware: [requireAdmin, requireEmailConfigured] as const,
    request: { params: userIdParam },
    responses: {
      204: { description: 'Reset email sent' },
      // Unlike POST /auth/forgot-password, this reports real outcomes
      // rather than always 204 — that route's blanket 204 exists purely
      // to stop account enumeration by an anonymous caller; an admin
      // looking at the user list already knows exactly which accounts
      // exist, so the same pretence here would only cost them useful
      // feedback.
      400: { description: 'User has no local (email/password) credential to reset' },
      403: { description: 'Admin only' },
      404: {
        description: 'User not found, or email is not configured on this instance',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const admin = c.get('user')!

    const [row] = await db
      .select({ user: users, credential: userCredentials })
      .from(users)
      .leftJoin(
        userCredentials,
        and(eq(userCredentials.userId, users.id), eq(userCredentials.type, 'local')),
      )
      .where(eq(users.id, id))
      .limit(1)
    if (!row) return c.json({ error: 'User not found' }, 404)
    if (!row.credential) {
      return c.json({ error: 'User has no local (email/password) credential to reset' }, 400)
    }

    const token = await createPasswordResetToken(db, id)
    // Best-effort, same as every other sender in lib/email.ts (e.g.
    // POST /auth/forgot-password) — a transient relay failure shouldn't
    // undo a token that's already been issued; the link is still valid,
    // it just may not have arrived. Logged server-side so a self-hoster
    // can notice a real delivery problem.
    try {
      await sendPasswordResetEmail(row.user.email, token)
    } catch (err) {
      console.error(`Failed to send admin-triggered password reset to user ${id}:`, err)
    }

    logSecurityEvent('admin_password_reset_sent', { userId: id, adminId: admin.id })
    return c.body(null, 204)
  },
)
