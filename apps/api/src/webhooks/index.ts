import type { WebhookSourceRegistry } from './types.js'
import { parsePlexPayload } from './plex.js'
import { parseJellyfinPayload } from './jellyfin.js'
import { parseEmbyPayload } from './emby.js'

/** One entry per supported webhook source — typed as a `Record` over the
 * full `WebhookSource` enum so adding a value to `webhookSourceSchema`
 * (`@rwnd/shared`) without a matching entry here is a compile error, same
 * forcing-function pattern as `LinkedAccountsPanel.tsx`'s `SOURCE_LABELS`
 * on the web side. This is what makes adding a further source (Tautulli,
 * Kodi) genuinely "one parser file + one line here," per `docs/TODO.md`.
 *
 * `bodyFormat` tells the route (`apps/api/src/routes/webhooks.ts`) how to
 * extract the JSON payload before handing it to `parse`: Plex and Emby
 * both POST `multipart/form-data` with the JSON in one named field (their
 * own field names, `payload` and `data` respectively — confirmed live for
 * both, not assumed); Jellyfin POSTs the JSON directly as the body. */
export const webhookSources: WebhookSourceRegistry = {
  plex: {
    bodyFormat: { kind: 'multipart', field: 'payload' },
    parse: parsePlexPayload,
  },
  jellyfin: {
    bodyFormat: { kind: 'json' },
    parse: parseJellyfinPayload,
  },
  emby: {
    bodyFormat: { kind: 'multipart', field: 'data' },
    parse: parseEmbyPayload,
  },
}
