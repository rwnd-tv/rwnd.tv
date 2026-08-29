import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Database = ReturnType<typeof createDatabase>

/**
 * The `tx` handle inside `db.transaction(async (tx) => {...})` — structurally
 * compatible with `Database` for querying, but a distinct type Drizzle
 * generates internally, so a helper that needs to run either inside or
 * outside a transaction (e.g. apps/api/src/lib/slug.ts's
 * generateUniqueShowSlug, reused by both show-resolution and backup
 * restore) has to accept `Database | Tx`, not just `Database`. Derived from
 * `Database` itself via utility types rather than importing Drizzle's
 * internal transaction type by name, so it can't drift out of sync with it.
 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export function createDatabase(connectionString: string) {
  // Postgres NOTICE messages (e.g. "truncate cascades to table X") are
  // informational, not warnings — the default handler logs them to stderr,
  // which is just noise for behaviour this app relies on intentionally.
  //
  // `max` matches postgres-js's own default (10) — made explicit rather
  // than left implicit, so it's an intentional, tunable bound rather than
  // whatever the library happens to default to (M3 security review).
  // Generous for a single-container self-hosted instance; raise it only
  // alongside Postgres's own max_connections if a self-hoster ever needs
  // to.
  const client = postgres(connectionString, { onnotice: () => {}, max: 10 })
  return drizzle(client, { schema })
}
