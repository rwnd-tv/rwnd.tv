import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@rwnd/db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
