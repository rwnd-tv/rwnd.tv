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

/** `code` is the plaintext invite code — shown exactly once, on creation.
 * Only `codeHash` is ever stored (packages/db/src/schema.ts), same
 * "present once, hashed thereafter" shape as a session token or API
 * token. */
export const createInviteResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  expiresAt: z.string().datetime(),
})
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>
