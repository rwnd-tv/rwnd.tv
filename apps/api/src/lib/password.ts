import { hash, verify } from '@node-rs/argon2'

// OWASP-recommended baseline for Argon2id (2024 guidance): 19 MiB memory,
// 2 iterations, 1 degree of parallelism. Deliberately conservative so login
// stays fast on modest self-hosted hardware.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // argon2id
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  return verify(hashValue, password)
}

/**
 * A hash of a fixed, made-up password — not real credentials for any
 * account. Verifying against this does the same Argon2id work as a real
 * check without needing a real hash to check against. POST /auth/login
 * calls this on its unknown-email branch (M3 security review, F-12) so
 * "no such account" doesn't return measurably faster than "wrong
 * password" — ADR 0003 already claims login can't be used to enumerate
 * accounts, and that claim should hold on timing too, not just the
 * response body. Generated with the same ARGON2_OPTIONS above; there's
 * nothing to keep secret about it.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$SbkRPPTqu6ojMU7BUsWT+A$FOOHlGjdO+v/WTNOuXbnK7u+vzWg7anIqPN53oATF/M'

export async function verifyDummyPassword(password: string): Promise<void> {
  await verify(DUMMY_PASSWORD_HASH, password)
}
