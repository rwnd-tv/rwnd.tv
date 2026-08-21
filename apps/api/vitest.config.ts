import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@rwnd/api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
    },
  },
})
