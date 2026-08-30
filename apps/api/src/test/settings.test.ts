import { beforeEach, describe, expect, it } from 'vitest'
import { instanceSettings } from '@rwnd/db'
import type { InstanceAbout, InstanceSettings } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createAdminAndCookie() {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Admin',
    }),
  })
  return extractCookie(res)!
}

describe('/api/v1/settings — metadata provider priority', () => {
  beforeEach(() => resetDb(db))

  it('GET reports the default priority and what this instance has credentials for', async () => {
    const res = await app.request('/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await json<InstanceSettings>(res)
    // The test env only ever configures TMDB_API_KEY (see apps/api/.env) —
    // no test in this suite depends on a second provider actually existing.
    expect(body.metadataProviderPriority).toEqual(['tmdb'])
    expect(body.availableMetadataProviders).toEqual(['tmdb'])
  })

  it('PATCH accepts a priority list naming only configured providers', async () => {
    const cookie = await createAdminAndCookie()
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ metadataProviderPriority: ['tmdb'] }),
    })
    expect(res.status).toBe(200)
    const body = await json<InstanceSettings>(res)
    expect(body.metadataProviderPriority).toEqual(['tmdb'])
  })

  it('PATCH rejects a priority list naming a provider this instance has no credentials for', async () => {
    const cookie = await createAdminAndCookie()
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      // 'tvdb' is a real MetadataProviderSource (passes Zod), but nothing
      // in the test env configures a TVDB credential — this must fail the
      // "configured on *this* instance" check, not just the type check.
      body: JSON.stringify({ metadataProviderPriority: ['tvdb'] }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH rejects a non-admin, even when logged in', async () => {
    await createLocalUser(db, 'regular@example.com', 'correct-horse-battery-staple')
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'regular@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookie = extractCookie(login)!

    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ metadataProviderPriority: ['tmdb'] }),
    })
    expect(res.status).toBe(403)
  })

  it('PATCH rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadataProviderPriority: ['tmdb'] }),
    })
    expect(res.status).toBe(401)
  })

  it('narrows a row with junk in the priority column back to the default rather than erroring', async () => {
    // Simulates data from before this instance's providers changed (a
    // removed API key, a provider that no longer exists) — inserted
    // directly, bypassing the API's own validation, since the API itself
    // would never write this.
    await db
      .insert(instanceSettings)
      .values({ id: 1, metadataProviderPriority: ['not-a-real-provider', 'tvdb'] })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { metadataProviderPriority: ['not-a-real-provider', 'tvdb'] },
      })

    const res = await app.request('/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await json<InstanceSettings>(res)
    expect(body.metadataProviderPriority).toEqual(['tmdb'])
  })
})

describe('/api/v1/settings/about', () => {
  beforeEach(() => resetDb(db))

  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/settings/about')
    expect(res.status).toBe(401)
  })

  it('reports real runtime diagnostics for any logged-in user, not just an admin', async () => {
    await createLocalUser(db, 'regular@example.com', 'correct-horse-battery-staple')
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'regular@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookie = extractCookie(login)!

    const res = await app.request('/api/v1/settings/about', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await json<InstanceAbout>(res)
    expect(body.nodeVersion).toBe(process.version)
    expect(body.postgresVersion).toMatch(/^\d+/)
    // The real migrations table, run for real against this test's own
    // Postgres before the suite starts (see apps/api/.env / CI's
    // `pnpm db:migrate` step) — not a mock, so this just needs to be a
    // real, growing count rather than any specific number.
    expect(body.migrationCount).toBeGreaterThan(0)
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
    // Test env doesn't set ENVIRONMENT_LABEL (see apps/api/.env / ci.yml).
    expect(body.environmentLabel).toBeNull()
  })
})
