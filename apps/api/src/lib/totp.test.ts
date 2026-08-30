import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp.js'

// RFC 6238 Appendix B's own published test vectors — SHA1 mode, 8-digit
// codes, the ASCII secret "12345678901234567890" repeated as needed for
// longer key lengths in the RFC (only the SHA1 case is used here, since
// that's this codebase's only mode). Reproducing these exactly is what
// makes owning this implementation (rather than trusting "it works with my
// phone") defensible — a subtle truncation-offset or byte-order bug would
// fail every one of these, not just look slightly off.
const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'))

describe('base32Encode / base32Decode', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from(RFC_SECRET_ASCII, 'ascii')
    expect(base32Decode(base32Encode(original))).toEqual(original)
  })

  it('is case-insensitive and ignores non-alphabet characters on decode', () => {
    const encoded = base32Encode(Buffer.from('hello'))
    expect(base32Decode(encoded.toLowerCase())).toEqual(base32Decode(encoded))
    expect(base32Decode(`${encoded}=`)).toEqual(base32Decode(encoded))
  })
})

describe('hotp / generateTotp — RFC 6238 Appendix B vectors (SHA1, 8 digits)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i produces %s', (unixSeconds, expected) => {
    expect(generateTotp(RFC_SECRET_BASE32, unixSeconds * 1000, 8)).toBe(expected)
  })
})

describe('verifyTotp', () => {
  const secret = generateTotpSecret()
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)

  it('accepts the current step’s code', () => {
    const code = generateTotp(secret, now)
    expect(verifyTotp(secret, code, now)).toBe(true)
  })

  it('accepts a code from one step earlier or later (clock skew)', () => {
    const previous = generateTotp(secret, now - 30_000)
    const next = generateTotp(secret, now + 30_000)
    expect(verifyTotp(secret, previous, now)).toBe(true)
    expect(verifyTotp(secret, next, now)).toBe(true)
  })

  it('rejects a code from two steps away — outside the window', () => {
    const tooOld = generateTotp(secret, now - 60_000)
    const tooNew = generateTotp(secret, now + 60_000)
    expect(verifyTotp(secret, tooOld, now)).toBe(false)
    expect(verifyTotp(secret, tooNew, now)).toBe(false)
  })

  it('rejects a wrong code outright', () => {
    const code = generateTotp(secret, now)
    const wrong = code === '000000' ? '111111' : '000000'
    expect(verifyTotp(secret, wrong, now)).toBe(false)
  })

  it('rejects a code for a different secret', () => {
    const otherSecret = generateTotpSecret()
    const code = generateTotp(otherSecret, now)
    expect(verifyTotp(secret, code, now)).toBe(false)
  })

  it('rejects malformed input without throwing (non-digits, wrong length)', () => {
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false)
    expect(verifyTotp(secret, '12345', now)).toBe(false)
    expect(verifyTotp(secret, '1234567', now)).toBe(false)
    expect(verifyTotp(secret, '', now)).toBe(false)
  })
})

describe('generateTotpSecret', () => {
  it('produces a fresh, valid base32 secret each time', () => {
    const a = generateTotpSecret()
    const b = generateTotpSecret()
    expect(a).not.toBe(b)
    expect(() => base32Decode(a)).not.toThrow()
    // 160 bits = 20 bytes, RFC 6238's recommended SHA1 key length.
    expect(base32Decode(a)).toHaveLength(20)
  })
})

describe('otpauthUri', () => {
  it('includes the secret, issuer, and account name', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=rwnd.tv')
    expect(decodeURIComponent(uri)).toContain('user@example.com')
  })
})
