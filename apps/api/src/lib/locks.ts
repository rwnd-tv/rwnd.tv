import { sql } from 'drizzle-orm'
import type { Tx } from '@rwnd/db'

/**
 * Takes a Postgres advisory lock scoped to `(userId, scopeKey)` for the
 * rest of the enclosing transaction — the shared primitive behind every
 * "read-then-write, must not race a concurrent write for the same user"
 * invariant in this codebase (a watch-history reconciliation in
 * `lib/plays.ts`, a webhook-source claim in `lib/webhook-accounts.ts`).
 *
 * `pg_advisory_xact_lock` (the transaction-scoped variant, not the session
 * one) releases automatically on commit or rollback — no manual unlock
 * needed, and no risk of leaking a held lock if the transaction throws.
 * `hashtext()` collisions between two different `(userId, scopeKey)` pairs
 * are possible but harmless: advisory locks are pure mutual exclusion, not
 * data, so a collision at worst makes two unrelated requests briefly wait
 * on each other, never a correctness issue. This is why the lock is
 * database-held rather than an in-process mutex: it holds even if this app
 * ever ran as more than one process sharing this Postgres, with no extra
 * coordination required.
 *
 * Callers keep their own domain-typed wrapper (`lockEntity`,
 * `lockUserSource`) rather than calling this directly, so a call site's own
 * race narrative and its argument's real type stay documented next to the
 * code that actually needs the lock.
 */
export async function lockUserScope(tx: Tx, userId: string, scopeKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${scopeKey}))`)
}
