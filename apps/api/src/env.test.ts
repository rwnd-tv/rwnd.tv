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

describe('Trakt import config', () => {
  const validKey = Buffer.alloc(32, 7).toString('base64')

  it('is fine with no Trakt config at all', () => {
    expect(() => parseEnv(base)).not.toThrow()
  })

  it('requires TRAKT_CLIENT_SECRET when TRAKT_CLIENT_ID is set', () => {
    expect(() => parseEnv({ ...base, TRAKT_CLIENT_ID: 'id', ENCRYPTION_KEY: validKey })).toThrow(
      /TRAKT_CLIENT_SECRET/,
    )
  })

  it('requires ENCRYPTION_KEY when TRAKT_CLIENT_ID is set', () => {
    expect(() =>
      parseEnv({ ...base, TRAKT_CLIENT_ID: 'id', TRAKT_CLIENT_SECRET: 'secret' }),
    ).toThrow(/ENCRYPTION_KEY/)
  })

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(() =>
      parseEnv({
        ...base,
        TRAKT_CLIENT_ID: 'id',
        TRAKT_CLIENT_SECRET: 'secret',
        ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      }),
    ).toThrow(/32 bytes/)
  })

  it('accepts a valid full Trakt configuration', () => {
    expect(() =>
      parseEnv({
        ...base,
        TRAKT_CLIENT_ID: 'id',
        TRAKT_CLIENT_SECRET: 'secret',
        ENCRYPTION_KEY: validKey,
      }),
    ).not.toThrow()
  })
})
