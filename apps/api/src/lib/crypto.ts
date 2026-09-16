import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Reversible encryption for secrets that must be replayed, not just
 * compared. `lib/tokens.ts` only ever hashes (sessions, API tokens are
 * presented once and checked against a hash); Trakt OAuth access/refresh
 * tokens are different — the import job has to send them back to Trakt on
 * every request and refresh them before they expire, so they're encrypted
 * with AES-256-GCM instead of hashed. Storage format is
 * `base64(iv):base64(ciphertext):base64(authTag)`.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function keyBytes(encryptionKey: string): Buffer {
  const key = Buffer.from(encryptionKey, 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return key
}

export function encryptSecret(plaintext: string, encryptionKey: string): string {
  const key = keyBytes(encryptionKey)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, ciphertext, authTag].map((b) => b.toString('base64')).join(':')
}

export function decryptSecret(stored: string, encryptionKey: string): string {
  const key = keyBytes(encryptionKey)
  const [ivB64, ciphertextB64, authTagB64] = stored.split(':')
  if (!ivB64 || !ciphertextB64 || !authTagB64) {
    throw new Error('Malformed encrypted secret')
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

/**
 * `decryptSecret` for the "show it again if we still can" case: returns
 * null instead of throwing when the stored ciphertext can't be read. That
 * is a real scenario, not a theoretical one — rotating `ENCRYPTION_KEY` is
 * itself a legitimate response to a suspected compromise, and GCM's auth
 * tag then fails to verify against the new key. Without this, one
 * undecryptable row 500s a whole list response rather than degrading to
 * "regenerate to get a copyable URL" for that one row. Call sites:
 * `serializeToken` (routes/tokens.ts), `serializeCalendarFeed`
 * (lib/calendar-feeds.ts), and `verifyEncryptedTotp` (lib/totp.ts), which
 * treats null as a wrong code. Deliberately swallows the error rather than
 * logging it: the caller already surfaces the degraded state in the UI,
 * and the row id it would log adds nothing actionable.
 */
export function tryDecryptSecret(
  stored: string | null | undefined,
  encryptionKey: string | undefined,
): string | null {
  if (!stored || !encryptionKey) return null
  try {
    return decryptSecret(stored, encryptionKey)
  } catch {
    return null
  }
}
