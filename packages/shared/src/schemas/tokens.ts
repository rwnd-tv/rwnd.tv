import { z } from 'zod'
import { uuidSchema } from './common.js'

export const webhookSourceSchema = z.enum(['plex', 'jellyfin', 'emby', 'tautulli'])
export type WebhookSource = z.infer<typeof webhookSourceSchema>

/** Untranslated proper nouns, one source of truth shared by the API (email
 * copy) and web (settings UI) — same convention as
 * `apps/web/src/lib/provider-labels.ts`. Typed as a `Record` over the full
 * enum so a source added to `webhookSourceSchema` without a label here is
 * a compile error. */
export const WEBHOOK_SOURCE_LABELS: Record<WebhookSource, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  tautulli: 'Tautulli',
}

/** `source` is the server picked in the create wizard's first step —
 * display-only, not an ingestion constraint; see `apiTokens.source`'s own
 * doc comment (packages/db/src/schema.ts). */
export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  source: webhookSourceSchema,
})
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>

/** `source` is nullable only for a token created before this column
 * existed and never backfilled (no webhook delivery to infer it from) —
 * see the migration that added it. `token` is the decrypted webhook
 * secret, re-derivable only when this instance has `ENCRYPTION_KEY`
 * configured *and* this particular row was created or regenerated while
 * it was; null otherwise, meaning Settings can't redisplay a URL for it
 * without a regenerate first. Every source's webhook URL is
 * `{origin}/api/v1/webhooks/{source}/{token}` — the API never returns a
 * pre-built URL, since the web app already knows how to build one from
 * `window.location.origin`. */
export const apiTokenSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  source: webhookSourceSchema.nullable(),
  token: z.string().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ApiToken = z.infer<typeof apiTokenSchema>

/** Create and regenerate both always know the plaintext token — it was
 * just generated in this same request — so `token` is guaranteed
 * non-null here regardless of whether it's durably recoverable later.
 * Reused as-is for `POST /tokens/{id}/regenerate`'s response too:
 * regenerating is really "issue a new secret for this same row," the
 * same shape as creating one. */
export const createApiTokenResponseSchema = apiTokenSchema.extend({
  token: z.string(),
})
export type CreateApiTokenResponse = z.infer<typeof createApiTokenResponseSchema>

/** `PATCH /tokens/{id}` — the only field settable after creation.
 * Exists solely to let a pre-migration token (`source: null`, never
 * backfilled) be assigned one from Settings, without forcing a
 * revoke-and-recreate that would lose its detected accounts. */
export const updateApiTokenRequestSchema = z.object({
  source: webhookSourceSchema,
})
export type UpdateApiTokenRequest = z.infer<typeof updateApiTokenRequestSchema>

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
