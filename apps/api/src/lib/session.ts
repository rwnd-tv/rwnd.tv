import { eq } from 'drizzle-orm'
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
