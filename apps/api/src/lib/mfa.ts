import { and, eq, isNull } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { userTotp, userRecoveryCodes } from '@rwnd/db'
import { hashRecoveryCode } from './recovery-codes.js'

export async function getUserTotp(db: Database, userId: string) {
  const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1)
  return row ?? null
}

/** Enrollment (or re-enrollment of an unconfirmed attempt) — always writes
 * `confirmedAt: null`, even on conflict, so overwriting a *confirmed* row
 * this way would silently disable MFA without going through disable's
 * password+code check. The caller (routes/mfa.ts) is responsible for
 * refusing to call this at all when `getUserTotp` already shows a
 * confirmed row. */
export async function upsertUnconfirmedTotp(
  db: Database,
  userId: string,
  secretEncrypted: string,
): Promise<void> {
  await db
    .insert(userTotp)
    .values({ userId, secretEncrypted })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secretEncrypted, confirmedAt: null } })
}

/** Confirms enrollment and (re)generates recovery codes in one transaction
 * — a partial state (confirmed but no recovery codes, or vice versa) would
 * leave a user with no way to recover from a lost device. `hashedCodes` is
 * computed by the caller (routes/mfa.ts) so this function never sees the
 * plaintext codes it doesn't need. */
export async function confirmTotpAndSetRecoveryCodes(
  db: Database,
  userId: string,
  hashedCodes: string[],
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    await tx.update(userTotp).set({ confirmedAt: new Date() }).where(eq(userTotp.userId, userId))
    await replaceRecoveryCodes(tx, userId, hashedCodes)
  })
}

export async function replaceRecoveryCodes(
  db: Database | Tx,
  userId: string,
  hashedCodes: string[],
): Promise<void> {
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId))
  if (hashedCodes.length > 0) {
    await db.insert(userRecoveryCodes).values(hashedCodes.map((codeHash) => ({ userId, codeHash })))
  }
}

/** Disabling removes recovery codes too, in the same transaction — they're
 * meaningless without an active TOTP enrollment to be a second factor for. */
export async function deleteTotp(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(userTotp).where(eq(userTotp.userId, userId))
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId))
  })
}

/** Marks one unused recovery code as spent and returns whether a matching
 * one was found — never returns which code, or how many remain, to the
 * caller beyond that boolean (routes/mfa.ts logs only opaque ids). */
export async function consumeRecoveryCode(
  db: Database,
  userId: string,
  code: string,
): Promise<boolean> {
  const codeHash = hashRecoveryCode(code)
  const [row] = await db
    .select({ id: userRecoveryCodes.id })
    .from(userRecoveryCodes)
    .where(
      and(
        eq(userRecoveryCodes.userId, userId),
        eq(userRecoveryCodes.codeHash, codeHash),
        isNull(userRecoveryCodes.usedAt),
      ),
    )
    .limit(1)
  if (!row) return false
  await db
    .update(userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(eq(userRecoveryCodes.id, row.id))
  return true
}
