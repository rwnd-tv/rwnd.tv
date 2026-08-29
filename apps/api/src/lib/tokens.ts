import { randomBytes, createHash } from 'node:crypto'

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

export function generateApiToken(): { token: string; hash: string } {
  const token = API_TOKEN_PREFIX + generateSecret(32)
  return { token, hash: hashSecret(token) }
}
