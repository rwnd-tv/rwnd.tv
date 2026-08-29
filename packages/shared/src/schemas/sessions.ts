import { z } from 'zod'

/**
 * One row in the account Sessions panel (GET /auth/me/sessions) — never
 * the session token itself, only what the UI needs to let someone
 * recognize and revoke a session. `current` is computed by the route
 * (apps/api/src/routes/auth.ts), not stored — a session token can't be
 * reversed back to an id without a DB round-trip, so the route compares
 * the caller's own session id against each row's id rather than this
 * schema carrying anything token-shaped.
 */
export const sessionSummarySchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  current: z.boolean(),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
})
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>
