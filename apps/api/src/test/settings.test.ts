import { beforeEach, describe, expect, it } from 'vitest'
import { instanceSettings } from '@rwnd/db'
import type { InstanceSettings } from '@rwnd/shared'
import { extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

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
