// One-off helper for local dev — truncates all tables for a clean slate.
// Not part of the shipped package; not exported from index.ts.
import { sql } from 'drizzle-orm'
import { createDatabase } from './client.js'
import { loadDbEnv } from './env.js'

const { databaseUrl, ssl } = loadDbEnv()

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
  'api_tokens',
  'pending_webhook_events',
  'webhook_account_links',
  'sessions',
  'mfa_challenges',
  'user_recovery_codes',
  'user_totp',
  'user_credentials',
  'users',
  'instance_settings',
]

const db = createDatabase(databaseUrl, { ssl })
for (const table of TABLES) {
  await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`))
}
console.log('Reset complete.')
process.exit(0)
