import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../types.js'
import type { LogFormat } from '../env.js'
import { getClientIp } from '../lib/client-ip.js'
import { redactPath } from '../lib/redact-path.js'

/**
 * One structured line per HTTP request — the general request-logging
 * pipeline the M3 ASVS review deliberately left as an open gap alongside
 * `lib/security-log.ts`'s narrower `[security]`-prefixed event log (see
 * that file's own doc comment for why the two stay separate streams
 * rather than merging). M5, docs/TODO.md.
 *
 * Hand-rolled rather than `hono/logger`: that middleware formats straight
 * to an opaque string with no field-level hook, so the path would already
 * be concatenated before anything could redact it — and this repo already
 * prefers a small in-house primitive over a dependency for exactly this
 * shape of problem (see `middleware/rate-limit.ts`'s own doc comment).
 *
 * Logs on the way OUT (after `await next()` resolves), not on the way in:
 * `c.get('user')` is only populated deep inside the `v1` sub-app, by
 * `requireSession` (middleware/auth.ts), well below wherever this mounts
 * in app.ts — but Hono's context is shared for the life of one request, so
 * it's readable once `next()` returns, and that also yields the real
 * response status rather than having to guess it.
 *
 * Always picks `user.id` off the context, never spreads `c.get('user')` —
 * that's the *full* users row, email included (see AppEnv, types.ts). Same
 * F-17 rule every `logSecurityEvent` call site already follows.
 *
 * The one special case: `await next()` is wrapped in try/catch so a
 * thrown `HTTPException` (every `hono/csrf` rejection, which app.ts's
 * `onError` currently returns without logging at all) still gets a line
 * with its real status, then rethrows so `onError` runs exactly as
 * before. `lib/body-limit.ts`'s 413 needs no equivalent special-casing —
 * it *returns* a response rather than throwing, so it already flows
 * through the normal path below.
 *
 * No query string is ever logged: `c.req.path` excludes it entirely, and
 * a request logger has no business recording a user's search terms or
 * date-range filters, security-relevant or not.
 */
export function requestLog(format: LogFormat, trustProxy: boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (format === 'silent') {
      await next()
      return
    }
    const startedAt = performance.now()

    const emit = (status: number) => {
      console.log(
        formatRequestLog(
          {
            at: new Date().toISOString(),
            method: c.req.method,
            path: redactPath(c.req.path),
            status,
            durationMs: Math.round(performance.now() - startedAt),
            userId: c.get('user')?.id ?? null,
            ip: getClientIp(c, trustProxy),
          },
          format,
        ),
      )
    }

    try {
      await next()
    } catch (err) {
      emit(err instanceof HTTPException ? err.status : 500)
      throw err
    }
    emit(c.res.status)
  })
}

interface RequestLogEntry {
  at: string
  method: string
  path: string
  status: number
  durationMs: number
  userId: string | null
  ip: string
}

export function formatRequestLog(entry: RequestLogEntry, format: 'json' | 'pretty'): string {
  if (format === 'json') return JSON.stringify(entry)
  return `${entry.at} ${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms user=${entry.userId ?? '-'} ip=${entry.ip}`
}
