import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // apps/api's test files all share one real Postgres database and
    // truncate tables in beforeEach; running files in parallel (the
    // default, and something the old `vitest.workspace.ts` didn't prevent
    // even with a per-project `fileParallelism: false`) races those
    // truncations against in-flight requests in other files.
    fileParallelism: false,
    projects: [
      'apps/api/vitest.config.ts',
      'apps/web/vitest.config.ts',
      'packages/db/vitest.config.ts',
      'packages/shared/vitest.config.ts',
    ],
  },
})
