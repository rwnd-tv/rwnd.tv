import { and, eq } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { users, webhookAccountLinks } from '@rwnd/db'
import type { UserRecord } from '../types.js'

/**
 * Resolves which rwnd.tv user one webhook event's external account (e.g.
 * a Plex `Account.id`) belongs to — a webhook token doesn't necessarily
 * map to one rwnd.tv user 1:1, since the media server it's registered
 * against can have multiple users of its own (see
 * `packages/db/src/schema.ts`'s `webhookAccountLinks` doc comment).
 *
 * Every account starts unlinked — there's deliberately no auto-link for
 * "this is probably the token's own creator": Plex's own docs claim the
 * server owner is always account id `1`, but live-verified 2026-08-24
 * against a real payload, that doesn't hold (the real account id is
 * Plex's actual global account id, not a small per-server placeholder).
 * Rather than guess at a better heuristic, every account — owner
 * included — goes through the same one-time link in Settings.
 *
 * - No link row yet for this `(tokenId, source, externalAccountId)`:
 *   creates one, unlinked, and returns null. There's no way to
 *   discover an account's external id up front, so first contact is how
 *   it gets surfaced for a human to link (Settings > API tokens' per-
 *   token "Detected accounts" list). The caller is expected to have
 *   already stashed this event for possible replay once linked — see
 *   `apps/api/src/routes/webhooks.ts`.
 * - Row exists and is linked: touches `lastSeenAt`, refreshes
 *   `externalAccountName` if it changed, returns that user.
 * - Row exists but still unlinked: touches `lastSeenAt`, returns null.
 */
export async function resolveWebhookAccount(
  db: Database,
  tokenId: string,
  source: 'plex',
  externalAccountId: string,
  externalAccountName: string,
): Promise<UserRecord | null> {
  const [existing] = await db
    .select({ userId: webhookAccountLinks.userId })
    .from(webhookAccountLinks)
    .where(
      and(
        eq(webhookAccountLinks.tokenId, tokenId),
        eq(webhookAccountLinks.source, source),
        eq(webhookAccountLinks.externalAccountId, externalAccountId),
      ),
    )
    .limit(1)

  if (!existing) {
    await db
      .insert(webhookAccountLinks)
      .values({ tokenId, source, externalAccountId, externalAccountName })
    console.error(
      `Webhook: new ${source} account "${externalAccountName}" (${externalAccountId}) seen for the first time — link it in Settings.`,
    )
    return null
  }

  await db
    .update(webhookAccountLinks)
    .set({ lastSeenAt: new Date(), externalAccountName })
    .where(
      and(
        eq(webhookAccountLinks.tokenId, tokenId),
        eq(webhookAccountLinks.source, source),
        eq(webhookAccountLinks.externalAccountId, externalAccountId),
      ),
    )
  if (!existing.userId) return null

  const [user] = await db.select().from(users).where(eq(users.id, existing.userId)).limit(1)
  return user ?? null
}

/** Whether `userId` already has a linked webhook account for `source` —
 * one rwnd.tv user maps to at most one external account per source
 * (James, 2026-09-02): a Plex account is one specific person, and this
 * app has no notion of a household sharing a single rwnd.tv login.
 * Checked before both ways an account can be linked to yourself —
 * self-link (`POST /tokens/{id}/webhook-links/{linkId}/link`,
 * `routes/tokens.ts`) and link-code redemption
 * (`POST /webhook-links/redeem`, `routes/webhook-links.ts`) — so the
 * invariant holds regardless of which path was used, not just enforced
 * as a UI nicety on one of them. Scoped to `source`, not tokenId: the
 * same rwnd.tv user could otherwise self-link a second Plex account
 * under a *different* token, which would be the same violation.
 * `Database | Tx` — the redeem route's own check needs to run inside its
 * link transaction, not after it. */
export async function hasLinkedSource(
  db: Database | Tx,
  userId: string,
  source: 'plex',
): Promise<boolean> {
  const [existing] = await db
    .select({ id: webhookAccountLinks.id })
    .from(webhookAccountLinks)
    .where(and(eq(webhookAccountLinks.userId, userId), eq(webhookAccountLinks.source, source)))
    .limit(1)
  return Boolean(existing)
}
