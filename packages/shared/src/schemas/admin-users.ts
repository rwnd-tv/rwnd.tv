import { z } from 'zod'
import { assignableRoleSchema, userRoleSchema } from './common.js'

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

/** `PATCH /admin/users/{id}` — promote/demote. `role` is `assignableRoleSchema`,
 * not the full `userRoleSchema`: `owner` can never be set here, only through
 * `POST /auth/me/transfer-ownership` (routes/auth.ts). The last-admin
 * invariant (an instance can never reach zero admins) and the "can't touch
 * the owner" guard are both enforced server-side, not expressible here. */
export const updateUserRoleRequestSchema = z.object({
  role: assignableRoleSchema,
})
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>

/** `POST /auth/me/transfer-ownership` (routes/auth.ts) — the current owner
 * hands the role to an existing admin, demoting themselves to `admin` in
 * the same atomic action. `currentPassword` re-proves identity, same
 * reasoning as `deleteAccountRequestSchema` (./auth.js): this is the
 * single highest-privilege action in the app. */
export const transferOwnershipRequestSchema = z.object({
  targetUserId: z.string().uuid(),
  currentPassword: z.string().min(1).max(256),
})
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequestSchema>
