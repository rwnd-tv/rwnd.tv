import type { WebhookSource } from '@rwnd/shared'
import type { ExternalIdBundle } from '../lib/external-match.js'

/** Everything needed to resolve and log a play, once it's known *who*
 * it belongs to — deliberately without `account` (split out onto
 * `IncomingWatchEvent` below), since this is also the shape stored in
 * `pending_webhook_events` for later replay (`packages/db/src/schema.ts`)
 * and `apps/api/src/lib/webhook-plays.ts`'s `logWebhookPlay` — neither
 * of those needs or has an opinion about which rwnd.tv user it is. */
// A flat object with a union-typed `media` (rather than an intersection
// of the shared fields with a media-shape union) deliberately — the two
// forms are semantically equivalent, but only this one structurally
// matches `pending_webhook_events.event`'s own `.$type<...>()` in
// `packages/db/src/schema.ts` closely enough for TypeScript to accept a
// stored/replayed event back through `logWebhookPlay` without a cast.
export type WatchEvent = {
  ids: ExternalIdBundle
  /** The source's own per-item id on that server — stable for a given
   * item, but server-local (not a cross-server/cross-instance identifier,
   * unlike `ids`). Plex's `ratingKey`, Jellyfin's `ItemId`, Emby's
   * `Item.Id`. Not currently read by anything downstream — the
   * timing-based `reconcilePlayDuplicates` (apps/api/src/lib/plays.ts)
   * superseded the idempotency-key use this was originally added for —
   * kept required for parity across sources and because it's useful for
   * debugging a stored `pending_webhook_events` row. Kept as one field
   * name across every source rather than renamed per source: that table
   * (schema.ts) already has real stored rows shaped with this literal
   * key. */
  ratingKey: string
  /** The physical media server this event came from, when the source can
   * report one — Plex's `Server.uuid` and Tautulli's
   * `{server_machine_id}` are the same identifier space (Tautulli
   * monitors a Plex server; live-confirmed 2026-09-14 by comparing a
   * real Tautulli delivery against that same Plex server's own
   * `GET /identity`). `null` for Jellyfin/Emby, which never report one,
   * and for a source that can report one but the event didn't carry it.
   * Required (not optional) so every parser makes an explicit choice
   * rather than silently omitting it. Used only at webhook-account link
   * time (`apps/api/src/lib/webhook-accounts.ts`'s
   * `hasConflictingServerLink`) to stop a user linking both `plex` and
   * `tautulli` against the *same* server, which would double-log every
   * watch (see `apps/api/src/lib/plays.ts`'s `ORIGIN_SOURCES`) — never
   * used for entity resolution or dedup itself. */
  serverId: string | null
  media:
    | { type: 'movie' }
    | { type: 'episode'; showTitle: string; seasonNumber: number; episodeNumber: number }
}

export type IncomingWatchEvent = WatchEvent & {
  /** Which account on the source server actually watched this — a
   * webhook is server-wide (fires for every user's playback, not just
   * whoever registered it), so this is what tells apart a multi-user
   * server's watches. `externalId` is that source's own account id —
   * for Plex, *not* reliably `1` for the server owner despite Plex's own
   * docs claiming so (live-verified 2026-08-24 against a real payload),
   * so every account, owner included, needs an explicit link. See
   * `apps/api/src/lib/webhook-accounts.ts`. */
  account: { externalId: string; name: string }
}

/** The contract every source's parser follows: never throw, and return
 * `null` for anything malformed, irrelevant, or unrecognized (a non-watch
 * event, an item type this app doesn't track, missing ids, ...) rather
 * than guessing. The route (`apps/api/src/routes/webhooks.ts`) treats
 * `null` as a 200 no-op, same as a genuinely unwatched event. */
type WebhookPayloadParser = (payload: unknown) => IncomingWatchEvent | null

/** How the route reads a given source's request body before handing it to
 * that source's parser — see `apps/api/src/webhooks/index.ts`'s registry
 * and `apps/api/src/routes/webhooks.ts`'s dispatch. */
type WebhookBodyFormat = { kind: 'multipart'; field: string } | { kind: 'json' }

type WebhookSourceConfig = {
  bodyFormat: WebhookBodyFormat
  parse: WebhookPayloadParser
}

export type WebhookSourceRegistry = Record<WebhookSource, WebhookSourceConfig>
