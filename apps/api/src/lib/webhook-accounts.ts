import { and, eq, inArray } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { users, webhookAccountLinks } from '@rwnd/db'
import type { WebhookSource } from '@rwnd/shared'
import type { UserRecord } from '../types.js'

/**
 * Resolves which rwnd.tv user one webhook event's external account (e.g.
 * a Plex `Account.id`, Jellyfin `UserId`, Emby `User.Id`) belongs to — a
 * webhook token doesn't necessarily
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
  source: WebhookSource,
  externalAccountId: string,
  externalAccountName: string,
  externalServerId: string | null,
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
      .values({ tokenId, source, externalAccountId, externalAccountName, externalServerId })
    console.error(
      `Webhook: new ${source} account "${externalAccountName}" (${externalAccountId}) seen for the first time — link it in Settings.`,
    )
    return null
  }

  await db
    .update(webhookAccountLinks)
    // Only overwrites externalServerId when this event actually carried
    // one — Jellyfin/Emby events never do, and a source that can carry one
    // (Plex, Tautulli) shouldn't have a previously-known value wiped by a
    // delivery that happened not to include it.
    .set({
      lastSeenAt: new Date(),
      externalAccountName,
      ...(externalServerId ? { externalServerId } : {}),
    })
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

/** Sources that can describe the exact same physical media server as
 * another source — today, just Tautulli monitoring a Plex server. See
 * `hasConflictingServerLink` below for what this is used for. */
const SAME_SERVER_SOURCES: Partial<Record<WebhookSource, readonly WebhookSource[]>> = {
  plex: ['tautulli'],
  tautulli: ['plex'],
}

/** Whether `userId` already has a linked account, on a source in the same
 * server group as `source` (see `SAME_SERVER_SOURCES`), for the *same
 * physical server* as `serverId` — checked before linking a new account,
 * alongside `hasLinkedSource` below, so a user can never end up linked to
 * both `plex` and `tautulli` against one server: Tautulli relays that
 * server's own Plex webhook events, so every watch would otherwise be
 * reported twice, by two different `ORIGIN_SOURCES`
 * (apps/api/src/lib/plays.ts) minutes apart, and get logged as two plays.
 *
 * Deliberately permissive whenever either side's server id is unknown
 * (this link's own, just-seen `serverId`, or an existing link's stored
 * `externalServerId` — e.g. one created before this check existed and
 * not yet re-seen) rather than refusing on source pairing alone: Tautulli
 * may equally be watching a *different* Plex server than the one already
 * linked (a Plex-Pass server plus a second, Pass-less one Tautulli
 * covers instead), which is a genuinely separate, valid setup that must
 * not be blocked. The residual duplicate-logging risk in the "unknown"
 * gap is accepted, not solved here — it closes itself once both sides
 * have reported at least one event since this column existed. */
export async function hasConflictingServerLink(
  db: Database | Tx,
  userId: string,
  source: WebhookSource,
  serverId: string | null,
): Promise<boolean> {
  const groupSources = SAME_SERVER_SOURCES[source]
  if (!groupSources || !serverId) return false

  const rows = await db
    .select({ externalServerId: webhookAccountLinks.externalServerId })
    .from(webhookAccountLinks)
    .where(
      and(
        eq(webhookAccountLinks.userId, userId),
        inArray(webhookAccountLinks.source, groupSources as WebhookSource[]),
      ),
    )
  return rows.some((row) => row.externalServerId === serverId)
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
  source: WebhookSource,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: webhookAccountLinks.id })
    .from(webhookAccountLinks)
    .where(and(eq(webhookAccountLinks.userId, userId), eq(webhookAccountLinks.source, source)))
    .limit(1)
  return Boolean(existing)
}
