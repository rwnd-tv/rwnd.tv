import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@rwnd/api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/fetch-defaults.ts'],
    hookTimeout: 20_000,
    // All test files share one real Postgres database and truncate tables
    // in beforeEach — running files in parallel races those truncations
    // against in-flight requests in other files and produces flaky 401s/500s.
    fileParallelism: false,
    env: {
      // loadEnv() caches on first call, so Trakt import config has to be
      // present before testApp() ever runs — not real credentials, tests
      // stub `fetch` rather than calling Trakt/TMDB for real (see
      // src/test/imports.test.ts).
      TRAKT_CLIENT_ID: 'ci-placeholder-client-id',
      TRAKT_CLIENT_SECRET: 'ci-placeholder-client-secret',
      // 32 zero bytes, base64-encoded — deterministic, not a real secret.
      ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      // Backup files land under a per-user subdirectory, keyed by email —
      // a fixed literal per test, not a fresh random id, so
      // src/test/backups.test.ts wipes this directory itself in
      // beforeEach rather than relying on it staying clean across runs.
      BACKUP_DIR: join(tmpdir(), 'rwnd-tv-test-backups'),
      // Automatic whole-database backup status (GET /admin/database-backups).
      // A separate directory from BACKUP_DIR above, same reasoning as the
      // env var itself (env.ts's DATABASE_BACKUP_DIR comment) — a fixed
      // literal per test, wiped in src/test/admin-database-backups.test.ts's
      // own beforeEach.
      DATABASE_BACKUP_DIR: join(tmpdir(), 'rwnd-tv-test-database-backups'),
      // middleware/request-log.ts logs one line per request; unsilenced,
      // that's a line per request across all 30+ files in this suite.
      // src/test/request-log.test.ts overrides this per-instance via
      // testApp({ logFormat: ... }) — see createApp()'s own doc comment
      // for why that override exists at all (loadEnv() caches, so this
      // env var can't be toggled per test otherwise).
      LOG_FORMAT: 'silent',
    },
  },
})
