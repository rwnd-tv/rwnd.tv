import { eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { mfaChallenges } from '@rwnd/db'
import { generateSecret, hashSecret } from './tokens.js'

// 5 minutes — long enough to type a code, short enough to bound how long a
// stolen challenge token stays useful.
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function createMfaChallenge(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSecret(32)
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS)
  await db.insert(mfaChallenges).values({ userId, tokenHash: hashSecret(token), expiresAt })
  return { token, expiresAt }
}

/**
 * Deliberately *not* consumed on a failed code — unlike
 * lib/account-tokens.ts's redeem*Token functions, a wrong TOTP guess (a
 * typo is the overwhelmingly common case) shouldn't force a whole new
 * password login just to get a fresh challenge. The route
 * (POST /auth/login/mfa) is what actually bounds attempts: its own rate
 * limit, plus this challenge expiring after 5 minutes regardless of how
 * many attempts were made against it. Only `deleteMfaChallenge` below,
 * called once a code actually verifies, makes it single-use in practice.
 * Returns the challenge's `userId`, or `null` if it doesn't exist or has
 * expired (an expired row is deleted here, same "no reason to keep a dead
 * row around" reasoning as the account-recovery tokens).
 */
export async function getMfaChallengeUserId(db: Database, token: string): Promise<string | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select()
    .from(mfaChallenges)
    .where(eq(mfaChallenges.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(mfaChallenges).where(eq(mfaChallenges.id, row.id))
    return null
  }
  return row.userId
}

export async function deleteMfaChallenge(db: Database, token: string): Promise<void> {
  await db.delete(mfaChallenges).where(eq(mfaChallenges.tokenHash, hashSecret(token)))
}
