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
 * Stage C of the M3 security review (docs/security/asvs-l1.md) — CSRF
 * (hono/csrf) and body-size limits (hono/body-limit), both wired in
 * app.ts. Grows through later stages (security headers, rate limiting) as
 * they land; see each `it`'s comment for which stage added it.
 */
describe('hardening — CSRF and body limits', () => {
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
})
