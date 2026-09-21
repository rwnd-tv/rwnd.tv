import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  apiTokenSchema,
  createApiTokenRequestSchema,
  createApiTokenResponseSchema,
  createWebhookLinkCodeRequestSchema,
  createWebhookLinkCodeResponseSchema,
  listWebhookLinksResponseSchema,
  updateApiTokenRequestSchema,
  webhookAccountLinkSchema,
  uuidSchema,
  WEBHOOK_SOURCE_LABELS,
} from '@rwnd/shared'
import { apiTokens, instanceSettings, users, webhookAccountLinks, webhookLinkCodes } from '@rwnd/db'
import type { Database } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { generateApiToken, generateSecret, hashSecret } from '../lib/tokens.js'
import { tryDecryptSecret } from '../lib/crypto.js'
import { replayPendingWebhookEvents } from '../lib/webhook-plays.js'
import {
  hasLinkedSource,
  claimLinkForUser,
  CLAIM_FAILURE_RESPONSE,
} from '../lib/webhook-accounts.js'
import { orderedProviders } from '../providers/priority.js'
import { isEmailConfigured, sendWebhookLinkEmail } from '../lib/email.js'
import { logSecurityEvent } from '../lib/security-log.js'

export const tokenRoutes = new OpenAPIHono<AppEnv>()

// Same TTL as `invites` (apps/api/src/routes/invites.ts) — generous enough
// to actually hand off (in person, over chat, whenever the recipient gets
// around to it) without leaving a stale code valid indefinitely.
const WEBHOOK_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** `encryptionKey` is only needed to redisplay an *existing* row's URL
 * (GET /tokens) — create and regenerate below always know the plaintext
 * already, from generating it in the same request, and overwrite `token`
 * themselves rather than passing a key in here. Null `token` means either
 * this row's `tokenEncrypted` is null (no `ENCRYPTION_KEY` when the token
 * was last (re)generated, or it predates this column entirely) or it
 * couldn't be decrypted under the current key (`tryDecryptSecret`,
 * lib/crypto.ts — a rotated `ENCRYPTION_KEY`) — either way, Settings falls
 * back to "regenerate to get a copyable URL" for that one token. */
function serializeToken(row: typeof apiTokens.$inferSelect, encryptionKey?: string) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    token: tryDecryptSecret(row.tokenEncrypted, encryptionKey),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Exported for `webhook-links.ts`'s redeem route, which returns the
 * same shape once it's linked an account on the redeemer's behalf.
 * `callerCanLinkAsSelf` defaults to `false` — every other caller of
 * this function (link, unlink, redeem) is returning a link that's
 * either just been linked or is being acted on directly, not one a
 * "This is me" button would ever be offered against in the same
 * response; only the GET list route computes a real value per link. */
