// One-off helper for local dev — truncates all tables for a clean slate.
// Not part of the shipped package; not exported from index.ts.
import { sql } from 'drizzle-orm'
import { createDatabase } from './client.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL required')

const TABLES = [
  'plays',
  'ratings',
  'watchlist_items',
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
]

const db = createDatabase(url)
for (const table of TABLES) {
  await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`))
}
console.log('Reset complete.')
process.exit(0)
