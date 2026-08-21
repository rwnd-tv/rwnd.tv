import { sql } from 'drizzle-orm'
import { createDatabase, traktConnections, users, userCredentials, type Database } from '@rwnd/db'
import { createApp } from '../app.js'
import { hashPassword } from '../lib/password.js'
import { encryptSecret } from '../lib/crypto.js'
import { loadEnv } from '../env.js'

/** Tables that accumulate rows across tests, in FK-safe delete order. */
const TABLES = [
  'plays',
  'ratings',
  'watchlist_items',
  'dropped_shows',
  'import_jobs',
  'trakt_connections',
  'external_ids',
  'episodes',
  'seasons',
  'shows',
  'movies',
  'invites',
  'api_tokens',
  'sessions',
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
}

export function testApp() {
  return createApp()
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
