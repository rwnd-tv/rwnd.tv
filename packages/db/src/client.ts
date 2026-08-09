import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Database = ReturnType<typeof createDatabase>

export function createDatabase(connectionString: string) {
  // Postgres NOTICE messages (e.g. "truncate cascades to table X") are
  // informational, not warnings — the default handler logs them to stderr,
  // which is just noise for behaviour this app relies on intentionally.
  const client = postgres(connectionString, { onnotice: () => {} })
  return drizzle(client, { schema })
}
