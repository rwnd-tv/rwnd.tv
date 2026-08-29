import type { Context } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Env } from '../env.js'

/**
 * `__Host-` is the strictest cookie-name prefix a browser recognizes: it
 * mandates `Secure`, forbids `Domain`, and requires `Path=/` — all already
 * true of this cookie except `Secure`, so the prefix is applied whenever
 * `COOKIE_SECURE` confirms the instance is genuinely on HTTPS (ASVS V3.4.4,
 * M3 security review follow-up, docs/TODO.md). Not applied
 * unconditionally: it would break the documented plain-HTTP LAN-only
 * deployment (docs/self-hosting.md) — a browser silently drops any cookie
 * carrying this prefix that isn't also `Secure`, and `Secure` cookies are
 * never sent back over plain HTTP at all.
 *
 * Derived from `env.SESSION_COOKIE_NAME` rather than hardcoded, so a
 * self-hoster who's set a custom name still gets the prefix. Every read
 * site (this file, `middleware/auth.ts`, and the two direct
 * `getSessionToken` call sites in `routes/auth.ts`) goes through this one
 * function so the write and read sides can't drift onto different names.
 *
 * Flipping `COOKIE_SECURE` on logs every existing session out once — the
 * cookie name itself changes, so a session cookie set under the old name is
 * never found under the new one. Expected, not a bug: a self-hoster putting
 * HTTPS in front of a previously plain-HTTP instance is a one-time event.
 */
export function sessionCookieName(env: Env): string {
  return env.COOKIE_SECURE ? `__Host-${env.SESSION_COOKIE_NAME}` : env.SESSION_COOKIE_NAME
}

export function getSessionToken(c: Context, env: Env): string | undefined {
  return getCookie(c, sessionCookieName(env))
}

export function setSessionCookie(c: Context, env: Env, token: string, expiresAt: Date): void {
  setCookie(c, sessionCookieName(env), token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(c: Context, env: Env): void {
  // `secure` here isn't optional once the name carries the __Host- prefix
  // (sessionCookieName() above) — hono's own serializer throws "__Host-
  // Cookie must have Secure attributes" if it's left out, which surfaced as
  // a real 500 on every route that clears the cookie (logout, account
  // deletion) the moment COOKIE_SECURE went true on a live deploy. Caught
  // live on dev.rwnd.tv, not by the test suite — resolveSession()'s own
  // unit tests only ever run with COOKIE_SECURE false (see cookies.test.ts's
  // comment on why), so this branch had no test coverage until now; see the
  // new coverage below.
  deleteCookie(c, sessionCookieName(env), { path: '/', secure: env.COOKIE_SECURE })
}
