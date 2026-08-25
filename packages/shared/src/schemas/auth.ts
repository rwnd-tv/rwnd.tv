import { z } from 'zod'
import { localeSchema, themeSchema, userRoleSchema } from './common.js'

export const emailSchema = z.string().trim().toLowerCase().email().max(320)

// Argon2id is applied server-side; this only guards against unusably weak
// or unusably huge input reaching the hasher.
export const passwordSchema = z.string().min(12).max(256)

export const displayNameSchema = z.string().trim().min(1).max(100)

export const setupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  /** The browser's detected UI language (i18n.language — already matched
   * against SUPPORTED_LOCALES, falling back to the default otherwise), sent
   * so the new account's `locale` starts from what the visitor's browser
   * actually reported rather than always the server-side default. */
  locale: localeSchema.optional(),
})
export type SetupRequest = z.infer<typeof setupRequestSchema>

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  inviteCode: z.string().min(1).optional(),
  /** See setupRequestSchema's `locale` for what this is and why. */
  locale: localeSchema.optional(),
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  locale: localeSchema,
  timezone: z.string(),
  theme: themeSchema,
  spoilerProtectionEnabled: z.boolean(),
  /** See packages/db/src/schema.ts's doc comment on this column — off by
   * default, so the Dashboard's On Deck row only surfaces the episode
   * right after the latest one watched, not an earlier skipped one. */
  onDeckFillGaps: z.boolean(),
  role: userRoleSchema,
  /** Null if no avatar is set. Never the image bytes/mimetype themselves —
   * just enough to build the image URL (GET /auth/me/avatar) and cache-bust
   * it after a new upload. */
  avatarUpdatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type User = z.infer<typeof userSchema>

export const updateProfileRequestSchema = z.object({
  displayName: displayNameSchema.optional(),
  locale: localeSchema.optional(),
  timezone: z.string().optional(),
  theme: themeSchema.optional(),
  spoilerProtectionEnabled: z.boolean().optional(),
  onDeckFillGaps: z.boolean().optional(),
})
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
