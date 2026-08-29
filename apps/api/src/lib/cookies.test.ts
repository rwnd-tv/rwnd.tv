import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../env.js'
import {
  clearSessionCookie,
  getSessionToken,
  sessionCookieName,
  setSessionCookie,
} from './cookies.js'

// A plain unit test against the pure name-deriving function, rather than a
// full app request — env.ts's loadEnv() caches on first call, so
// COOKIE_SECURE can't be flipped mid-suite to exercise both branches
// through a real *app* request (see session.test.ts's comment on why its
// own cookie-shape test only ever sees the false branch). A standalone Hono
// app built fresh per test, below, sidesteps that cache entirely by never
// calling loadEnv() at all — this is what actually exercises the
// COOKIE_SECURE-true / __Host- branch end to end.
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

/**
 * Regression coverage for a real bug caught live on dev.rwnd.tv, not by
 * any test: hono's own cookie serializer throws ("__Host- Cookie must have
 * Secure attributes") if a `__Host-`-prefixed cookie is cleared without
 * `secure: true` in the options — clearSessionCookie() originally only
 * passed `{ path: '/' }`, which 500'd every route that clears the session
 * cookie (logout, account deletion) the moment COOKIE_SECURE went true.
 * These build a real (fake-env, not loadEnv()-backed) Hono app so the
 * actual serialization path runs, not just sessionCookieName()'s string
 * math above.
 */
describe('setSessionCookie / clearSessionCookie (COOKIE_SECURE true)', () => {
  const env = fakeEnv({ COOKIE_SECURE: true })

  it('sets a Secure, __Host--prefixed cookie', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      setSessionCookie(c, env, 'a-token', new Date(Date.now() + 1000))
      return c.body(null, 204)
    })
    const res = await app.request('/')
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(/^__Host-rwnd_session=/)
    expect(setCookie).toMatch(/Secure/i)
  })

  it('clears the cookie without throwing', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      clearSessionCookie(c, env)
      return c.body(null, 204)
    })
    const res = await app.request('/')
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-rwnd_session=;/)
  })

  it('round-trips through getSessionToken', async () => {
    const app = new Hono()
    app.get('/set', (c) => {
      setSessionCookie(c, env, 'a-token', new Date(Date.now() + 1000))
      return c.body(null, 204)
    })
    app.get('/read', (c) => c.json({ token: getSessionToken(c, env) ?? null }))

    const setRes = await app.request('/set')
    const cookie = setRes.headers.get('set-cookie')!.split(';')[0]!
    const readRes = await app.request('/read', { headers: { cookie } })
    expect(await readRes.json()).toEqual({ token: 'a-token' })
  })
})
