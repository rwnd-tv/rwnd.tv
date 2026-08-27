import { defineConfig } from 'vitest/config'

// Web has no jsdom/component-testing setup — this covers the DOM-free pure
// functions only (library-filter.ts, the RatingPicker star maths), which is
// exactly what those files were written to be testable without one. See
// library-filter.ts's own doc comment.
export default defineConfig({
  test: {
    name: '@rwnd/web',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
