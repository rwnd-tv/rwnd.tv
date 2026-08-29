import { describe, expect, it } from 'vitest'
import type { Env } from '../env.js'
import { sessionCookieName } from './cookies.js'

// A plain unit test against the pure name-deriving function, rather than a
// full app request — env.ts's loadEnv() caches on first call, so
// COOKIE_SECURE can't be flipped mid-suite to exercise both branches
// through a real request (see session.test.ts's comment on why its own
// cookie-shape test only ever sees the false branch).
function fakeEnv(overrides: Partial<Env>): Env {
  return { SESSION_COOKIE_NAME: 'rwnd_session', COOKIE_SECURE: false, ...overrides } as Env
}

describe('sessionCookieName', () => {
  it('uses the plain name when COOKIE_SECURE is false', () => {
    expect(sessionCookieName(fakeEnv({ COOKIE_SECURE: false }))).toBe('rwnd_session')
  })

  it('prefixes with __Host- when COOKIE_SECURE is true', () => {
    expect(sessionCookieName(fakeEnv({ COOKIE_SECURE: true }))).toBe('__Host-rwnd_session')
  })

  it('applies the prefix to a custom SESSION_COOKIE_NAME too', () => {
    expect(
      sessionCookieName(fakeEnv({ SESSION_COOKIE_NAME: 'my_cookie', COOKIE_SECURE: true })),
    ).toBe('__Host-my_cookie')
  })
})
