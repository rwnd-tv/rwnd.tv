import { randomBytes, createHash } from 'node:crypto'
import { encryptSecret } from './crypto.js'

/** A high-entropy opaque secret, suitable for session cookies or API tokens. */
export function generateSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/**
 * One-way hash for storing secrets at rest — lookups compare hashes, never
 * raw values. Unsalted SHA-256 is deliberate, not a shortcut: every caller
 * passes a 256-bit CSPRNG value from `generateSecret()` above, never a
 * human-chosen password, so there's no dictionary/brute-force surface a
 * salt or a slow KDF would defend against. Passwords use Argon2id instead
 * (`lib/password.ts`) — see `docs/adr/0007-security-posture.md`'s "Bearer
 * secrets are hashed, not encrypted" section.
 *
 * CodeQL's `js/insufficient-password-hash` (alert #1) flags this as a weak
 * password hash — a false positive dismissed for the same reason: it can't
 * see that `secret` is never a password.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

const API_TOKEN_PREFIX = 'rwnd_'

/** `encryptionKey` is `loadEnv().ENCRYPTION_KEY`, passed in rather than
 * loaded here — optional, so `encrypted` is only ever produced when the
 * caller actually has one to give. See `apiTokens.tokenEncrypted`'s doc
 * comment (packages/db/src/schema.ts) for why a webhook token's secret
 * is durably recoverable only when this instance has one configured. */
export function generateApiToken(encryptionKey?: string): {
  token: string
  hash: string
  encrypted: string | null
} {
  const token = API_TOKEN_PREFIX + generateSecret(32)
  return {
    token,
    hash: hashSecret(token),
    encrypted: encryptionKey ? encryptSecret(token, encryptionKey) : null,
  }
}
