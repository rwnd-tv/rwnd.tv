import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  TMDB_API_KEY: 'test-key',
}

describe('COOKIE_SECURE parsing', () => {
  // Regression test: z.coerce.boolean() does JS `Boolean(value)`, under
  // which the string "false" is truthy (it's a non-empty string) — this
  // silently defeated COOKIE_SECURE=false in a real deployment.
  it('treats the literal string "false" as false', () => {
    expect(parseEnv({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false)
  })

  it('treats the literal string "true" as true', () => {
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
  })

  it('defaults to false outside production when unset', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false)
  })
})
