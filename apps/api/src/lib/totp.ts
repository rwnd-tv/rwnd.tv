import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * RFC 6238 TOTP (M3 security review follow-up, ASVS V4.3.1, docs/TODO.md),
 * built on `node:crypto` rather than a library — the primitives (HMAC-SHA1,
 * a CSPRNG, constant-time comparison) all come from there; what's actually
 * written here is the small amount of RFC-specified glue around them
 * (base32, dynamic truncation, the time-step window). Verified against
 * RFC 6238 Appendix B's own published test vectors in totp.test.ts,
 * including reject cases (wrong code, a step outside the window) — not
 * just "it works with my phone".
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
// ±1 step (30s either side) for clock skew between server and authenticator
// app — wide enough to absorb ordinary drift, narrow enough that it's not
// meaningfully easier to guess than a single step would be.
const WINDOW_STEPS = 1

export function base32Encode(buffer: Buffer): string {
  let bits = ''
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  let output = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)]
  }
  const remainder = bits.length % 5
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0')
    output += BASE32_ALPHABET[Number.parseInt(lastChunk, 2)]
  }
  return output
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error(`Invalid base32 character: ${char}`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** RFC 4226 HOTP — the counter-based primitive TOTP (RFC 6238) layers a
 * time-derived counter on top of. Not exported: every real call site goes
 * through generateTotp/verifyTotp below, which fix the digit count and
 * derive the counter from wall-clock time. */
function hotp(secret: Buffer, counter: number, digits: number = DIGITS): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return (binCode % 10 ** digits).toString().padStart(digits, '0')
}

function timeStep(atMs: number): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS)
}

/** A fresh random 160-bit secret (RFC 6238's recommended length for
 * HMAC-SHA1), base32-encoded — the form both `otpauthUri` below and every
 * authenticator app expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Exposed for totp.test.ts's RFC 6238 vector checks — every real caller
 * uses the 6-digit default. */
export function generateTotp(
  base32Secret: string,
  atMs: number = Date.now(),
  digits = DIGITS,
): string {
  return hotp(base32Decode(base32Secret), timeStep(atMs), digits)
}

/** Accepts a code from the current step or one step either side (clock
 * skew) — never more than that; widening the window trades security for
 * convenience faster than it's worth. Constant-time comparison per
 * candidate so a timing side-channel can't narrow down which digits are
 * right. */
export function verifyTotp(base32Secret: string, code: string, atMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const secret = base32Decode(base32Secret)
  const current = timeStep(atMs)
  const codeBuffer = Buffer.from(code)
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset++) {
    const candidate = Buffer.from(hotp(secret, current + offset))
    if (timingSafeEqual(candidate, codeBuffer)) return true
  }
  return false
}

/** The `otpauth://` URI an authenticator app's QR-code scanner (or manual
 * "enter a setup key" flow) expects — RFC unofficial but universally
 * supported. `accountName` is shown in the app next to the issuer, so a
 * user with multiple rwnd.tv accounts (or instances) can tell them apart —
 * this project uses the account's email. */
export function otpauthUri(secret: string, accountName: string, issuer = 'rwnd.tv'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`
}
