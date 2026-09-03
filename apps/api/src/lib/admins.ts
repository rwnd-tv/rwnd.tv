import { eq } from 'drizzle-orm'
import type { Tx } from '@rwnd/db'
import { users } from '@rwnd/db'

/** Thrown by `assertNotLastAdmin` — callers catch this to turn it into a
 * 400, distinctly from any other failure the same route might hit. */
export class LastAdminError extends Error {
  constructor() {
    super("Can't remove the last remaining admin")
  }
}

/**
 * Guards the invariant that an instance can never reach zero admins.
 * Throws `LastAdminError` if demoting or deleting `targetUserId` (an
 * admin) would leave none. Callers: `DELETE /auth/me` (self-delete),
 * and `PATCH`/`DELETE /admin/users/{id}` (routes/admin-users.ts, M4).
 *
 * Must be called inside the same transaction as the write that actually
 * removes the admin, with every admin row locked first (`for('update')`)
 * — otherwise two concurrent demotions of two different admins could
 * each see "another admin exists" and both proceed, leaving zero. Same
 * "close the read-then-write race with a real lock, not a plain select"
 * reasoning as the invite double-redemption fix (routes/auth.ts,
 * registration). A theoretical race on a self-hosted instance, but the
 * failure mode (permanently locking every admin out of instance
 * administration) is bad enough to be worth it.
 *
 * A no-op if `targetUserId` isn't currently an admin — demoting/deleting
 * an ordinary user obviously can't affect this invariant.
 */
export async function assertNotLastAdmin(tx: Tx, targetUserId: string): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .for('update')

  const isTargetAnAdmin = admins.some((admin) => admin.id === targetUserId)
  if (!isTargetAnAdmin) return

  const remaining = admins.filter((admin) => admin.id !== targetUserId)
  if (remaining.length === 0) {
    throw new LastAdminError()
  }
}
