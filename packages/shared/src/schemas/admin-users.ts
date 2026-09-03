import { z } from 'zod'
import { userRoleSchema } from './common.js'

/**
 * Backs `GET/PATCH/DELETE /admin/users` (apps/api/src/routes/admin-users.ts,
 * M4, docs/TODO_ARCHIVE.md), the admin-only counterpart to `userSchema`
 * (./auth.js). Deliberately its own schema rather than a widened
 * `userSchema`: this is shown to an admin looking at *someone else's*
 * account, so it carries `email` (never sent for another user via
 * `userSchema`, which only ever describes the caller's own session) and
 * two fields computed per request rather than stored anywhere -
 * `mfaEnabled` (a `user_totp.confirmedAt IS NOT NULL` check) and
 * `sessionCount` (a grouped count on `sessions`) - so an admin can see
 * "is this account actually protected, and does it have live sessions"
 * without a separate round trip per row.
 */
export const adminUserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
  emailVerifiedAt: z.string().datetime().nullable(),
  mfaEnabled: z.boolean(),
  sessionCount: z.number().int(),
})
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>

export const listAdminUsersResponseSchema = z.object({
  users: z.array(adminUserSummarySchema),
})
export type ListAdminUsersResponse = z.infer<typeof listAdminUsersResponseSchema>

/** `PATCH /admin/users/{id}` — promote/demote. The last-admin invariant
 * (an instance can never reach zero admins) is enforced server-side, not
 * expressible here. */
export const updateUserRoleRequestSchema = z.object({
  role: userRoleSchema,
})
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>
