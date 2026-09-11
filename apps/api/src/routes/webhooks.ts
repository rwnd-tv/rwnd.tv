import { OpenAPIHono } from '@hono/zod-openapi'
import { pendingWebhookEvents } from '@rwnd/db'
import { webhookSourceSchema } from '@rwnd/shared'
import type { AppEnv } from '../types.js'
import { jsonBodyLimit } from '../lib/body-limit.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { resolveApiToken } from '../lib/api-tokens.js'
import { resolveWebhookAccount } from '../lib/webhook-accounts.js'
import { logWebhookPlay } from '../lib/webhook-plays.js'
import { orderedProviders } from '../providers/priority.js'
import { webhookSources } from '../webhooks/index.js'

export const webhookRoutes = new OpenAPIHono<AppEnv>()

/**
 * One route for every supported media-server webhook (Plex, Jellyfin,
 * Emby — see `apps/api/src/webhooks/index.js`'s registry), not sibling
 * literal routes: the rate limit, body cap, token resolution, account
 * linking, pending-event stash, and `logWebhookPlay` call below are
 * identical across sources and must never drift between them — three
 * literal routes would triple the security-reviewed surface
 * (docs/security/asvs-l1.md) for no benefit. None of these servers offer
 * a way to attach custom headers to their own webhook feature, which is
 * why auth is a token in the URL path rather than an `Authorization`
 * header, and why this is a plain route rather than going through the
 * `.openapi()` typed-JSON-body convention every other route uses: it
 * isn't part of the documented API contract the frontend consumes, the
 * same reasoning as it being token- rather than session-authenticated.
 *
 * Always responds 200 once the token/source/payload themselves are
 * valid, even when nothing gets logged immediately (an irrelevant event,
 * or a title/episode none of the configured providers recognize — see
 * `logWebhookPlay`) — every one of these servers only retries on a
 * non-2xx, and retrying something this code will never be able to act on
 * isn't useful. An event for an account that hasn't been linked to a
 * rwnd.tv user yet is different: it's stashed in `pendingWebhookEvents`
 * rather than dropped, and becomes a real play retroactively the moment
 * that account gets linked (`apps/api/src/routes/tokens.ts`'s
 * webhook-link link route) — see `resolveWebhookAccount`'s doc comment
 * for why there's no way to know who it belongs to up front.
 */
// A real scrobble/notification payload from any of these sources is a
// few KB (Jellyfin's "Send All Properties" dump, the largest, is still
// well under this); generous headroom over that without leaving this the
// one route in the app with no body cap at all.
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

// Keyed by the raw URL token rather than IP — this is a server-to-server
// integration (one media server can legitimately generate a burst of
// events), so per-token is the meaningful dimension, not per-source-IP.
// A bogus token gets its own harmless bucket, same as a real one. The
// limiter's own `name` deliberately stays constant across sources (not
// e.g. `webhooks:${source}`): the bucket key is `${name}:${identity}`
// (rate-limit.ts), so a source-aware name would multiply one token's
// budget by however many sources it's used with.
const webhookRateLimit = rateLimit({
  name: 'webhooks',
  limit: 120,
  windowMs: 60 * 1000,
  key: (c) => c.req.param('token') ?? 'unknown',
})

webhookRoutes.post(
  '/webhooks/:source/:token',
  webhookRateLimit,
  jsonBodyLimit(MAX_WEBHOOK_BODY_BYTES),
  async (c) => {
    const db = c.get('db')
    const token = c.req.param('token')
    const resolvedToken = await resolveApiToken(db, token)
    if (!resolvedToken) return c.json({ error: 'Invalid token' }, 401)
    const { tokenId } = resolvedToken

    // Checked after the token, not before: an unauthenticated caller sees
    // an identical 401 for every path regardless of source, and only
    // someone who already holds a valid token could otherwise distinguish
    // the two — for them, "wrong source segment" is the useful signal,
    // and the supported-source list is public documentation anyway.
    const sourceResult = webhookSourceSchema.safeParse(c.req.param('source'))
    if (!sourceResult.success) return c.json({ error: 'Unknown webhook source' }, 404)
    const source = sourceResult.data
    const { bodyFormat, parse } = webhookSources[source]

    let rawPayload: string | undefined
    if (bodyFormat.kind === 'multipart') {
      let form: Awaited<ReturnType<typeof c.req.parseBody>>
      try {
        form = await c.req.parseBody()
      } catch {
        return c.json({ error: 'Malformed request body' }, 400)
      }
      const field = form[bodyFormat.field]
      if (typeof field !== 'string') {
        return c.json({ error: 'Missing payload field' }, 400)
      }
      rawPayload = field
    } else {
      try {
        rawPayload = await c.req.text()
      } catch {
        return c.json({ error: 'Malformed request body' }, 400)
      }
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawPayload)
    } catch {
      return c.json({ error: 'Malformed payload JSON' }, 400)
    }

    const event = parse(parsedJson)
    if (!event) return c.body(null, 200)

    const watchedAt = new Date()

    // Which rwnd.tv user this event actually belongs to — not necessarily
    // the token's own owner, since the server this webhook is registered
    // against can have multiple users (see resolveWebhookAccount's doc
    // comment).
    const user = await resolveWebhookAccount(
      db,
      tokenId,
      source,
      event.account.externalId,
      event.account.name,
    )
    if (!user) {
      await db.insert(pendingWebhookEvents).values({
        tokenId,
        source,
        externalAccountId: event.account.externalId,
        watchedAt,
        event,
      })
      return c.body(null, 200)
    }

    const providers = await orderedProviders(db, c.get('metadataProviders'))
    await logWebhookPlay(db, providers, user, event, watchedAt, source)
    return c.body(null, 200)
  },
)
