import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, eq, gt, isNull } from 'drizzle-orm'
import {
  listWebhookLinksResponseSchema,
  redeemWebhookLinkRequestSchema,
  webhookAccountLinkSchema,
  uuidSchema,
} from '@rwnd/shared'
import { webhookAccountLinks, webhookLinkCodes } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { hashSecret } from '../lib/tokens.js'
import { replayPendingWebhookEvents } from '../lib/webhook-plays.js'
import { hasLinkedSource } from '../lib/webhook-accounts.js'
import { orderedProviders } from '../providers/priority.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { logSecurityEvent } from '../lib/security-log.js'
import { serializeLink } from './tokens.js'

export const webhookLinkRoutes = new OpenAPIHono<AppEnv>()

/** Thrown inside the redeem transaction below to roll it back — same
 * shape as `routes/auth.ts`'s `InvalidInviteCodeError` for invite
 * redemption. */
class InvalidLinkCodeError extends Error {}

/** Thrown when the code itself is valid but the link it points at has
 * already been linked by someone else in the meantime (a genuine race:
 * the token owner re-linked it themselves, or a second code for the
 * same link — generating one always supersedes the prior one, but two
 * outstanding requests could still interleave). */
class AlreadyLinkedError extends Error {}

/** Thrown when the code and link are both valid, but the redeemer
 * already has a different account of this same source linked to
 * themselves — the same one-rwnd.tv-user-per-source invariant
 * `hasLinkedSource` (`apps/api/src/lib/webhook-accounts.ts`) enforces
 * on the self-link route, applied here too so redeeming a code can't
 * be used to route around it. */
class AlreadySelfLinkedError extends Error {}

/**
 * Redeems a one-time webhook link code
 * (`POST /tokens/{id}/webhook-links/{linkId}/link-code`,
 * `routes/tokens.ts`) as the calling, session-authenticated user.
 * Deliberately not scoped under `/tokens/{id}` — the redeemer doesn't
 * own the token, and in most cases isn't even the same person as the
 * token owner. See `docs/adr/0007-security-posture.md`'s addendum for
 * why attributing a webhook account to anyone but yourself always goes
 * through this route rather than the token owner assigning it directly.
 *
 * Named `webhook-links` (not `webhook-claims`) as of 2026-09-02 — the
 * whole feature (routes, DB table, UI copy) was renamed from "claim" to
 * "link" throughout, James felt "link" is the term users would actually
 * understand. `redeem` stays as the verb for consuming a one-time code
 * (same word `invites` already uses) — only the noun changed.
 */
webhookLinkRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/webhook-links/redeem',
    summary: 'Redeem a webhook account link code, linking it to the caller',
    middleware: [
      rateLimit({ name: 'webhook-links:redeem', limit: 10, windowMs: 15 * 60 * 1000 }),
    ] as const,
    request: {
      body: { content: { 'application/json': { schema: redeemWebhookLinkRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Linked',
        content: { 'application/json': { schema: webhookAccountLinkSchema } },
      },
      400: { description: 'Invalid or expired code' },
      409: {
        description:
          'The account has already been linked, or the caller already has a linked account for this source',
      },
    },
  }),
  async (c) => {
    const { code } = c.req.valid('json')
    const db = c.get('db')
    const user = c.get('user')!

    let linkedRow: typeof webhookAccountLinks.$inferSelect
    try {
      linkedRow = await db.transaction(async (tx) => {
        // Atomic single UPDATE, same shape as invite redemption
        // (routes/auth.ts) — the WHERE usedBy IS NULL clause is what
        // makes the link itself race-safe against two concurrent
        // redemptions of the same code.
        const [redeemed] = await tx
          .update(webhookLinkCodes)
          .set({ usedBy: user.id })
          .where(
            and(
              eq(webhookLinkCodes.codeHash, hashSecret(code)),
              isNull(webhookLinkCodes.usedBy),
              gt(webhookLinkCodes.expiresAt, new Date()),
            ),
          )
          .returning({ linkId: webhookLinkCodes.linkId })
        if (!redeemed) throw new InvalidLinkCodeError()

        const [link] = await tx
          .select()
          .from(webhookAccountLinks)
          .where(eq(webhookAccountLinks.id, redeemed.linkId))
          .limit(1)
        // The link itself was deleted (e.g. the token was revoked) after
        // the code was generated — treat it the same as an invalid code
        // rather than a distinct error the caller can't act on either way.
        if (!link) throw new InvalidLinkCodeError()
        if (link.userId) throw new AlreadyLinkedError()
        if (await hasLinkedSource(tx, user.id, link.source)) {
          throw new AlreadySelfLinkedError()
        }

        const [updated] = await tx
          .update(webhookAccountLinks)
          .set({ userId: user.id })
          .where(eq(webhookAccountLinks.id, link.id))
          .returning()
        if (!updated) throw new Error('Failed to link webhook account')
        return updated
      })
    } catch (err) {
      if (err instanceof InvalidLinkCodeError) {
        return c.json({ error: 'Invalid or expired code' }, 400)
      }
      if (err instanceof AlreadyLinkedError) {
        return c.json({ error: 'This account has already been linked' }, 409)
      }
      if (err instanceof AlreadySelfLinkedError) {
        return c.json({ error: 'You already have a linked account for this source' }, 409)
      }
      throw err
    }

    const providers = await orderedProviders(db, c.get('metadataProviders'))
    await replayPendingWebhookEvents(db, providers, user, linkedRow)
    logSecurityEvent('webhook_account_linked', { userId: user.id })
    return c.json(serializeLink(linkedRow, user.displayName))
  },
)

/**
 * The caller's own linked webhook accounts, across every token — found
 * missing 2026-09-02 (James, after actually running the link flow end to
 * end): linking only ever showed a one-time success message on
 * `LinkWebhookAccountPage.tsx`, with nothing persistent afterward.
 * `GET /tokens/{id}/webhook-links` (`routes/tokens.ts`) only ever helps
 * the *token owner*, who the redeemer usually isn't — hence a separate,
 * unscoped-by-token route here rather than reusing that one.
 */
webhookLinkRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/webhook-links/mine',
    summary: "The caller's own linked webhook accounts",
    responses: {
      200: {
        description: 'Linked accounts',
        content: { 'application/json': { schema: listWebhookLinksResponseSchema } },
      },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const user = c.get('user')!
    const rows = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.userId, user.id))
    return c.json({ links: rows.map((row) => serializeLink(row, user.displayName)) })
  },
)

/**
 * Self-service unlink — distinct from `POST
 * /tokens/{id}/webhook-links/{linkId}/unlink`, which is the *token
 * owner* acting on someone else's linked account. This is the linked
 * account's own owner acting on themselves, so it's scoped by `userId`
 * matching the caller rather than by token ownership: one atomic UPDATE
 * with both the id and userId in the WHERE clause, so a link id that
 * exists but isn't linked to the caller 404s the same as one that
 * doesn't exist at all, rather than confirming its existence.
 */
webhookLinkRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/webhook-links/mine/{linkId}/unlink',
    summary: "Unlink one of the caller's own linked webhook accounts",
    request: { params: z.object({ linkId: uuidSchema }) },
    responses: {
      200: {
        description: 'Unlinked',
        content: { 'application/json': { schema: webhookAccountLinkSchema } },
      },
      404: { description: 'Link not found' },
    },
  }),
  async (c) => {
    const { linkId } = c.req.valid('param')
    const db = c.get('db')
    const user = c.get('user')!

    const [updated] = await db
      .update(webhookAccountLinks)
      .set({ userId: null })
      .where(and(eq(webhookAccountLinks.id, linkId), eq(webhookAccountLinks.userId, user.id)))
      .returning()
    if (!updated) return c.json({ error: 'Link not found' }, 404)

    logSecurityEvent('webhook_account_unlinked', { userId: user.id })
    return c.json(serializeLink(updated))
  },
)
