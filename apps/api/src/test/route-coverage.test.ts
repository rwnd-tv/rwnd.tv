import { describe, expect, it } from 'vitest'
import { PUBLIC_ROUTES } from '../middleware/auth.js'
import { extractCookie, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

/**
 * The real deliverable of the M3 security review's Stage B (see
 * docs/security/asvs-l1.md, V1.4.4): auth used to be opt-in per route
 * (`middleware: [requireAuth]`, 100 call sites) — forgetting the line
 * silently published a route. Now it's a fail-closed global gate
 * (requireSession in middleware/auth.ts) with an explicit PUBLIC_ROUTES
 * allow-list. This test walks the generated OpenAPI document and asserts
 * every route *not* in that allow-list actually 401s unauthenticated, so
 * adding a route without deciding its auth posture fails CI instead of
 * silently shipping public.
 *
 * Seven routes are plain Hono routes rather than `.openapi()`-registered
 * (avatar upload/delete/get for the caller's own, the admin-only
 * avatar-get for another user, the account export zip, and the two
 * multipart import routes) and so don't appear in the generated document
 * at all — listed explicitly below instead.
 */
const PLAIN_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'PUT', path: '/auth/me/avatar' },
  { method: 'DELETE', path: '/auth/me/avatar' },
  { method: 'GET', path: '/auth/me/avatar' },
  { method: 'GET', path: '/admin/users/placeholder-value/avatar' },
  { method: 'GET', path: '/account/export' },
  { method: 'POST', path: '/import/trakt/zip' },
  { method: 'POST', path: '/import/csv' },
]

function isPublic(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method && r.path === path)
}

async function getOpenApiPaths(cookie: string): Promise<Record<string, Record<string, unknown>>> {
  const res = await app.request('/api/v1/openapi.json', { headers: { cookie } })
  expect(res.status).toBe(200)
  const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> }
  return doc.paths
}

describe('route coverage — every /api/v1 route is either public or requires a session', () => {
  it('every non-public route in the OpenAPI document 401s without a session', async () => {
    await resetDb(db)
    const setup = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Admin',
      }),
    })
    const cookie = extractCookie(setup)!

    const paths = await getOpenApiPaths(cookie)
    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])
    const checked: Array<{ method: string; path: string }> = []

    for (const [path, operations] of Object.entries(paths)) {
      for (const rawMethod of Object.keys(operations)) {
        if (!httpMethods.has(rawMethod)) continue // e.g. 'parameters', not a verb
        const method = rawMethod.toUpperCase()
        if (isPublic(method, path)) continue

        // OpenAPI's {param} syntax — the literal placeholder value doesn't
        // matter, since requireSession runs before any route's own Zod
        // param validation and must reject on session alone.
        const concretePath = path.replace(/\{[^}]+\}/g, 'placeholder-value')
        const res = await app.request(`/api/v1${concretePath}`, { method })
        expect(res.status, `${method} ${path} should require a session`).toBe(401)
        checked.push({ method, path })
      }
    }

    // Guards against this test silently checking nothing if the OpenAPI
    // document ever came back empty.
    expect(checked.length).toBeGreaterThan(50)
  })

  it('the seven plain (non-openapi) routes all require a session', async () => {
    await resetDb(db)
    for (const { method, path } of PLAIN_ROUTES) {
      const res = await app.request(`/api/v1${path}`, { method })
      expect(res.status, `${method} ${path} should require a session`).toBe(401)
    }
  })

  it('every PUBLIC_ROUTES entry names a route that actually exists', async () => {
    await resetDb(db)
    const setup = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Admin',
      }),
    })
    const cookie = extractCookie(setup)!
    const paths = await getOpenApiPaths(cookie)

    for (const { method, path } of PUBLIC_ROUTES) {
      const operations = paths[path]
      expect(
        operations,
        `PUBLIC_ROUTES names ${method} ${path}, but no such path is registered`,
      ).toBeDefined()
      expect(
        operations?.[method.toLowerCase()],
        `PUBLIC_ROUTES names ${method} ${path}, but that method isn't registered on it`,
      ).toBeDefined()
    }
  })

  it('GET /api/docs (Swagger UI) requires a session', async () => {
    const res = await app.request('/api/docs')
    expect(res.status).toBe(401)
  })

  it('POST /webhooks/plex/:token is reached without a session — rejected by its own token check, not requireSession', async () => {
    // Deliberately public (see middleware/auth.ts's WEBHOOK_TOKEN_PREFIX).
    // An invalid token also 401s (webhooks.ts's own check), so the useful
    // assertion isn't the status code — it's that the *reason* is the
    // route's own "Invalid token", not requireSession's generic
    // "unauthenticated", proving the request wasn't blocked by the global
    // session gate before reaching the handler.
    const res = await app.request('/api/v1/webhooks/plex/not-a-real-token', { method: 'POST' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid token')
  })
})
