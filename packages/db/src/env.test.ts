import { describe, expect, it } from 'vitest'
import { loadDbEnv } from './env.js'

const url = 'postgres://user:pass@localhost:5432/db'

describe('loadDbEnv', () => {
  it('throws when DATABASE_URL is unset', () => {
    expect(() => loadDbEnv({})).toThrow(/DATABASE_URL/)
  })

  it('defaults ssl to false when DATABASE_SSL is unset', () => {
    expect(loadDbEnv({ DATABASE_URL: url })).toEqual({ databaseUrl: url, ssl: false })
  })

  it('treats the literal string "false" as false', () => {
    expect(loadDbEnv({ DATABASE_URL: url, DATABASE_SSL: 'false' }).ssl).toBe(false)
  })

  it('treats the literal string "true" as true', () => {
    expect(loadDbEnv({ DATABASE_URL: url, DATABASE_SSL: 'true' }).ssl).toBe(true)
  })
})
