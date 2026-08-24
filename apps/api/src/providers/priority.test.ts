import { describe, expect, it } from 'vitest'
import type { Database } from '@rwnd/db'
import type { MetadataProvider } from './types.js'
import { orderedProviders } from './priority.js'

/** Fakes only the one drizzle call chain orderedProviders() actually makes
 * (`select({...}).from(instanceSettings).limit(1)`) — a real testDb()
 * needs DATABASE_URL, which this session doesn't have, and this function's
 * logic doesn't need anything else from the database. */
function fakeDb(row?: { metadataProviderPriority: string[] }): Database {
  return {
    select: () => ({
      from: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  } as unknown as Database
}

function fakeProvider(source: MetadataProvider['source']): MetadataProvider {
  return { source } as unknown as MetadataProvider
}

const tmdb = fakeProvider('tmdb')
const tvdb = fakeProvider('tvdb')

describe('orderedProviders', () => {
  it('honours the stored priority order', async () => {
    const db = fakeDb({ metadataProviderPriority: ['tvdb', 'tmdb'] })
    const result = await orderedProviders(db, [tmdb, tvdb])
    expect(result).toEqual([tvdb, tmdb])
  })

  it('drops unknown or unconfigured entries from the stored list', async () => {
    // 'wikidata' isn't a real MetadataProviderSource at all, and 'tvdb'
    // isn't in the `providers` array passed in (not configured on this
    // instance) — both should be silently dropped, not throw.
    const db = fakeDb({ metadataProviderPriority: ['wikidata', 'tvdb', 'tmdb'] })
    const result = await orderedProviders(db, [tmdb])
    expect(result).toEqual([tmdb])
  })

  it('appends an available provider the stored list does not mention', async () => {
    const db = fakeDb({ metadataProviderPriority: ['tvdb'] })
    const result = await orderedProviders(db, [tmdb, tvdb])
    expect(result).toEqual([tvdb, tmdb])
  })

  it('falls back to providers order when there is no stored row at all', async () => {
    const db = fakeDb(undefined)
    const result = await orderedProviders(db, [tmdb, tvdb])
    expect(result).toEqual([tmdb, tvdb])
  })

  it('never returns an empty array when at least one provider is configured', async () => {
    const db = fakeDb({ metadataProviderPriority: [] })
    const result = await orderedProviders(db, [tmdb])
    expect(result).toEqual([tmdb])
  })
})
