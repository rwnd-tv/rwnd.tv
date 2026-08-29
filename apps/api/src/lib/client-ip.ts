import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import type { AppEnv } from '../types.js'

/**
 * The IP address to key rate limiting on (middleware/rate-limit.ts).
 * `X-Forwarded-For` is only trusted when `TRUST_PROXY` is explicitly set —
 * it's client-supplied input otherwise, and trusting it unconditionally
 * makes the limiter bypassable with one header. With exactly one trusted
 * reverse proxy in front (the documented self-hosting setup), that proxy
 * appends the real client address as the *last* entry in the header —
 * anything earlier in the list could have been forged by the client
 * itself, so the rightmost entry is the only one actually trustworthy.
 *
 * Falls back to the raw socket address via getConnInfo when TRUST_PROXY is
 * off or the header is missing. getConnInfo needs a real Node socket
 * behind the request (@hono/node-server's adapter) — Hono's fetch-based
 * `app.request()` testing helper has none, so this is wrapped in a
 * try/catch and falls back to a fixed placeholder in that case. That
 * makes every test request share one rate-limit bucket by default, which
 * is why rate-limit.test.ts resets limiter state between tests rather
 * than relying on distinct IPs.
 */
export function getClientIp(c: Context<AppEnv>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean)
      const clientHop = hops.at(-1)
      if (clientHop) return clientHop
    }
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
