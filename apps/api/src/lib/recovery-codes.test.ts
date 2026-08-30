import { describe, expect, it } from 'vitest'
import { generateRecoveryCodes, hashRecoveryCode } from './recovery-codes.js'

describe('generateRecoveryCodes', () => {
  it('generates 10 hyphenated codes', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    }
  })

  it('never repeats a code across two calls (CSPRNG, not a fixture)', () => {
    const a = generateRecoveryCodes()
    const b = generateRecoveryCodes()
    expect(new Set([...a, ...b]).size).toBe(20)
  })

  it('never generates a visually ambiguous character (0/O/1/I/L)', () => {
    const codes = generateRecoveryCodes()
    for (const code of codes) {
      expect(code).not.toMatch(/[01ILO]/)
    }
  })
})

describe('hashRecoveryCode', () => {
  it('is deterministic for the same code', () => {
    const [code] = generateRecoveryCodes()
    expect(hashRecoveryCode(code!)).toBe(hashRecoveryCode(code!))
  })

  it('normalizes case and the hyphen, so retyping without them still matches', () => {
    const [code] = generateRecoveryCodes()
    const bare = code!.replace('-', '').toLowerCase()
    expect(hashRecoveryCode(bare)).toBe(hashRecoveryCode(code!))
  })

  it('produces different hashes for different codes', () => {
    const [a, b] = generateRecoveryCodes()
    expect(hashRecoveryCode(a!)).not.toBe(hashRecoveryCode(b!))
  })
})
