import { z } from 'zod'

/**
 * `registration_mode: 'invite'` (see schemas/settings.ts) needs invite
 * codes to actually exist somewhere — this is the admin-facing half.
 * Redemption lives in `POST /auth/register` (apps/api/src/routes/auth.ts);
 * these back `POST/GET/DELETE /invites` (apps/api/src/routes/invites.ts),
 * admin-only.
 *
 * `status` is computed from `usedBy`/`expiresAt`, not stored — there's no
 * separate `used`/`expired` column on the `invites` table
 * (packages/db/src/schema.ts), just the two columns redemption already
 * needs.
 */
export const inviteStatusSchema = z.enum(['pending', 'used', 'expired'])
export type InviteStatus = z.infer<typeof inviteStatusSchema>

export const inviteSummarySchema = z.object({
  id: z.string().uuid(),
  status: inviteStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})
export type InviteSummary = z.infer<typeof inviteSummarySchema>

export const listInvitesResponseSchema = z.object({
  invites: z.array(inviteSummarySchema),
})
export type ListInvitesResponse = z.infer<typeof listInvitesResponseSchema>

/** `email`, if given, is an address the admin types in — not selected from
 * any directory (this instance may not even have any other users yet,
 * the whole point of an invite). Only the plaintext code is ever
 * emailed, so — same reasoning as the webhook link code's own request
 * schema (`./tokens.js`) — emailing happens as part of creating the
 * invite, not as a separate "resend" action against an already-created
 * one. Ignored, rather than rejected, if email isn't configured on this
 * instance; the response's `emailSent` says what actually happened. */
export const createInviteRequestSchema = z.object({
  email: z.string().trim().email().optional(),
})
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>

/** `code` is the plaintext invite code — shown exactly once, on creation.
 * Only `codeHash` is ever stored (packages/db/src/schema.ts), same
 * "present once, hashed thereafter" shape as a session token or API
 * token. `emailSent` is false both when no `email` was given and when a
 * given one failed to send (best-effort, matching every sender in
 * `apps/api/src/lib/email.ts`) — the code itself is always returned
 * either way. */
export const createInviteResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  expiresAt: z.string().datetime(),
  emailSent: z.boolean(),
})
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>
