import type { Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../env.js'

export function setSessionCookie(c: Context, env: Env, token: string, expiresAt: Date): void {
  setCookie(c, env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(c: Context, env: Env): void {
  deleteCookie(c, env.SESSION_COOKIE_NAME, { path: '/' })
}
