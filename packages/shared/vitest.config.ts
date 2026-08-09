import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@rwnd/shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
