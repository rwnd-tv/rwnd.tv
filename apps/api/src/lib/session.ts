import { and, eq, ne } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { sessions, users } from '@rwnd/db'
import { generateSecret, hashSecret } from './tokens.js'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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

  return { token, expiresAt }
}

export async function resolveSession(db: Database, token: string) {
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
  return row.user
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
