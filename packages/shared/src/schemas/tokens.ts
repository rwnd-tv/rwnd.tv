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
 * yet linked; `userDisplayName` is only ever set alongside it, so the UI
 * doesn't need a separate "list every user" call to show a linked
 * link's name (see the link-code rework, `docs/adr/0007-security-posture.md`'s
 * addendum, for why there's no such call any more). `callerCanLinkAsSelf`
 * is true only when this link is unlinked *and* the caller (viewing
 * this token's own links) doesn't already have a different account of
 * this same source linked to themselves elsewhere — one rwnd.tv user
 * maps to at most one account per source
 * (`apps/api/src/lib/webhook-accounts.ts`'s `hasLinkedSource`), so
 * "This is me" only ever appears when it's actually offerable; the API
 * enforces the same rule independently, this isn't just a UI hint. */
export const webhookAccountLinkSchema = z.object({
  id: uuidSchema,
  source: webhookSourceSchema,
  externalAccountId: z.string(),
  externalAccountName: z.string(),
  userId: uuidSchema.nullable(),
  userDisplayName: z.string().nullable(),
  callerCanLinkAsSelf: z.boolean(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
})
export type WebhookAccountLink = z.infer<typeof webhookAccountLinkSchema>

export const listWebhookLinksResponseSchema = z.object({
  links: z.array(webhookAccountLinkSchema),
})
export type ListWebhookLinksResponse = z.infer<typeof listWebhookLinksResponseSchema>

/** `email`, if given, is an address the token owner *types in* — not
 * selected from any directory, so this never discloses which addresses
 * actually have accounts. Only the plaintext code is ever emailed
 * (nothing is persisted to email later — see the response below), so
 * emailing happens as part of generating the code, not as a separate
 * "resend" action against an already-generated one. Ignored, rather than
 * rejected, if email isn't configured on this instance — the response's
 * `emailSent` says what actually happened. */
export const createWebhookLinkCodeRequestSchema = z.object({
  email: z.string().trim().email().optional(),
})
export type CreateWebhookLinkCodeRequest = z.infer<typeof createWebhookLinkCodeRequestSchema>

/** `code` is the plaintext code, shown exactly once, same "present once,
 * hashed thereafter" contract as `createInviteResponseSchema`
 * (`./invites.js`). Generating a new code for a link supersedes any
 * prior unused one. `emailSent` is false both when no `email` was given
 * and when a given one failed to send (best-effort, matching every other
 * sender in `apps/api/src/lib/email.ts`) — the caller can't tell those
 * apart from this alone, which is fine: the code itself is always
 * returned either way. */
export const createWebhookLinkCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string().datetime(),
  emailSent: z.boolean(),
})
export type CreateWebhookLinkCodeResponse = z.infer<typeof createWebhookLinkCodeResponseSchema>

/** `POST /webhook-links/redeem` — session-authenticated as whoever is
 * redeeming, so this only ever needs the code itself, not a target user. */
export const redeemWebhookLinkRequestSchema = z.object({
  code: z.string(),
})
export type RedeemWebhookLinkRequest = z.infer<typeof redeemWebhookLinkRequestSchema>
