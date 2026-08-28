import { z } from 'zod'
import { uuidSchema } from './common.js'

export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
})
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>

export const apiTokenSchema = z.object({
  id: uuidSchema,
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

export const webhookSourceSchema = z.enum(['plex'])
export type WebhookSource = z.infer<typeof webhookSourceSchema>

/** One external account (e.g. a Plex user) seen on this token's webhook,
 * and which rwnd.tv user — if any — its plays should log against. See
 * `packages/db/src/schema.ts`'s `webhookAccountLinks` doc comment for why
 * one token can have several of these. `userId` null means seen but not
 * yet claimed. */
export const webhookAccountLinkSchema = z.object({
  id: uuidSchema,
  source: webhookSourceSchema,
  externalAccountId: z.string(),
  externalAccountName: z.string(),
  userId: uuidSchema.nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
})
export type WebhookAccountLink = z.infer<typeof webhookAccountLinkSchema>

/** Just enough to populate a claim dropdown — deliberately not a general
 * "list all users" shape (no email/role/etc.), since that's more exposure
 * than this feature needs. */
export const assignableUserSchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
})
export type AssignableUser = z.infer<typeof assignableUserSchema>

export const listWebhookLinksResponseSchema = z.object({
  links: z.array(webhookAccountLinkSchema),
  assignableUsers: z.array(assignableUserSchema),
})
export type ListWebhookLinksResponse = z.infer<typeof listWebhookLinksResponseSchema>

/** `userId: null` clears a claim back to unclaimed. */
export const updateWebhookLinkRequestSchema = z.object({
  userId: uuidSchema.nullable(),
})
export type UpdateWebhookLinkRequest = z.infer<typeof updateWebhookLinkRequestSchema>
