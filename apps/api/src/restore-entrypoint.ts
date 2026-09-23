import { loadEnv } from './env.js'
import { runPendingRestore } from './lib/database-restore.js'

/**
 * Standalone entry point, built to its own `dist/restore-entrypoint.js` (see
 * tsup.config.ts) and run by docker-entrypoint.sh before migrations, on
 * every boot. Deliberately not a function called from index.ts: by design
 * it has to run *after* the app process that requested a restore has fully
 * exited (see database-restore.ts's module doc comment for why — the live
 * connection pool would race the restore for schema locks), which for a
 * single-process container means a separate process, not a code path inside
 * the same one.
 *
 * No-ops when DATABASE_BACKUP_DIR is unset, same "feature is off" gate
 * scheduleDatabaseBackup uses — there is nowhere a request marker could
 * have been written.
 *
 * `runPendingRestore` never throws, but this is genuinely the very last
 * thing that can go wrong before startup would otherwise proceed, so it
 * gets its own catch too, on top of docker-entrypoint.sh's own `|| echo`
 * fallback for this step — a crash loop here would be worse than any
 * restore outcome, including a failed one.
 */
async function main(): Promise<void> {
  const env = loadEnv()
  if (!env.DATABASE_BACKUP_DIR) return
  await runPendingRestore({
    dir: env.DATABASE_BACKUP_DIR,
    databaseUrl: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
  })
}

main()
  .catch((err: unknown) => {
    console.error('Database restore step failed unexpectedly; continuing normal startup:', err)
  })
  .finally(() => process.exit(0))
