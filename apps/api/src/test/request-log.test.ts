import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractCookie, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
// Overrides the suite-wide LOG_FORMAT=silent (vitest.config.ts) for this
// file only — see createApp()'s own doc comment (app.ts) for why the
// override has to be passed in at construction rather than toggled later.
const app = testApp({ logFormat: 'json' })

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
  const buf = new Uint8Array(bytes)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  return new File([buf], 'avatar.jpg', { type: 'image/jpeg' })
}

interface RequestLogEntry {
  at: string
  method: string
  path: string
  status: number
  durationMs: number
  userId: string | null
  ip: string
}

// The request log is the only thing on console.log in these tests besides
// `[security]` lines (lib/security-log.ts), which aren't valid JSON on
// their own (a plain-string first arg, a JSON string second) — filtering
// to single-argument, JSON-parseable calls is enough to isolate this
// middleware's own output.
function requestLogEntries(spy: ReturnType<typeof vi.spyOn>): RequestLogEntry[] {
  const calls = spy.mock.calls as unknown[][]
  return calls
    .map((call: unknown[]) => call[0])
    .filter((arg: unknown): arg is string => typeof arg === 'string' && arg.startsWith('{'))
    .map((line: string) => JSON.parse(line) as RequestLogEntry)
}

describe('structured request logging (M5)', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.restoreAllMocks())

  it('never writes a webhook token to the log, only the scrubbed path', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const form = new FormData()
    form.set('payload', JSON.stringify({ event: 'media.scrobble' }))

    const res = await app.request('/api/v1/webhooks/plex/rwnd_super-secret-token', {
      method: 'POST',
      body: form,
    })
    expect(res.status).toBe(401)

    const entry = requestLogEntries(spy).at(-1)!
    expect(entry.path).toBe('/api/v1/webhooks/plex/[redacted]')
    expect(JSON.stringify(entry)).not.toContain('rwnd_super-secret-token')
    expect(entry.status).toBe(401)
  })

  it('logs the authenticated user id and never their email', async () => {
    const cookie = await createUserAndLogin()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await app.request('/api/v1/tokens', { headers: { cookie } })

    const entry = requestLogEntries(spy).at(-1)!
    expect(entry.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(entry)).not.toContain('user@example.com')
  })

  it("logs a CSRF rejection, which app.ts's onError returns silently today", async () => {
    const cookie = await createUserAndLogin()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const form = new FormData()
    form.set('file', jpegFile(1024))

    const res = await app.request('/api/v1/auth/me/avatar', {
      method: 'PUT',
      headers: { cookie, origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' },
      body: form,
    })
    expect(res.status).toBe(403)

    expect(requestLogEntries(spy).at(-1)!.status).toBe(403)
  })

  it('logs method, scrubbed path, status and a duration on an ordinary request', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await app.request('/api/v1/health')

    const entry = requestLogEntries(spy).at(-1)!
    expect(entry).toMatchObject({
      method: 'GET',
      path: '/api/v1/health',
      status: 200,
      userId: null,
    })
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    expect(entry.at).toBeTruthy()
  })

  it('logs a 413 from the body-size limit, which bypasses onError but still flows through the normal response path', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const oversized = 'x'.repeat(1024 * 1024 + 1)

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: oversized }),
    })
    expect(res.status).toBe(413)

    expect(requestLogEntries(spy).at(-1)!.status).toBe(413)
  })
})
