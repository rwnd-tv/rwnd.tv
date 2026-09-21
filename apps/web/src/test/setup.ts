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

// jsdom (still, as of v30) doesn't implement HTMLDialogElement's
// showModal()/close() at all — Dialog.tsx calls both directly, so any test
// rendering a component that opens one throws "showModal is not a
// function" without this. Good enough for jsdom's own non-modal `open`
// attribute + a real 'close' event (Dialog.tsx's own onClose is wired to
// that), which is all component tests need — no focus trapping or
// top-layer/::backdrop behaviour to fake.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

// jsdom does no layout at all, so Element.prototype.scrollIntoView doesn't
// exist — CalendarAgenda.tsx calls it directly to bring "Today" into view
// on first load, which throws "scrollIntoView is not a function" without
// this. A no-op is all a component test needs; there's no real scroll
// position to assert against in jsdom anyway.
Element.prototype.scrollIntoView = function () {}

// jsdom doesn't implement matchMedia at all — Layout.tsx and
// use-media-query.ts both call window.matchMedia() directly, so any test
// mounting a component that reads a breakpoint throws "matchMedia is not a
// function" without this. Defaults every query to non-matching (i.e. the
// "wide"/desktop layout), which is what every existing test already assumes;
// a test that wants the narrow layout stubs this globally itself
// (vi.stubGlobal('matchMedia', ...)) rather than relying on this default.
window.matchMedia = function (query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList
}

afterEach(() => {
  cleanup()
})
