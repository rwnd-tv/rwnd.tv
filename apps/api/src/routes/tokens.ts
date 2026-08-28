import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import {
  apiTokenSchema,
  createApiTokenRequestSchema,
  createApiTokenResponseSchema,
  listWebhookLinksResponseSchema,
  updateWebhookLinkRequestSchema,
  webhookAccountLinkSchema,
  uuidSchema,
} from '@rwnd/shared'
import { apiTokens, pendingWebhookEvents, users, webhookAccountLinks } from '@rwnd/db'
import type { Database } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAuth } from '../middleware/auth.js'
import { generateApiToken } from '../lib/tokens.js'
import { logWebhookPlay } from '../lib/webhook-plays.js'
import { orderedProviders } from '../providers/priority.js'

export const tokenRoutes = new OpenAPIHono<AppEnv>()

function serializeToken(row: typeof apiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function serializeLink(row: typeof webhookAccountLinks.$inferSelect) {
  return {
    id: row.id,
    source: row.source,
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName,
    userId: row.userId,
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

tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens',
    summary: "List the current user's API tokens",
    middleware: [requireAuth] as const,
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
    middleware: [requireAuth] as const,
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
    middleware: [requireAuth] as const,
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
 * `apps/api/src/lib/webhook-accounts.ts`). These three routes are how a
 * token's own creator sees and assigns those accounts.
 */
tokenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/tokens/{id}/webhook-links',
    summary: "A webhook token's linked external accounts, and who can be assigned to one",
    middleware: [requireAuth] as const,
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
    if (!(await ownsToken(db, id, c.get('user')!.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }

    const [linkRows, userRows] = await Promise.all([
      db.select().from(webhookAccountLinks).where(eq(webhookAccountLinks.tokenId, id)),
      db.select({ id: users.id, displayName: users.displayName }).from(users),
    ])

    return c.json({
      links: linkRows.map(serializeLink),
      assignableUsers: userRows,
    })
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/tokens/{id}/webhook-links/{linkId}',
    summary: 'Assign (or unassign) which rwnd.tv user a linked external account belongs to',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ id: uuidSchema, linkId: uuidSchema }),
      body: { content: { 'application/json': { schema: updateWebhookLinkRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: webhookAccountLinkSchema } },
      },
      400: { description: 'userId does not refer to a real user' },
      404: { description: 'Token or link not found' },
    },
  }),
  async (c) => {
    const { id, linkId } = c.req.valid('param')
    const { userId } = c.req.valid('json')
    const db = c.get('db')
    if (!(await ownsToken(db, id, c.get('user')!.id))) {
      return c.json({ error: 'Token not found' }, 404)
    }

    let target: typeof users.$inferSelect | undefined
    if (userId) {
      ;[target] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      if (!target) return c.json({ error: 'No such user' }, 400)
    }

    const [updated] = await db
      .update(webhookAccountLinks)
      .set({ userId })
      .where(and(eq(webhookAccountLinks.id, linkId), eq(webhookAccountLinks.tokenId, id)))
      .returning()
    if (!updated) return c.json({ error: 'Link not found' }, 404)

    // A newly-claimed (not cleared) account may have watches waiting
    // from while it was unclaimed — replay them now instead of leaving
    // them lost. One-shot: whatever happens, the pending rows are gone
    // afterward, same as a live delivery only ever gets one attempt.
    if (target) {
      const pending = await db
        .select()
        .from(pendingWebhookEvents)
        .where(
          and(
            eq(pendingWebhookEvents.tokenId, id),
            eq(pendingWebhookEvents.source, updated.source),
            eq(pendingWebhookEvents.externalAccountId, updated.externalAccountId),
          ),
        )
      if (pending.length > 0) {
        const providers = await orderedProviders(db, c.get('metadataProviders'))
        for (const p of pending) {
          // One event's unexpected failure (a provider bug, a transient
          // network error — logWebhookPlay's own "no configured provider
          // recognizes this title" case already returns normally rather
          // than throwing) must not stop the rest of this batch from
          // replaying, or block the unconditional delete below — otherwise
          // a single bad event wedges every *other* pending event for this
          // account behind it indefinitely, never actually one-shot.
          try {
            await logWebhookPlay(db, providers, target, p.event, p.watchedAt)
          } catch (err) {
            console.error(`Failed to replay pending webhook event ${p.id} on claim:`, err)
          }
        }
        await db
          .delete(pendingWebhookEvents)
          .where(
            and(
              eq(pendingWebhookEvents.tokenId, id),
              eq(pendingWebhookEvents.source, updated.source),
              eq(pendingWebhookEvents.externalAccountId, updated.externalAccountId),
            ),
          )
      }
    }

    return c.json(serializeLink(updated))
  },
)

tokenRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/tokens/{id}/webhook-links/{linkId}',
    summary: 'Remove a linked external account',
    middleware: [requireAuth] as const,
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