export function serializeLink(
  row: typeof webhookAccountLinks.$inferSelect,
  userDisplayName: string | null = null,
  callerCanLinkAsSelf = false,
) {
  return {
    id: row.id,
    source: row.source,
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName,
    userId: row.userId,
    userDisplayName,
    callerCanLinkAsSelf,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

/** Confirms `tokenId` exists and belongs to `userId` — the same
 * ownership check `DELETE /tokens/{id}` already enforces, shared by
 * every `/tokens/{id}/webhook-links` route below so a token's linked
 * accounts can only be managed by whoever created it. Returns `false`
 * on a mismatch; every caller responds 404, not 403, on that — same
 * reasoning as the existing DELETE route: doesn't confirm to a caller
 * whether a token id they don't own even exists. */
async function ownsToken(db: Database, tokenId: string, userId: string): Promise<boolean> {
  const [token] = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .limit(1)
  return Boolean(token)
}

/** Fetches one link, scoped to the token it's supposed to belong to —
 * every link-related route below calls this after `ownsToken` so a
 * link id from a different token (even one the same caller owns) 404s
 * rather than being acted on, matching the existing DELETE route. */
async function findLink(
  db: Database,
  tokenId: string,
  linkId: string,
): Promise<typeof webhookAccountLinks.$inferSelect | undefined> {
  const [link] = await db
    .select()
    .from(webhookAccountLinks)
    .where(and(eq(webhookAccountLinks.id, linkId), eq(webhookAccountLinks.tokenId, tokenId)))
    .limit(1)
  return link
}

tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens',
    summary: "List the current user's webhook tokens",
    responses: {
      200: {
        description: 'Tokens',
        content: { 'application/json': { schema: z.object({ tokens: z.array(apiTokenSchema) }) } },
      },
    },
  }),
  async (c) => {
    const env = loadEnv()
    const rows = await c
      .get('db')
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.get('user')!.id))
    return c.json({ tokens: rows.map((row) => serializeToken(row, env.ENCRYPTION_KEY)) })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens',
    summary: 'Create a new webhook token',
    request: {
      body: { content: { 'application/json': { schema: createApiTokenRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Token created',
        content: { 'application/json': { schema: createApiTokenResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { name, source } = c.req.valid('json')
    const { token, hash, encrypted } = generateApiToken(loadEnv().ENCRYPTION_KEY)
    const [row] = await c
      .get('db')
      .insert(apiTokens)
      .values({
        userId: c.get('user')!.id,
        name,
        source,
        tokenHash: hash,
        tokenEncrypted: encrypted,
      })
      .returning()
    if (!row) throw new Error('Failed to create token')
    return c.json({ ...serializeToken(row), token }, 201)
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/tokens/{id}',
    summary: "Set a token's source — only settable field, and only once null",
    request: {
      params: z.object({ id: uuidSchema }),
      body: { content: { 'application/json': { schema: updateApiTokenRequestSchema } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: apiTokenSchema } } },
      404: { description: 'Token not found' },
      409: { description: 'Source is already set and cannot be changed' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { source } = c.req.valid('json')
    const db = c.get('db')
    const [row] = await db
      .update(apiTokens)
      .set({ source })
      .where(
        and(
          eq(apiTokens.id, id),
          eq(apiTokens.userId, c.get('user')!.id),
          isNull(apiTokens.source),
        ),
      )
      .returning()
    if (row) return c.json(serializeToken(row, loadEnv().ENCRYPTION_KEY))
    const [existing] = await db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, c.get('user')!.id)))
    if (!existing) return c.json({ error: 'Token not found' }, 404)
    return c.json({ error: 'Source is already set and cannot be changed' }, 409)
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens/{id}/regenerate',
    summary: "Rotate a webhook token's URL",
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: {
        description: 'Regenerated — the previous URL stops working immediately',
        content: { 'application/json': { schema: createApiTokenResponseSchema } },
      },
      404: { description: 'Token not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const userId = c.get('user')!.id
    const { token, hash, encrypted } = generateApiToken(loadEnv().ENCRYPTION_KEY)

    // Updates the secret columns in place, same as calendar feeds'
    // regenerate (routes/calendar.ts) — name/source/createdAt survive,
    // and webhookAccountLinks/pendingWebhookEvents (keyed on this row's
    // id, not the secret itself) are untouched, so detected accounts
    // aren't lost. lastUsedAt is reset: the new URL genuinely hasn't
    // been hit yet.
    const [row] = await db
      .update(apiTokens)
      .set({ tokenHash: hash, tokenEncrypted: encrypted, lastUsedAt: null })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
      .returning()
    if (!row) return c.json({ error: 'Token not found' }, 404)

    logSecurityEvent('api_token_regenerated', { userId })
    return c.json({ ...serializeToken(row), token })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/tokens/{id}',
    summary: 'Revoke a webhook token',
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      204: { description: 'Revoked' },
      404: { description: 'Token not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await c
      .get('db')
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, c.get('user')!.id)))
      .returning({ id: apiTokens.id })
    if (result.length === 0) return c.json({ error: 'Token not found' }, 404)
    return c.body(null, 204)
  },
)

/**
 * A webhook token doesn't map to exactly one rwnd.tv user — the media
 * server it's registered against can have several of its own (see
 * `packages/db/src/schema.ts`'s `webhookAccountLinks` doc comment and
 * `apps/api/src/lib/webhook-accounts.ts`). These routes are how a
 * token's own creator sees and links those accounts.
 *
 * Linking an account to *another* rwnd.tv user always goes through a
 * one-time link code that the target redeems themselves
 * (`POST /webhook-links/redeem`, `webhook-links.ts`) — the token owner
 * never picks a target user directly. See
 * `docs/adr/0007-security-posture.md`'s addendum for why: the previous
 * direct-assign design let any token owner attribute an account to
 * anyone on the instance with no involvement from that person at all.
 */
tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens/{id}/webhook-links',
    summary: "A webhook token's linked external accounts",
    request: { params: z.object({ id: uuidSchema }) },
    responses: {
      200: {
        description: 'Webhook links',
        content: { 'application/json': { schema: listWebhookLinksResponseSchema } },
      },
      404: { description: 'Token not found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('db')
    const caller = c.get('user')!
    if (!(await ownsToken(db, id, caller.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }

    const [rows, linkedRows] = await Promise.all([
      db
        .select({ link: webhookAccountLinks, userDisplayName: users.displayName })
        .from(webhookAccountLinks)
        .leftJoin(users, eq(users.id, webhookAccountLinks.userId))
        .where(eq(webhookAccountLinks.tokenId, id))
        // Without an explicit order, Postgres returns rows in whatever
        // physical scan order is convenient — not necessarily insertion
        // order, and not stable across an UPDATE (found 2026-09-02:
        // linking/unlinking an account, itself just an UPDATE, could
        // shuffle its position in the list). Ordering by `firstSeenAt`
        // fixed the instability but read as arbitrary to James, who
        // asked for alphabetical instead — `externalAccountName` is the
        // one thing actually shown in this list, so it's what the sort
        // should match. Wrapped in `lower()` — this instance's database
        // collation (`en_US.utf8`) sorts plain text byte-wise within
        // that locale's rules, which groups every capitalized name
        // ahead of every lowercase one rather than interleaving them
        // (found 2026-09-02: James saw "Carol", "Test", "jamesbulman" —
        // both capitals before the one all-lowercase name).
        .orderBy(sql`lower(${webhookAccountLinks.externalAccountName})`),
      // The sources the caller already has a linked account for,
      // regardless of which token — see hasLinkedSource's own doc
      // comment for why this isn't scoped to just this one token.
      db
        .selectDistinct({ source: webhookAccountLinks.source })
        .from(webhookAccountLinks)
        .where(eq(webhookAccountLinks.userId, caller.id)),
    ])
    const linkedSources = new Set(linkedRows.map((r) => r.source))

    return c.json({
      links: rows.map((row) =>
        serializeLink(
          row.link,
          row.userDisplayName ?? null,
          !row.link.userId && !linkedSources.has(row.link.source),
        ),
      ),
    })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens/{id}/webhook-links/{linkId}/link',
    summary: 'Link an unlinked account as the caller themselves',
    request: { params: z.object({ id: uuidSchema, linkId: uuidSchema }) },
    responses: {
      200: {
        description: 'Linked',
        content: { 'application/json': { schema: webhookAccountLinkSchema } },
      },
      404: { description: 'Token or link not found' },
      409: {
        description:
          'Already linked, the caller already has a linked account for this source, or this same server is already linked via a different source',
      },
    },
  }),
  async (c) => {
    const { id, linkId } = c.req.valid('param')
    const db = c.get('db')
    const user = c.get('user')!
    if (!(await ownsToken(db, id, user.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }
    const link = await findLink(db, id, linkId)
    if (!link) return c.json({ error: 'Link not found' }, 404)
    if (link.userId) return c.json({ error: CLAIM_FAILURE_RESPONSE['already-linked'] }, 409)

    // The pre-checks above are only a fast path for the common case; the
    // real invariant enforcement (the advisory lock plus a re-check of
    // every condition) happens inside claimLinkForUser, which is why this
    // route needs no try/catch — every one of its outcomes is a 409 that
    // differs only by message, all read straight from CLAIM_FAILURE_RESPONSE.
    const result = await db.transaction((tx) => claimLinkForUser(tx, link, user))
    if (!result.ok) {
      return c.json({ error: CLAIM_FAILURE_RESPONSE[result.reason] }, 409)
    }

    const providers = await orderedProviders(db, c.get('metadataProviders'))
    await replayPendingWebhookEvents(db, providers, user, result.link)
    logSecurityEvent('webhook_account_linked', { userId: user.id })
    return c.json(serializeLink(result.link, user.displayName))
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens/{id}/webhook-links/{linkId}/unlink',
    summary: 'Clear a linked account back to unlinked, keeping the row',
    request: { params: z.object({ id: uuidSchema, linkId: uuidSchema }) },
    responses: {
      200: {
        description: 'Unlinked',
        content: { 'application/json': { schema: webhookAccountLinkSchema } },
      },
      404: { description: 'Token or link not found' },
      409: { description: 'Not linked' },
    },
  }),
  async (c) => {
    const { id, linkId } = c.req.valid('param')
    const db = c.get('db')
    const user = c.get('user')!
    if (!(await ownsToken(db, id, user.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }
    const link = await findLink(db, id, linkId)
    if (!link) return c.json({ error: 'Link not found' }, 404)
    if (!link.userId) return c.json({ error: 'Not linked' }, 409)

    const [updated] = await db
      .update(webhookAccountLinks)
      .set({ userId: null })
      .where(eq(webhookAccountLinks.id, link.id))
      .returning()
    if (!updated) throw new Error('Failed to unlink webhook account')

    logSecurityEvent('webhook_account_unlinked', { userId: user.id })
    // Whoever unlinked this isn't necessarily who it was linked to — the
    // token owner can unlink on anyone's behalf. Computed for real
    // rather than assumed, same rule GET's own listing applies.
    const callerCanLinkAsSelf = !(await hasLinkedSource(db, user.id, updated.source))
    return c.json(serializeLink(updated, null, callerCanLinkAsSelf))
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens/{id}/webhook-links/{linkId}/link-code',
    summary: 'Generate a one-time code for someone else to link an account',
    request: {
      params: z.object({ id: uuidSchema, linkId: uuidSchema }),
      body: { content: { 'application/json': { schema: createWebhookLinkCodeRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Code created',
        content: { 'application/json': { schema: createWebhookLinkCodeResponseSchema } },
      },
      404: { description: 'Token or link not found' },
      409: { description: 'Already linked' },
    },
  }),
  async (c) => {
    const { id, linkId } = c.req.valid('param')
    const { email } = c.req.valid('json')
    const db = c.get('db')
    const user = c.get('user')!
    if (!(await ownsToken(db, id, user.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }
    const link = await findLink(db, id, linkId)
    if (!link) return c.json({ error: 'Link not found' }, 404)
    if (link.userId) return c.json({ error: 'Already linked' }, 409)

    const code = generateSecret(9)
    const expiresAt = new Date(Date.now() + WEBHOOK_LINK_TTL_MS)

    // Generating a new code supersedes any prior unused one for this link —
    // at most one is ever live, so an old code shared earlier stops working
    // silently rather than staying valid alongside a newer one.
    await db
      .delete(webhookLinkCodes)
      .where(and(eq(webhookLinkCodes.linkId, link.id), isNull(webhookLinkCodes.usedBy)))
    await db
      .insert(webhookLinkCodes)
      .values({ linkId: link.id, codeHash: hashSecret(code), createdBy: user.id, expiresAt })

    logSecurityEvent('webhook_link_code_created', { userId: user.id })

    let emailSent = false
    if (email && isEmailConfigured()) {
      const [settings] = await db.select().from(instanceSettings).limit(1)
      try {
        await sendWebhookLinkEmail(
          email,
          code,
          settings?.registrationMode ?? 'closed',
          settings?.instanceName ?? 'rwnd.tv',
          settings?.adminEmail ?? null,
          WEBHOOK_SOURCE_LABELS[link.source],
        )
        emailSent = true
      } catch (err) {
        console.error(`Failed to send webhook link code email to link ${link.id}:`, err)
      }
    }

    return c.json({ code, expiresAt: expiresAt.toISOString(), emailSent }, 201)
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/tokens/{id}/webhook-links/{linkId}',
    summary: 'Remove a linked external account',
    request: { params: z.object({ id: uuidSchema, linkId: uuidSchema }) },
    responses: {
      204: { description: 'Removed' },
      404: { description: 'Token or link not found' },
    },
  }),
  async (c) => {
    const { id, linkId } = c.req.valid('param')
    const db = c.get('db')
    if (!(await ownsToken(db, id, c.get('user')!.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }

    const result = await db
      .delete(webhookAccountLinks)
      .where(and(eq(webhookAccountLinks.id, linkId), eq(webhookAccountLinks.tokenId, id)))
      .returning({ id: webhookAccountLinks.id })
    if (result.length === 0) return c.json({ error: 'Link not found' }, 404)
    return c.body(null, 204)
  },
)
