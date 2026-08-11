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
