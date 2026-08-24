import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { users, webhookAccountLinks } from '@rwnd/db'
import type { UserRecord } from '../types.js'

/**
 * Resolves which rwnd.tv user one webhook event's external account (e.g.
 * a Plex `Account.id`) belongs to — a webhook token doesn't necessarily
 * map to one rwnd.tv user 1:1, since the media server it's registered
 * against can have multiple users of its own (see
 * `packages/db/src/schema.ts`'s `webhookAccountLinks` doc comment).
 *
 * Every account starts unclaimed — there's deliberately no auto-link for
 * "this is probably the token's own creator": Plex's own docs claim the
 * server owner is always account id `1`, but live-verified 2026-08-24
 * against a real payload, that doesn't hold (the real account id is
 * Plex's actual global account id, not a small per-server placeholder).
 * Rather than guess at a better heuristic, every account — owner
 * included — goes through the same one-time claim in Settings.
 *
 * - No link row yet for this `(tokenId, source, externalAccountId)`:
 *   creates one, unclaimed, and returns null. There's no way to
 *   discover an account's external id up front, so first contact is how
 *   it gets surfaced for a human to claim (Settings > API tokens' per-
 *   token "Linked accounts" list). The caller is expected to have
 *   already stashed this event for possible replay once claimed — see
 *   `apps/api/src/routes/webhooks.ts`.
 * - Row exists and is claimed: touches `lastSeenAt`, refreshes
 *   `externalAccountName` if it changed, returns that user.
 * - Row exists but still unclaimed: touches `lastSeenAt`, returns null.
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
      `Webhook: new ${source} account "${externalAccountName}" (${externalAccountId}) seen for the first time — unclaimed until linked in Settings.`,
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
