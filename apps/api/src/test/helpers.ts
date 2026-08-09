import { sql } from 'drizzle-orm'
import { createDatabase, users, userCredentials, type Database } from '@rwnd/db'
import { createApp } from '../app.js'
import { hashPassword } from '../lib/password.js'

/** Tables that accumulate rows across tests, in FK-safe delete order. */
const TABLES = [
  'plays',
  'external_ids',
  'episodes',
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
