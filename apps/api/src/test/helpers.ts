import { sql } from 'drizzle-orm'
import { createDatabase, traktConnections, users, userCredentials, type Database } from '@rwnd/db'
import { createApp } from '../app.js'
import { hashPassword } from '../lib/password.js'
import { encryptSecret } from '../lib/crypto.js'
import { loadEnv } from '../env.js'
import { resetRateLimits } from '../middleware/rate-limit.js'

/** Tables that accumulate rows across tests, in FK-safe delete order. */
const TABLES = [
  'plays',
  'ratings',
  'watchlist_items',
  'watchlists',
  'dropped_shows',
  'import_jobs',
  'trakt_connections',
  'external_ids',
  'episodes',
  'seasons',
  'shows',
  'movies',
  'invites',
  'login_attempts',
  'pending_webhook_events',
  'webhook_account_links',
  'api_tokens',
  'sessions',
  'mfa_challenges',
  'user_recovery_codes',
  'user_totp',
  'user_credentials',
  'users',
  'instance_settings',
] as const

export function testDb(): Database {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set to run apps/api integration tests')
  return createDatabase(url)
}

export async function resetDb(db: Database): Promise<void> {
  for (const table of TABLES) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`))
  }
  // Rate-limit buckets (middleware/rate-limit.ts) are in-memory and keyed
  // by client IP — every request through Hono's fetch-based test harness
  // falls back to the same 'unknown' IP (there's no real socket for
  // getConnInfo to read), so without this every test file sharing one
  // process (fileParallelism is off, see vitest.config.ts) would drain
  // the same buckets. Almost every test file's beforeEach already calls
  // resetDb(), which is what makes bundling this in here — rather than a
  // second reset call every test file would need to remember — the
  // simplest fix.
  resetRateLimits()
}

/**
 * A real browser attaches `Sec-Fetch-Site` to every fetch automatically —
 * it's computed by the browser itself, not settable by page JS — so a
 * legitimate same-origin request always carries `same-origin` and passes
 * hono/csrf's default check (Stage C, M3 security review). vitest's fetch
 * harness has no browser underneath it and never sends this header, so
 * every test in this suite is a same-origin request (the app calling its
 * own API, exactly what every one of these tests exercises) that would
 * otherwise be misclassified as an unheadered cross-site one and 403 —
 * hono/csrf treats a request with no Content-Type as `text/plain`
 * (form-encodable) by default, which is what a bodyless POST/DELETE call
 * ends up as. This restores that default at the harness level so tests
 * reflect real browser behaviour; apps/api/src/test/hardening.test.ts's
 * CSRF tests explicitly override it to exercise the rejection path.
 */
export function testApp() {
  const app = createApp()
  return {
    request: async (input: string | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin')
      return app.request(input, { ...init, headers })
    },
  }
}

export function extractCookie(res: Response): string | undefined {
  const setCookie = res.headers.get('set-cookie')
  return setCookie?.split(';')[0]
}

/** `Response#json()` is typed `Promise<unknown>` — this just names the expected shape at the call site. */
export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

/**
 * Inserts a local-credential user directly, bypassing setup/registration —
 * for tests that need a *second* user (setup only ever creates one admin,
 * and registration may be closed).
 */
export async function createLocalUser(
  db: Database,
  email: string,
  password: string,
): Promise<string> {
  const [user] = await db.insert(users).values({ email, displayName: email }).returning()
  if (!user) throw new Error('Failed to create test user')
  await db
    .insert(userCredentials)
    .values({ userId: user.id, type: 'local', passwordHash: await hashPassword(password) })
  return user.id
}

/**
 * Inserts a Trakt connection directly, bypassing the device-flow pairing
 * dance — for tests that want to exercise import behaviour without also
 * re-testing pairing (which has its own dedicated test).
 */
export async function createTraktConnection(db: Database, userId: string): Promise<void> {
  const env = loadEnv()
  await db.insert(traktConnections).values({
    userId,
    traktUsername: 'test-trakt-user',
    accessTokenEncrypted: encryptSecret('test-access-token', env.ENCRYPTION_KEY!),
    refreshTokenEncrypted: encryptSecret('test-refresh-token', env.ENCRYPTION_KEY!),
    accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
}

/**
 * Polls `fn` until it returns a truthy value, or throws once `timeoutMs`
 * elapses. Needed because pairing and import both kick off fire-and-forget
 * background work (see routes/imports.ts) rather than blocking the HTTP
 * response on it — a real client would poll GET endpoints the same way.
 */
export async function waitFor<T>(
  fn: () => Promise<T | undefined | null | false>,
  { timeoutMs = 5000, intervalMs = 20 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await fn()
    if (result) return result
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
