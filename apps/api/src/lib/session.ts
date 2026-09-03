import { and, desc, eq, ne } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { sessions, users } from '@rwnd/db'
import { generateSecret, hashSecret } from './tokens.js'

// 30 days — both the fixed TTL a freshly-created session gets, and (since
// the M3 security review's session-management follow-up, ASVS V3.3.2/
// V3.3.4, docs/TODO.md) the sliding window resolveSession() renews on each
// throttled touch below: an active session now expires 30 days after its
// *last* use, not 30 days after login. An idle session still expires on
// schedule — nothing renews it if nobody's using it.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// How often resolveSession() below actually writes a lastUsedAt/expiresAt
// update — an ordinary browsing session makes many requests a minute, and
// neither the session list UI nor the sliding expiry above need per-request
// precision. Keeps both meaningful without turning every authenticated
// request into a write.
const LAST_USED_THROTTLE_MS = 60 * 1000

export async function createSession(
  db: Database,
  userId: string,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSecret(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({
    userId,
    tokenHash: hashSecret(token),
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  })

  // Stamped here rather than at each of this helper's call sites (plain
  // login, MFA completion, register, setup) so a future login path can't
  // forget it — and a session is only ever created once a login has
  // actually completed, so a password that stopped short of a required
  // MFA second factor correctly never touches this. Backs the admin
  // user-management list (apps/api/src/routes/admin-users.ts, M4).
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))

  return { token, expiresAt }
}

/**
 * `renewedExpiresAt` is non-null exactly when this call extended the
 * session's server-side TTL (the throttle below) — the caller
 * (middleware/auth.ts's requireSession) uses it to also re-send the session
 * cookie with a matching new `Expires`, since a sliding *server-side*
 * expiry alone would be pointless once the browser drops the cookie at its
 * original, un-renewed expiry.
 */
export async function resolveSession(
  db: Database,
  token: string,
): Promise<{ user: typeof users.$inferSelect; renewedExpiresAt: Date | null } | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)

  if (!row) return null
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id))
    return null
  }

  let renewedExpiresAt: Date | null = null
  const lastUsedAt = row.session.lastUsedAt?.getTime() ?? 0
  if (Date.now() - lastUsedAt > LAST_USED_THROTTLE_MS) {
    renewedExpiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date(), expiresAt: renewedExpiresAt })
      .where(eq(sessions.id, row.session.id))
  }

  return { user: row.user, renewedExpiresAt }
}

/** GET /auth/me/sessions marks which row is the caller's own session by
 * comparing ids against this — a session token can't be reversed back to
 * an id without a DB round-trip, and `SessionSummary` deliberately doesn't
 * carry `tokenHash` for the route to compare against directly. */
export async function findSessionId(db: Database, token: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSecret(token)))
    .limit(1)
  return row?.id ?? null
}

export interface SessionSummary {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
}

/** Newest first — GET /auth/me/sessions. Never returns `tokenHash`; the
 * caller marks which row is the current session by comparing ids, not by
 * anything returned here (a session token can't be reversed back to an id
 * without a DB round-trip anyway, so the route does that comparison itself
 * — see routes/auth.ts). */
export async function listSessions(db: Database, userId: string): Promise<SessionSummary[]> {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
}

/** DELETE /auth/me/sessions/{id} — scoped by `userId` so one user can never
 * revoke another's session by guessing/enumerating ids. Returns whether a
 * row was actually deleted, so the route can 404 rather than silently
 * no-op on an id that doesn't belong to the caller. */
export async function revokeSessionById(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id })
  return deleted.length > 0
}

export async function revokeSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSecret(token)))
}

/** Used by password reset (apps/api/src/routes/auth.ts) — a successful
 * reset invalidates every existing session for the account, not just the
 * one (if any) the reset was performed from, the standard "changing your
 * password logs out anyone else with a live session" security practice. */
export async function revokeAllSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Same security practice as revokeAllSessions above, but for changing
 * your password *while already logged in* (POST /auth/me/password) —
 * deliberately keeps the session making the request alive rather than
 * logging the user themselves out immediately after they just proved they
 * know both the current and new password. */
export async function revokeOtherSessions(
  db: Database,
  userId: string,
  currentToken: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashSecret(currentToken))))
}
