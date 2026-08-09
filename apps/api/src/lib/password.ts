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
