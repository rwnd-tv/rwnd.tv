import { z } from 'zod'

/**
 * TOTP MFA (M3 security review follow-up, ASVS V4.3.1, docs/TODO.md) —
 * opt-in, any user. `apps/api/src/routes/mfa.ts` (enroll/confirm/disable/
 * regenerate-recovery-codes, all requiring an existing session) and the
 * two-step login exchange in `apps/api/src/routes/auth.ts`
 * (`POST /auth/login` → `POST /auth/login/mfa`).
 */

export const enrollTotpResponseSchema = z.object({
  /** Base32 — shown as a fallback for manual entry alongside the QR code
   * built from `otpauthUri`. Not yet active: confirmTotpRequestSchema
   * below has to succeed first. */
  secret: z.string(),
  otpauthUri: z.string(),
})
export type EnrollTotpResponse = z.infer<typeof enrollTotpResponseSchema>

export const confirmTotpRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
})
export type ConfirmTotpRequest = z.infer<typeof confirmTotpRequestSchema>

/** Shown exactly once, same as an invite code or API token. */
export const confirmTotpResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
})
export type ConfirmTotpResponse = z.infer<typeof confirmTotpResponseSchema>

/** Same re-prove-you're-you shape as changing a password — `code` accepts
 * either a current 6-digit TOTP code or an unused recovery code, since a
 * user disabling MFA because they lost their authenticator app wouldn't
 * have a TOTP code to give. */
export const disableTotpRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  code: z.string().min(1),
})
export type DisableTotpRequest = z.infer<typeof disableTotpRequestSchema>

// Regenerating recovery codes needs exactly the same "prove you're you"
// input, and returns the same "here are 10 fresh codes, shown once" shape
// as confirming enrollment — reusing disableTotpRequestSchema/
// confirmTotpResponseSchema directly (routes/mfa.ts, api-client.ts) rather
// than exporting identical schemas under new names.
export type RegenerateRecoveryCodesRequest = DisableTotpRequest
export type RegenerateRecoveryCodesResponse = ConfirmTotpResponse

export const totpStatusSchema = z.object({
  enabled: z.boolean(),
})
export type TotpStatus = z.infer<typeof totpStatusSchema>

/** POST /auth/login returns this instead of the usual `User` body when the
 * account has TOTP confirmed — no session cookie is set yet. The client
 * exchanges `challengeToken` (opaque, single-use, 5-minute TTL) plus a code
 * at POST /auth/login/mfa for the real session. */
export const mfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
})
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>

export const loginMfaRequestSchema = z.object({
  challengeToken: z.string(),
  /** Either a 6-digit TOTP code or an unused recovery code — same
   * either-or shape as disableTotpRequestSchema's `code` above. */
  code: z.string().min(1),
})
export type LoginMfaRequest = z.infer<typeof loginMfaRequestSchema>
