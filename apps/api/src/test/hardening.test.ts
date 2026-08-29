import { beforeEach, describe, expect, it } from 'vitest'
import { extractCookie, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndLogin(): Promise<string> {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Test User',
    }),
  })
  return extractCookie(res)!
}

function jpegFile(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'avatar.jpg', { type: 'image/jpeg' })
}

/**
 * The M3 security review (docs/security/asvs-l1.md), all wired in app.ts.
 * Grows stage by stage — see each describe block's heading for which one
 * added it: Stage C is CSRF (hono/csrf) and body-size limits
 * (hono/body-limit); Stage D is security response headers and CSP
 * (hono/secure-headers).
 */
describe('hardening', () => {
  beforeEach(() => resetDb(db))

  describe('CSRF (Stage C)', () => {
    it('rejects a cross-origin multipart request', async () => {
      const cookie = await createUserAndLogin()
      const form = new FormData()
      form.set('file', jpegFile(1024))

      // testApp() defaults sec-fetch-site to same-origin (see helpers.ts)
      // to reflect real browser behaviour on every other test in this
      // suite — overridden here to what a real browser would actually
      // send for a genuinely foreign origin.
      const res = await app.request('/api/v1/auth/me/avatar', {
        method: 'PUT',
        headers: {
          cookie,
          origin: 'https://evil.example.com',
          'sec-fetch-site': 'cross-site',
        },
        body: form,
      })
      expect(res.status).toBe(403)
    })

    it('allows a same-origin multipart request', async () => {
      const cookie = await createUserAndLogin()
      const form = new FormData()
      form.set('file', jpegFile(1024))

      const res = await app.request('/api/v1/auth/me/avatar', {
        method: 'PUT',
        headers: { cookie },
        body: form,
      })
      expect(res.status).toBe(200)
    })

    it('never applies to the Plex webhook — bearer-token authenticated, not cookie-based, and Plex sends no fetch-metadata headers at all', async () => {
      // A bad token still 401s (its own check), which is the point: this
      // route is rejected by its own auth, not CSRF, regardless of origin.
      const form = new FormData()
      form.set('payload', JSON.stringify({ event: 'media.scrobble' }))
      const res = await app.request('/api/v1/webhooks/plex/not-a-real-token', {
        method: 'POST',
        body: form,
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('Invalid token')
    })

    it('does not apply to JSON requests regardless of origin', async () => {
      // hono/csrf only enforces on form-encodable content types — a JSON
      // POST from a foreign origin is rejected by CORS (browser-enforced,
      // not testable here) and the same-origin cookie policy, not CSRF.
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://evil.example.com' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever12345' }),
      })
      expect(res.status).not.toBe(403)
    })
  })

  describe('body limits (Stage C)', () => {
    it('rejects an oversized JSON body under the 1MB default, before any route-specific logic runs', async () => {
      const oversized = 'x'.repeat(1024 * 1024 + 1)
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: oversized }),
      })
      expect(res.status).toBe(413)
    })

    it('accepts a JSON body comfortably under the 1MB default', async () => {
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever12345' }),
      })
      // 401 (unknown email), not 413 — proves the default limit doesn't
      // clip an ordinary-sized request.
      expect(res.status).toBe(401)
    })

    it('rejects an avatar upload over its 2MB cap before parseBody() ever runs', async () => {
      const cookie = await createUserAndLogin()
      const form = new FormData()
      form.set('file', jpegFile(3 * 1024 * 1024))

      const res = await app.request('/api/v1/auth/me/avatar', {
        method: 'PUT',
        headers: { cookie },
        body: form,
      })
      expect(res.status).toBe(413)
    })

    it('rejects a Plex webhook body over its 64KB cap', async () => {
      const form = new FormData()
      form.set('payload', JSON.stringify({ event: 'media.scrobble', big: 'x'.repeat(65 * 1024) }))

      const res = await app.request('/api/v1/webhooks/plex/not-a-real-token', {
        method: 'POST',
        body: form,
      })
      expect(res.status).toBe(413)
    })
  })

  describe('security headers and CSP (Stage D)', () => {
    // secureHeaders() is mounted on '*' (outermost) in app.ts specifically
    // so these apply to every response shape, not just successful JSON
    // ones — checked against both a 200 and a 401 here. The SPA
    // fallback's HTML response isn't reachable from these unit tests
    // (testApp() never builds a `public/` dir for it to serve — see
    // app.ts's `existsSync(webDistDir)` guard), so that path is verified
    // live against dev.rwnd.tv instead, per the plan's verification step.
    it.each([
      ['a 200 JSON response', () => app.request('/api/v1/health')],
      ['a 401 JSON response', () => app.request('/api/v1/tokens')],
    ])('sets CSP, nosniff, and frame-ancestors/X-Frame-Options on %s', async (_label, make) => {
      const res = await make()
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')

      const csp = res.headers.get('content-security-policy')!
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("script-src 'self'")
      expect(csp).toContain("style-src 'self'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain('https://image.tmdb.org')
      expect(csp).toContain('https://artworks.thetvdb.com')
    })

    it('does not send HSTS when COOKIE_SECURE is off (this test env is plain HTTP)', async () => {
      const res = await app.request('/api/v1/health')
      // Only asserts the false branch, since env.ts's loadEnv() caches on
      // first call — COOKIE_SECURE can't be flipped mid-process to also
      // exercise the true branch here. That branch is a straight boolean
      // pass-through to hono/secure-headers' own strictTransportSecurity
      // option, which isn't this app's code to re-test; the live check
      // against dev.rwnd.tv (COOKIE_SECURE=true there) is what actually
      // proves it.
      expect(res.headers.get('strict-transport-security')).toBeNull()
    })

    it('denies camera/microphone/geolocation/payment via Permissions-Policy', async () => {
      const res = await app.request('/api/v1/health')
      const policy = res.headers.get('permissions-policy')!
      expect(policy).toContain('camera=()')
      expect(policy).toContain('microphone=()')
      expect(policy).toContain('geolocation=()')
      expect(policy).toContain('payment=()')
    })
  })
})
