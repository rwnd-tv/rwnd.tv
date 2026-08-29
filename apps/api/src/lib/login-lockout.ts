import { eq, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { loginAttempts } from '@rwnd/db'

/** Failures before backoff kicks in at all — a real user mistyping their
 * password a couple of times should never see this. */
const FREE_ATTEMPTS = 5
const BASE_BACKOFF_MS = 30 * 1000 // 30s
const MAX_BACKOFF_MS = 15 * 60 * 1000 // 15min

/** Doubles per failure past FREE_ATTEMPTS, capped at MAX_BACKOFF_MS:
 * 30s, 60s, 120s, ... — slow enough to make automated password guessing
 * against one account impractical without ever fully locking a real
 * user out (the wait is per-attempt, not a hard ban). */
function backoffMs(failedCount: number): number {
  if (failedCount < FREE_ATTEMPTS) return 0
  return Math.min(BASE_BACKOFF_MS * 2 ** (failedCount - FREE_ATTEMPTS), MAX_BACKOFF_MS)
}

/**
 * Keyed by the *attempted* email, not a user id — see login_attempts'
 * doc comment in packages/db/src/schema.ts for why this has to behave
 * identically whether or not the email belongs to a real account.
 * `citext` makes the lookup case-insensitive at the DB level, same as
 * `users.email`, so no manual normalization is needed here.
 */
export async function isLoginLocked(db: Database, email: string): Promise<boolean> {
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1)
  if (!row) return false
  const wait = backoffMs(row.failedCount)
  if (wait === 0) return false
  return Date.now() < row.lastFailedAt.getTime() + wait
}

export async function recordFailedLogin(db: Database, email: string): Promise<void> {
  await db
    .insert(loginAttempts)
    .values({ email, failedCount: 1, lastFailedAt: new Date() })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: { failedCount: sql`${loginAttempts.failedCount} + 1`, lastFailedAt: new Date() },
    })
}

/** Called on a successful login — clears the backoff so a real user who
 * mistyped a few times isn't left slowed down after getting it right. */
export async function clearLoginAttempts(db: Database, email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email))
}
