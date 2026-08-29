import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { User } from '@rwnd/shared'
import { json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

describe('POST /api/v1/setup', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  it('reports setup required when no admin exists', async () => {
    const res = await app.request('/api/v1/setup')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ required: true })
  })

  it('creates the first admin and logs them in', async () => {
    const res = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Admin',
      }),
    })
    expect(res.status).toBe(201)
    const body = await json<User>(res)
    expect(body.role).toBe('admin')
    expect(body.email).toBe('admin@example.com')
    expect(res.headers.get('set-cookie')).toMatch(/rwnd_session=/)
  })

  it('rejects a breached password for the first admin too (ASVS V2.1.7)', async () => {
    const password = 'a-password-this-test-pretends-is-breached'
    const suffix = createHash('sha1').update(password).digest('hex').toUpperCase().slice(5)
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(`${suffix}:1`)))

    const res = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password, displayName: 'Admin' }),
    })
    expect(res.status).toBe(400)

    const status = await app.request('/api/v1/setup')
    expect(await status.json()).toEqual({ required: true })
  })

  it('refuses to run twice', async () => {
    const create = () =>
      app.request('/api/v1/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'correct-horse-battery-staple',
          displayName: 'Admin',
        }),
      })

    expect((await create()).status).toBe(201)
    expect((await create()).status).toBe(409)

    const status = await app.request('/api/v1/setup')
    expect(await status.json()).toEqual({ required: false })
  })
})
