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

  it('defaults to true in production when unset', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true)
  })

  // Regression test (M3 security review, F-01, found via a real
  // end-to-end docker-compose deploy): a `.env` file's `COOKIE_SECURE=`
  // (present, nothing after the `=` — exactly what .env.example ships)
  // is a *defined* empty string once docker-compose passes it through,
  // not an absent variable. Treating that the same as unset — rather
  // than as an explicit "false" — is what makes the NODE_ENV-based
  // default actually reachable in a real deployment.
  it('treats an empty string the same as unset, in production too', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: '' }).COOKIE_SECURE).toBe(
      true,
    )
  })

  it('treats an empty string the same as unset, outside production too', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'development', COOKIE_SECURE: '' }).COOKIE_SECURE).toBe(
      false,
    )
  })
})

describe('APP_URL parsing', () => {
  // Regression test (M3 security review, found via the same real
  // end-to-end deploy as the COOKIE_SECURE one above): every self-hosted
  // instance that didn't configure SMTP used to crash on startup with
  // "APP_URL: Invalid URL" — an eager `.url()` check on the raw schema
  // ran unconditionally, even though APP_URL is only actually needed
  // once SMTP_HOST is set, and .env.example ships an empty (but present)
  // APP_URL= line by default.
  it('does not reject an empty APP_URL when SMTP is not configured', () => {
    expect(() => parseEnv({ ...base, APP_URL: '' })).not.toThrow()
  })

  it('does not require APP_URL to be present at all when SMTP is not configured', () => {
    expect(() => parseEnv(base)).not.toThrow()
  })

  it('requires a syntactically valid URL once SMTP_HOST is set', () => {
    expect(() =>
      parseEnv({
        ...base,
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_FROM: 'rwnd.tv <noreply@example.com>',
        APP_URL: 'not-a-url',
      }),
    ).toThrow(/APP_URL must be a valid URL/)
  })

  it('accepts a valid APP_URL alongside a fully configured SMTP setup', () => {
    expect(() =>
      parseEnv({
        ...base,
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_FROM: 'rwnd.tv <noreply@example.com>',
        APP_URL: 'https://rwnd.tv',
      }),
    ).not.toThrow()
  })
})

describe('TRUST_PROXY parsing', () => {
  it('defaults to false when unset', () => {
    expect(parseEnv(base).TRUST_PROXY).toBe(false)
  })

  it('treats the literal string "false" as false', () => {
    expect(parseEnv({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false)
  })

  it('treats the literal string "true" as true', () => {
    expect(parseEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true)
  })
})

describe('DATABASE_SSL parsing', () => {
  it('defaults to false when unset', () => {
    expect(parseEnv(base).DATABASE_SSL).toBe(false)
  })

  it('treats the literal string "false" as false', () => {
    expect(parseEnv({ ...base, DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(false)
  })

  it('treats the literal string "true" as true', () => {
    expect(parseEnv({ ...base, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true)
  })
})

describe('metadata provider config', () => {
  it('requires at least one of TMDB_API_KEY or TVDB_API_KEY', () => {
    expect(() => parseEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      /At least one metadata provider/,
    )
  })

  it('is fine with only TVDB_API_KEY set', () => {
    expect(() =>
      parseEnv({ DATABASE_URL: base.DATABASE_URL, TVDB_API_KEY: 'tvdb-key' }),
    ).not.toThrow()
  })

  it('is fine with both configured', () => {
    expect(() => parseEnv({ ...base, TVDB_API_KEY: 'tvdb-key' })).not.toThrow()
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

describe('ENCRYPTION_KEY shape validation (standalone, no Trakt config)', () => {
  // MFA enrollment (lib/crypto.ts's encryptSecret, same as Trakt tokens)
  // also needs a valid key — a self-hoster might set this solely for that,
  // never touching Trakt at all, so this has to be checked independent of
  // TRAKT_CLIENT_ID.
  it('is fine with no ENCRYPTION_KEY at all', () => {
    expect(() => parseEnv(base)).not.toThrow()
  })

  it('rejects an ENCRYPTION_KEY that is not 32 bytes, with no Trakt config set', () => {
    expect(() =>
      parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/)
  })

  it('accepts a valid 32-byte ENCRYPTION_KEY with no Trakt config set', () => {
    expect(() =>
      parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }),
    ).not.toThrow()
  })
})
