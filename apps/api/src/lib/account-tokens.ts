import { eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { passwordResetTokens, emailVerificationTokens, emailChangeTokens } from '@rwnd/db'
import { generateSecret, hashSecret } from './tokens.js'

// Reassessed against ASVS V2.7.2's 10-minute out-of-band guidance (M3
// security review follow-up, docs/TODO.md) and kept at 1h: that guidance is
// aimed at a true out-of-band channel (SMS, push, a hardware token) the user
// is expected to be looking at right now, not an emailed link — email
// delivery itself can lag, and a user may not open their inbox immediately
// after requesting a reset. 1h stays the better usability/security tradeoff
// for this channel; revisit only if this ever moves off email.
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 1 hour
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
// 1 hour, same as a password reset — not verification's 24h. This is
// confirming a brand-new address someone's presumably checking right now
// to complete an in-progress change, not an arbitrary-timing follow-up to
// a registration from a while ago.
export const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000

export async function createPasswordResetToken(db: Database, userId: string): Promise<string> {
  const token = generateSecret(32)
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  })
  return token
}

/** Deletes the token whether it was valid or not — single-use either way,
 * so there's nothing to gain by keeping a spent or expired row around
 * (unlike `invites`, this has no `usedBy` accountability need — see
 * packages/db/src/schema.ts's doc comment). Returns the token's `userId`
 * on success, `null` if the token doesn't exist or had already expired. */
export async function redeemPasswordResetToken(
  db: Database,
  token: string,
): Promise<string | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, row.id))
  if (row.expiresAt.getTime() < Date.now()) return null
  return row.userId
}

/** Drops any token already outstanding for this user first — see
 * emailVerificationTokens' doc comment in schema.ts on why (keeps a
 * previously-emailed link from staying valid once a newer one's been sent,
 * rather than leaving both live). */
export async function createEmailVerificationToken(db: Database, userId: string): Promise<string> {
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId))
  const token = generateSecret(32)
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  })
  return token
}

/** Same delete-on-redemption-attempt shape as redeemPasswordResetToken above. */
export async function redeemEmailVerificationToken(
  db: Database,
  token: string,
): Promise<string | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, row.id))
  if (row.expiresAt.getTime() < Date.now()) return null
  return row.userId
}

/** Same "drop any outstanding token for this user first" reasoning as
 * createEmailVerificationToken above. */
export async function createEmailChangeToken(
  db: Database,
  userId: string,
  newEmail: string,
): Promise<string> {
  await db.delete(emailChangeTokens).where(eq(emailChangeTokens.userId, userId))
  const token = generateSecret(32)
  await db.insert(emailChangeTokens).values({
    userId,
    newEmail,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
  })
  return token
}

/** Same delete-on-redemption-attempt shape as the other redeem*Token
 * functions above, but returns the pending `newEmail` alongside the
 * `userId` — the caller (POST /auth/confirm-email-change) still needs to
 * re-check it's not been claimed by someone else since the token was
 * issued before actually writing it to `users.email`. */
export async function redeemEmailChangeToken(
  db: Database,
  token: string,
): Promise<{ userId: string; newEmail: string } | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select()
    .from(emailChangeTokens)
    .where(eq(emailChangeTokens.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null
  await db.delete(emailChangeTokens).where(eq(emailChangeTokens.id, row.id))
  if (row.expiresAt.getTime() < Date.now()) return null
  return { userId: row.userId, newEmail: row.newEmail }
}
