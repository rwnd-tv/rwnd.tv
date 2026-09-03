import { createMiddleware } from 'hono/factory'
import { isAdminRole } from '@rwnd/shared'
import { resolveSession } from '../lib/session.js'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { getSessionToken, setSessionCookie } from '../lib/cookies.js'

/**
 * Every `/api/v1/*` route not listed here requires a valid session — see
 * requireSession below. This is the fail-closed replacement for the old
 * per-route `middleware: [requireAuth]` opt-in model (100 call sites across
 * 17 files), where forgetting the line silently published a route. Each
 * entry is commented with why it's public. Paths are relative to `/api/v1`,
 * matching `createRoute({ path })` in each route file.
 *
 * See the M3 security review (docs/security/asvs-l1.md, V1.4.4) and
 * apps/api/src/test/route-coverage.test.ts, which walks the generated
 * OpenAPI document and asserts every route *not* listed here actually 401s
 * unauthenticated — so adding a route without deciding its auth posture
 * fails CI instead of silently shipping unauthenticated.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/setup' }, // "is setup required" — needed before any account exists
  { method: 'POST', path: '/setup' }, // creates the first admin; self-gates on adminExists()
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/login/mfa' }, // bearer-by-challenge-token in the request body
  { method: 'POST', path: '/auth/register' }, // self-gates on the instance's registration policy
  { method: 'POST', path: '/auth/logout' }, // reads its own cookie directly; a no-op without one
  { method: 'POST', path: '/auth/forgot-password' },
  { method: 'POST', path: '/auth/reset-password' }, // bearer-by-token in the request body
  { method: 'POST', path: '/auth/verify-email' }, // bearer-by-token in the request body
  { method: 'POST', path: '/auth/confirm-email-change' }, // bearer-by-token in the request body
  { method: 'GET', path: '/settings' }, // deliberately public instance metadata
]

// Plex offers no way to set a custom header on its webhook, so the bearer
// token travels as a URL path segment instead of the usual Authorization
// header — see routes/webhooks.ts's doc comment. Matched by prefix since
// the token itself is the variable part of the path.
const WEBHOOK_TOKEN_PREFIX = '/webhooks/plex/'

function isPublicRoute(method: string, path: string): boolean {
  if (method === 'POST' && path.startsWith(WEBHOOK_TOKEN_PREFIX)) return true
  return PUBLIC_ROUTES.some((route) => route.method === method && route.path === path)
}

/**
 * Requires a valid session for every route mounted under `/api/v1` except
 * PUBLIC_ROUTES above. Mounted once on the `v1` sub-app in app.ts, ahead of
 * route registration, rather than opted into per route.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path.replace(/^\/api\/v1/, '') || '/'
  if (isPublicRoute(c.req.method, path)) {
    await next()
    return
  }

  const env = loadEnv()
  const token = getSessionToken(c, env)
  if (!token) {
    return c.json({ error: 'unauthenticated' }, 401)
  }
  const resolved = await resolveSession(c.get('db'), token)
  if (!resolved) {
    return c.json({ error: 'unauthenticated' }, 401)
  }
  c.set('user', resolved.user)
  // Sliding session expiry (ASVS V3.3.2/V3.3.4, docs/TODO.md) — resolveSession()
  // already renewed the row's server-side expiresAt on this throttled touch;
  // re-sending the cookie with a matching new Expires is what makes that
  // renewal actually matter, since the browser would otherwise still drop
  // the cookie at its original, un-renewed expiry regardless.
  if (resolved.renewedExpiresAt) {
    setSessionCookie(c, env, token, resolved.renewedExpiresAt)
  }
  await next()
  return
})

/** Requires an authenticated admin — `owner` counts too (see
 * `isAdminRole`'s doc comment, packages/shared/src/schemas/common.ts): it's
 * a strict superset of admin privileges, not a separate tier that needs its
 * own opt-in everywhere `requireAdmin` is already used. Must run after
 * requireSession. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user || !isAdminRole(user.role)) {
    return c.json({ error: 'forbidden' }, 403)
  }
  await next()
  return
})

/** Requires the current owner specifically — stricter than requireAdmin.
 * Only `POST /auth/me/transfer-ownership` (routes/auth.ts, M4,
 * docs/TODO_ARCHIVE.md) uses this; every other admin action is available
 * to any admin, ordinary or owner. Must run after requireSession. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') {
    return c.json({ error: 'forbidden' }, 403)
  }
  await next()
  return
})
