import { OpenAPIHono } from '@hono/zod-openapi'
import { pendingWebhookEvents } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { jsonBodyLimit } from '../lib/body-limit.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { resolveApiToken } from '../lib/api-tokens.js'
import { resolveWebhookAccount } from '../lib/webhook-accounts.js'
import { logWebhookPlay } from '../lib/webhook-plays.js'
import { orderedProviders } from '../providers/priority.js'
import { parsePlexPayload } from '../webhooks/plex.js'

export const webhookRoutes = new OpenAPIHono<AppEnv>()

/**
 * Plex's webhook feature (Plex Pass required) POSTs a fixed
 * `multipart/form-data` request — a `payload` field holding the event as
 * JSON, plus an optional thumbnail part this ignores — to a URL you
 * register in Plex's own Settings > Webhooks, with no way to attach
 * custom headers. That's why auth is a token in the URL path rather than
 * an `Authorization` header, and why this is a plain route rather than
 * going through the `.openapi()` typed-JSON-body convention every other
 * route uses: it isn't part of the documented API contract the frontend
 * consumes, the same reasoning as it being token- rather than
 * session-authenticated.
 *
 * Always responds 200 once the token/payload themselves are valid, even
 * when nothing gets logged immediately (an irrelevant event, or a
 * title/episode none of the configured providers recognize — see
 * `logWebhookPlay`) — Plex only retries on a non-2xx, and retrying
 * something this code will never be able to act on isn't useful. An
 * event for an account that hasn't been linked to a rwnd.tv user yet is
 * different: it's stashed in `pendingWebhookEvents` rather than
 * dropped, and becomes a real play retroactively the moment that
 * account gets claimed (`apps/api/src/routes/tokens.ts`'s webhook-link
 * claim route) — see `resolveWebhookAccount`'s doc comment for why
 * there's no way to know who it belongs to up front.
 */
// A real Plex scrobble payload is a few KB; generous headroom over that
// without leaving this the one route in the app with no body cap at all
// (it's the only one that was, pre-review — see docs/security/asvs-l1.md).
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

// Keyed by the raw URL token rather than IP — this is a server-to-server
// integration (one Plex server can legitimately generate a burst of
// events), so per-token is the meaningful dimension, not per-source-IP.
// A bogus token gets its own harmless bucket, same as a real one.
const webhookRateLimit = rateLimit({
  name: 'webhooks:plex',
  limit: 120,
  windowMs: 60 * 1000,
  key: (c) => c.req.param('token') ?? 'unknown',
})

webhookRoutes.post(
  '/webhooks/plex/:token',
  webhookRateLimit,
  jsonBodyLimit(MAX_WEBHOOK_BODY_BYTES),
  async (c) => {
    const db = c.get('db')
    const token = c.req.param('token')
    const resolvedToken = await resolveApiToken(db, token)
    if (!resolvedToken) return c.json({ error: 'Invalid token' }, 401)
    const { tokenId } = resolvedToken

    let form: Awaited<ReturnType<typeof c.req.parseBody>>
    try {
      form = await c.req.parseBody()
    } catch {
      return c.json({ error: 'Malformed request body' }, 400)
    }
    const rawPayload = form.payload
    if (typeof rawPayload !== 'string') {
      return c.json({ error: 'Missing payload field' }, 400)
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawPayload)
    } catch {
      return c.json({ error: 'Malformed payload JSON' }, 400)
    }

    const event = parsePlexPayload(parsedJson)
    if (!event) return c.body(null, 200)

    const watchedAt = new Date()

    // Which rwnd.tv user this event actually belongs to — not necessarily
    // the token's own owner, since the Plex server this webhook is
    // registered against can have multiple users (see
    // resolveWebhookAccount's doc comment).
    const user = await resolveWebhookAccount(
      db,
      tokenId,
      'plex',
      event.account.externalId,
      event.account.name,
    )
    if (!user) {
      await db.insert(pendingWebhookEvents).values({
        tokenId,
        source: 'plex',
        externalAccountId: event.account.externalId,
        watchedAt,
        event,
      })
      return c.body(null, 200)
    }

    const providers = await orderedProviders(db, c.get('metadataProviders'))
    await logWebhookPlay(db, providers, user, event, watchedAt)
    return c.body(null, 200)
  },
)
