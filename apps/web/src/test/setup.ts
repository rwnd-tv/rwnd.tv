import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import i18next from 'i18next'
// Real i18n, not a stub — a component test then exercises the actual
// English strings, which gives free detection of a missing/renamed
// translation key as a side effect of just rendering. `init()` is async
// (see i18n/index.ts's own `void i18n.use(...).init(...)`, which doesn't
// expose that promise), so wait for the shared i18next singleton's own
// 'initialized' event rather than assume it settles before a test's first
// render.
import '../i18n/index.js'

if (!i18next.isInitialized) {
  await new Promise<void>((resolve) => i18next.on('initialized', () => resolve()))
}

afterEach(() => {
  cleanup()
})
