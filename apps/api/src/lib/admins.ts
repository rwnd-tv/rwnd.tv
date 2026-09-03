import { inArray } from 'drizzle-orm'
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
 *
 * Counts `owner` alongside `admin` (M4 "owner" role work,
 * docs/TODO_ARCHIVE.md): `owner` is a strict superset of admin privileges
 * (`isAdminRole`, packages/shared/src/schemas/common.ts), so an instance
 * with one owner and one plain admin already has an owner fully capable of
 * administering it — demoting/deleting that one plain admin down to zero
 * *plain admins* is fine and should succeed, not 400 as "last admin". The
 * owner itself is separately unremovable by anyone but themselves (see
 * routes/admin-users.ts's explicit owner checks), so once an owner exists
 * this invariant is always vacuously satisfied; kept anyway as defense in
 * depth, same reasoning as the "provably unreachable" guard on
 * `DELETE /admin/users/{id}`.
 */
export async function assertNotLastAdmin(tx: Tx, targetUserId: string): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ['admin', 'owner']))
    .for('update')

  const isTargetAnAdmin = admins.some((admin) => admin.id === targetUserId)
  if (!isTargetAnAdmin) return

  const remaining = admins.filter((admin) => admin.id !== targetUserId)
  if (remaining.length === 0) {
    throw new LastAdminError()
  }
}
