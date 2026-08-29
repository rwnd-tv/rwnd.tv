import { beforeEach, vi } from 'vitest'

const realFetch = globalThis.fetch

/**
 * Vitest `setupFiles` entry (apps/api/vitest.config.ts) — re-established
 * before *every* test in the suite, not just once, since a test file that
 * calls `vi.unstubAllGlobals()` in its own `afterEach` (imports.test.ts's
 * Trakt-stubbing pattern) would otherwise wipe this out for every test
 * after the first in that file.
 *
 * Without this, any route that calls `isPasswordPwned()` (lib/hibp.ts —
 * /setup, /auth/register, /auth/me/password, /auth/reset-password) would
 * make a real network call to api.pwnedpasswords.com on every test that
 * creates a user or sets a password — nearly the entire suite. That's slow,
 * flaky under CI rate limits, and worse, silently depends on HIBP's
 * database never adding this suite's fixture passwords in the future (all
 * currently confirmed clean, checked by hand against the real API while
 * adding this check — see docs/TODO_ARCHIVE.md). A test file that actually
 * wants to exercise the "password is breached" branch stubs `fetch` itself
 * within that specific test, same as any other test overriding this
 * default (see hibp.test.ts).
 *
 * Passes every other URL straight through to the real `fetch` — this is
 * deliberately narrow to just the one host, not a blanket network-off
 * switch, so it doesn't interfere with imports.test.ts's own Trakt/TMDB
 * stubbing (which fully replaces `fetch` for its own tests regardless).
 */
beforeEach(() => {
  vi.stubGlobal('fetch', (async (...args: Parameters<typeof fetch>) => {
    const [input] = args
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://api.pwnedpasswords.com/')) {
      return new Response('')
    }
    return realFetch(...args)
  }) satisfies typeof fetch)
})
