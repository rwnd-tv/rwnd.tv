import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { getClientIp } from '../lib/client-ip.js'

/**
 * Anti-automation for the public, unauthenticated routes (M3 security
 * review — nothing throttled any of this before). A single in-memory
 * fixed-window counter, not a dependency: this is a single-container
 * deployment, so a shared external store buys nothing, and the whole
 * thing is ~40 lines. State does not survive a restart — fine for the
 * IP-based limiters here (throttling, not the credential-stuffing
 * defence itself), which is why login's per-account lockout is DB-backed
 * instead (apps/api/src/lib/login-lockout.ts).
 *
 * Budgets (tunable, not load-bearing beyond "meaningfully slows down
 * automation without bothering a real user"):
 * - login: 10/15min per IP (paired with per-account backoff)
 * - forgot-password: 5/hour per IP, plus 5/hour per submitted email
 *   (tryConsume, called directly from the route handler — see auth.ts)
 * - register / setup: 5/hour per IP
 * - Plex webhook: 120/min per token
 * - webhook link redeem: 10/15min per IP (the code itself is a 9-byte
 *   CSPRNG value, so this bounds automation rather than defending
 *   meaningful entropy)
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Test-only: clears all limiter state between tests, since `buckets` is
 * module-level and otherwise persists across every test in a file. */
export function resetRateLimits(): void {
  buckets.clear()
}

/** The shared primitive both `rateLimit()` below and forgot-password's
 * per-email check build on. Returns `true` if this attempt is allowed
 * (and counts it), `false` if the caller is over `limit` within the
 * current `windowMs` window. */
export function tryConsume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number
  windowMs: number
  /** Namespaces this limiter's buckets from every other one, since they
   * all share one Map. */
  name: string
  /** Defaults to the client IP (client-ip.ts, honouring TRUST_PROXY).
   * Override for a dimension other than IP — e.g. the Plex webhook keys
   * on the URL token instead, since IP isn't meaningful for a
   * server-to-server integration. */
  key?: (c: Context<AppEnv>) => string
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const identity = options.key ? options.key(c) : getClientIp(c, loadEnv().TRUST_PROXY)
    if (!tryConsume(`${options.name}:${identity}`, options.limit, options.windowMs)) {
      return c.json({ error: 'Too many requests — please try again later' }, 429)
    }
    await next()
    return
  })
}
