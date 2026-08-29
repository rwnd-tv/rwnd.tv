/**
 * Small, deliberately Zod-free counterpart to apps/api/src/env.ts — this
 * package can't depend on that one (wrong direction: apps depend on
 * packages, not back) but its four standalone scripts (migrate.ts, seed.ts,
 * reset-dev.ts, drizzle.config.ts) were each reading `process.env` directly
 * with their own ad hoc "throw if missing" check, which had already drifted
 * (drizzle.config.ts's message differs from the other three). One place to
 * read and validate `DATABASE_URL`/`DATABASE_SSL` instead (M3 security
 * review follow-up, docs/TODO.md).
 */
export interface DbEnv {
  databaseUrl: string
  /** Same string-not-boolean parsing as apps/api/src/env.ts's COOKIE_SECURE/
   * TRUST_PROXY, and the same reasoning: an empty string (what a
   * docker-compose `.env` file's `DATABASE_SSL=` line produces) must mean
   * "unset", not `Boolean("")` — which is `false` anyway here, but kept
   * consistent with those two rather than relying on that coincidence.
   * Defaults false: the bundled `db` service sits on the same
   * docker-compose network as `app`, an unencrypted link both containers
   * already trust implicitly (same network namespace, no other tenant on
   * it) — see docker-compose.yml. Set true for a remote/managed Postgres
   * that requires or offers TLS. */
  ssl: boolean
}

export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const databaseUrl = source.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }
  return { databaseUrl, ssl: source.DATABASE_SSL === 'true' }
}
