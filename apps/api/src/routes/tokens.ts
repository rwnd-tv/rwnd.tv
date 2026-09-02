import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  apiTokenSchema,
  createApiTokenRequestSchema,
  createApiTokenResponseSchema,
  createWebhookLinkCodeRequestSchema,
  createWebhookLinkCodeResponseSchema,
  listWebhookLinksResponseSchema,
  webhookAccountLinkSchema,
  uuidSchema,
} from '@rwnd/shared'
import { apiTokens, instanceSettings, users, webhookAccountLinks, webhookLinkCodes } from '@rwnd/db'
import type { Database } from '@rwnd/db'
import type { AppEnv, UserRecord } from '../types.js'
import { generateApiToken, generateSecret, hashSecret } from '../lib/tokens.js'
import { replayPendingWebhookEvents } from '../lib/webhook-plays.js'
import { hasLinkedSource } from '../lib/webhook-accounts.js'
import { orderedProviders } from '../providers/priority.js'
import { isEmailConfigured, sendWebhookLinkEmail } from '../lib/email.js'
import { logSecurityEvent } from '../lib/security-log.js'

export const tokenRoutes = new OpenAPIHono<AppEnv>()

// Same TTL as `invites` (apps/api/src/routes/invites.ts) — generous enough
// to actually hand off (in person, over chat, whenever the recipient gets
// around to it) without leaving a stale code valid indefinitely.
const WEBHOOK_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

function serializeToken(row: typeof apiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
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

/** Runs `replayPendingWebhookEvents` for a just-linked account, sharing
 * the provider-resolution + logging shape between the self-link and
 * link-code-redeem routes below. */
async function linkAndReplay(
  c: Context<AppEnv>,
  db: Database,
  link: typeof webhookAccountLinks.$inferSelect,
  user: UserRecord,
): Promise<typeof webhookAccountLinks.$inferSelect> {
  const [updated] = await db
    .update(webhookAccountLinks)
    .set({ userId: user.id })
    .where(eq(webhookAccountLinks.id, link.id))
    .returning()
  if (!updated) throw new Error('Failed to link webhook account')

  const providers = await orderedProviders(db, c.get('metadataProviders'))
  await replayPendingWebhookEvents(db, providers, user, updated)
  return updated
}

tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens',
    summary: "List the current user's API tokens",
    responses: {
      200: {
        description: 'Tokens',
        content: { 'application/json': { schema: z.object({ tokens: z.array(apiTokenSchema) }) } },
      },
    },
  }),
  async (c) => {
    const rows = await c
      .get('db')
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.get('user')!.id))
    return c.json({ tokens: rows.map(serializeToken) })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/tokens',
    summary: 'Create a new API token (shown once)',
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
    const { name } = c.req.valid('json')
    const { token, hash } = generateApiToken()
    const [row] = await c
      .get('db')
      .insert(apiTokens)
      .values({ userId: c.get('user')!.id, name, tokenHash: hash })
      .returning()
    if (!row) throw new Error('Failed to create token')
    return c.json({ ...serializeToken(row), token }, 201)
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/tokens/{id}',
    summary: 'Revoke an API token',
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
        description: 'Already linked, or the caller already has a linked account for this source',
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
    if (link.userId) return c.json({ error: 'Already linked' }, 409)
    if (await hasLinkedSource(db, user.id, link.source)) {
      return c.json({ error: 'You already have a linked account for this source' }, 409)
    }

    const updated = await linkAndReplay(c, db, link, user)
    logSecurityEvent('webhook_account_linked', { userId: user.id })
    return c.json(serializeLink(updated, user.displayName))
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
