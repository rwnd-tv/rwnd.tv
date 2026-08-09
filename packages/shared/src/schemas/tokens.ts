import { z } from 'zod'

export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
})
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>

export const apiTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ApiToken = z.infer<typeof apiTokenSchema>

/** Returned exactly once, at creation time. Only the hash is ever stored. */
export const createApiTokenResponseSchema = apiTokenSchema.extend({
  token: z.string(),
})
export type CreateApiTokenResponse = z.infer<typeof createApiTokenResponseSchema>
