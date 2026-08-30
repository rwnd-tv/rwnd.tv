import { randomInt } from 'node:crypto'
import { hashSecret } from './tokens.js'

// Excludes visually ambiguous characters (0/O, 1/I/L) — these are meant to
// be typed by hand from a printed/saved list, unlike generateSecret()'s
// base64url output (lib/tokens.ts), which is only ever copy-pasted.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10
const RECOVERY_CODE_COUNT = 10

function generateOne(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)]
  }
  // Hyphenated for readability — purely cosmetic, stripped before hashing/
  // comparison (see hashRecoveryCode below) so it's not load-bearing.
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

/** 10 codes at ~32^10 (≈2^50) of entropy each — comparable to a strong
 * password, and each one single-use (`user_recovery_codes.usedAt`,
 * packages/db/src/schema.ts) so a leaked, already-spent code is inert. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateOne)
}

/** Same unsalted-SHA-256 reasoning as `hashSecret` in lib/tokens.ts — every
 * input is one of these CSPRNG-generated codes, never a human-chosen
 * value, so there's no dictionary/brute-force surface a salt would defend
 * against. Normalizes case and strips the hyphen first so a user retyping
 * a code without it (or in lowercase) still matches. */
export function hashRecoveryCode(code: string): string {
  return hashSecret(code.toUpperCase().replace(/-/g, ''))
}
