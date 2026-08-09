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
  },
})
