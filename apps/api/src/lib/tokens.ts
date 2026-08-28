import { randomBytes, createHash } from 'node:crypto'

/** A high-entropy opaque secret, suitable for session cookies or API tokens. */
export function generateSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/** One-way hash for storing secrets at rest — lookups compare hashes, never raw values. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

const API_TOKEN_PREFIX = 'rwnd_'

export function generateApiToken(): { token: string; hash: string } {
  const token = API_TOKEN_PREFIX + generateSecret(32)
  return { token, hash: hashSecret(token) }
}
