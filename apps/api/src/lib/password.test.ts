import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword, verifyDummyPassword } from './password.js'

describe('password hashing', () => {
  it('round-trips a real password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true)
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false)
  })
})

describe('verifyDummyPassword (M3 security review, F-12)', () => {
  it('resolves without throwing, for any input', async () => {
    await expect(verifyDummyPassword('whatever12345')).resolves.toBeUndefined()
    await expect(verifyDummyPassword('')).resolves.toBeUndefined()
  })

  it('does real Argon2id work — takes comparable time to a real verify, not near-zero', async () => {
    // Not a strict equality assertion (timing tests are inherently
    // noisy) — just confirms this isn't a no-op that returns instantly,
    // which is the actual property POST /auth/login's unknown-email
    // branch depends on.
    const hash = await hashPassword('correct-horse-battery-staple')

    const realStart = performance.now()
    await verifyPassword(hash, 'wrong-password')
    const realMs = performance.now() - realStart

    const dummyStart = performance.now()
    await verifyDummyPassword('wrong-password')
    const dummyMs = performance.now() - dummyStart

    // Generous floor — this only needs to catch "returns instantly
    // without hashing at all" (which would be ~0ms), not assert precise
    // parity with realMs.
    expect(dummyMs).toBeGreaterThan(realMs * 0.3)
  })
})
