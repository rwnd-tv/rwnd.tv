import { bodyLimit } from 'hono/body-limit'
import type { MiddlewareHandler } from 'hono'

/**
 * Hono's own bodyLimit throws an HTTPException by default, whose plain-text
 * response doesn't match this API's `{error: string}` JSON convention —
 * this wraps it with a JSON 413 instead. Returning the response directly
 * (rather than throwing) also sidesteps app.ts's onError handler, which
 * only special-cases HTTPException for exactly this reason.
 */
export function jsonBodyLimit(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: 'Request body is too large' }, 413),
  })
}
