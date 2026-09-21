import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { users, webhookAccountLinks } from '@rwnd/db'
import type { WebhookSource } from '@rwnd/shared'
import type { UserRecord } from '../types.js'
import { lockUserScope } from './locks.js'

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
    // onConflictDoNothing rather than a bare insert: two webhook deliveries
    // for the same never-before-seen account, close enough together to
    // both reach this branch before either's insert commits, would
    // otherwise race webhookAccountLinks' own unique index
    // (tokenId, source, externalAccountId) and throw on whichever loses —
    // an unhandled 500 for what should always be a safe no-op path (see
    // routes/webhooks.ts's own doc comment on staying 200 whenever
    // possible). Safe to just return null either way: at SELECT time above
    // this row didn't exist yet, so a concurrent winner's insert is also
    // necessarily a brand-new, unlinked row — never one this event should
    // treat differently.
    await db
      .insert(webhookAccountLinks)
      .values({ tokenId, source, externalAccountId, externalAccountName, externalServerId })
      .onConflictDoNothing({
        target: [
          webhookAccountLinks.tokenId,
          webhookAccountLinks.source,
          webhookAccountLinks.externalAccountId,
        ],
      })
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

/** Locks this exact (userId, source) pair for the rest of the enclosing
 * transaction — same shape as `apps/api/src/lib/plays.ts`'s `lockEntity`
 * for a related race; see `lib/locks.ts`'s `lockUserScope` for the shared
 * locking mechanics both delegate to. Without it, `hasLinkedSource`'s
 * check and the write that follows aren't actually atomic together: two
 * concurrent link attempts for two *different* not-yet-linked accounts of
 * the same source (self-link and/or redeem-by-code,
 * `apps/api/src/routes/tokens.ts` and `apps/api/src/routes/webhook-links.ts`)
 * could each pass the check before either commits its own write —
 * different target rows, so Postgres's own row locking doesn't serialize
 * them — and both succeed, leaving this user linked to two accounts of the
 * same source at once. Found unguarded on the self-link route in the M4
 * review (docs/TODO.md, Stage 6); the redeem route had the identical
 * latent gap despite already running inside a transaction, so both call
 * this. */
export async function lockUserSource(tx: Tx, userId: string, source: WebhookSource): Promise<void> {
  await lockUserScope(tx, userId, source)
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

/** Why a claim attempt in `claimLinkForUser` below didn't succeed — the
 * three outcomes both the self-link route (`routes/tokens.ts`) and the
 * redeem-by-code route (`routes/webhook-links.ts`) need to distinguish. */
export type ClaimFailureReason =
  'already-linked' | 'source-already-linked' | 'server-already-linked'

export type ClaimLinkResult =
  | { ok: true; link: typeof webhookAccountLinks.$inferSelect }
  | { ok: false; reason: ClaimFailureReason }

/** The 409 copy for each `ClaimFailureReason`, shared so both routes agree
 * on wording rather than each hand-writing their own (they used to differ:
 * "Already linked" vs "This account has already been linked" for the same
 * `already-linked` case). Found in the M5 milestone review, docs/TODO.md. */
export const CLAIM_FAILURE_RESPONSE: Record<ClaimFailureReason, string> = {
  'already-linked': 'This account has already been linked',
  'source-already-linked': 'You already have a linked account for this source',
  'server-already-linked': 'This server already has a linked account via a different source',
}

/** Thrown by `claimLinkForUserOrThrow` below — a `ClaimLinkResult` carried
 * as an exception, for a caller whose transaction needs the throw itself
 * to roll back an earlier write (`routes/webhook-links.ts`'s redeem route
 * consumes a one-time code before reaching the claim; see that route's own
 * comment on why it can't use the plain `claimLinkForUser` union instead). */
export class WebhookLinkClaimError extends Error {
  constructor(readonly reason: ClaimFailureReason) {
    super(reason)
  }
}

/**
 * Claims `link` for `user`, re-checking every invariant inside the same
 * transaction the advisory lock and the write itself run in — a caller's
 * own pre-transaction checks (if any) are only a fast path for the common
 * case, not what actually makes this safe against a concurrent self-link/
 * redeem of a different account of the same source. `userId IS NULL` in
 * the `WHERE` clause is the atomic guard against a concurrent claim of
 * this *same* row (the token owner re-linking it, or a second concurrent
 * self-link/redeem of it).
 *
 * Pure: never throws for an expected outcome, and (unlike
 * `claimLinkForUserOrThrow` below) never needs to, since nothing here
 * writes anything before its own final `UPDATE` — there is nothing for a
 * caller to roll back on failure. Shared by `routes/tokens.ts`'s self-link
 * route and `routes/webhook-links.ts`'s redeem route, extracted after the
 * two independently-duplicated copies let a real fix (the `lockUserScope`
 * call) land in only one of them. Found in the M5 milestone review,
 * docs/TODO.md.
 */
export async function claimLinkForUser(
  tx: Tx,
  link: typeof webhookAccountLinks.$inferSelect,
  user: UserRecord,
): Promise<ClaimLinkResult> {
  await lockUserScope(tx, user.id, link.source)
  if (await hasLinkedSource(tx, user.id, link.source)) {
    return { ok: false, reason: 'source-already-linked' }
  }
  if (await hasConflictingServerLink(tx, user.id, link.source, link.externalServerId)) {
    return { ok: false, reason: 'server-already-linked' }
  }
  const [updated] = await tx
    .update(webhookAccountLinks)
    .set({ userId: user.id })
    .where(and(eq(webhookAccountLinks.id, link.id), isNull(webhookAccountLinks.userId)))
    .returning()
  if (!updated) return { ok: false, reason: 'already-linked' }
  return { ok: true, link: updated }
}

/** Throwing wrapper around `claimLinkForUser`, for a caller inside a
 * transaction that has already written something earlier (the redeem
 * route's one-time-code consume) and needs a genuine `throw` to roll that
 * back on failure — a bare union return would let the transaction commit
 * regardless of `ok`, silently keeping a one-time code "used" even though
 * the claim it was redeemed for failed. Do not simplify this back to the
 * plain union inside such a transaction. */
export async function claimLinkForUserOrThrow(
  tx: Tx,
  link: typeof webhookAccountLinks.$inferSelect,
  user: UserRecord,
): Promise<typeof webhookAccountLinks.$inferSelect> {
  const result = await claimLinkForUser(tx, link, user)
  if (!result.ok) throw new WebhookLinkClaimError(result.reason)
  return result.link
}
