import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { resolveSession } from '../lib/session.js'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'

/** Requires a valid session; responds 401 otherwise. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const env = loadEnv()
  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  const user = token ? await resolveSession(c.get('db'), token) : null
  if (!user) {
    return c.json({ error: 'unauthenticated' }, 401)
  }
  c.set('user', user)
  await next()
  return
})

/** Requires an authenticated admin. Must run after requireAuth. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  await next()
  return
})
