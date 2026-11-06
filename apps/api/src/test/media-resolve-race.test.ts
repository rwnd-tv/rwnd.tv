import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { externalIds, movies, shows } from '@rwnd/db'
import { resolveMovie, resolveShow } from '../lib/media.js'
import type { MetadataProvider } from '../providers/types.js'
import { resetDb, testDb } from './helpers.js'
import { fakeTmdb } from './webhook-fixtures.js'

const db = testDb()

/** Resolves once `count` callers are waiting, so both requests are certain to
 * have passed their "not known yet" lookup before either can create a row. */
function barrier(count: number): () => Promise<void> {
  let waiting = 0
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return async () => {
    waiting += 1
    if (waiting === count) release()
    await released
  }
}

/** fakeTmdb, with both provider fetches held until each request has reached
 * them. Any id is accepted for a show and answered with Breaking Bad's own,
 * the way a provider redirects an id that isn't the show's canonical one. */
function racingProvider(): MetadataProvider {
  const tmdb = fakeTmdb()
  const bothFetching = barrier(2)
  return {
    ...tmdb,
    async getMovie(externalId, locale) {
      await bothFetching()
      return tmdb.getMovie(externalId, locale)
    },
    async getShow(_externalId, locale) {
      await bothFetching()
      return tmdb.getShow('1396', locale)
    },
  }
}

describe('resolving a title that two requests see for the first time', () => {
  beforeEach(async () => {
    await resetDb(db)
  })

  it('creates one movie', async () => {
    const provider = racingProvider()

    const [a, b] = await Promise.all([
      resolveMovie(db, provider, '603', 'en-GB'),
      resolveMovie(db, provider, '603', 'en-GB'),
    ])

    expect(a.id).toBe(b.id)
    expect(await db.select().from(movies)).toHaveLength(1)
    expect(
      await db.select().from(externalIds).where(eq(externalIds.entityType, 'movie')),
    ).toHaveLength(1)
  })

  it('creates one show', async () => {
    const provider = racingProvider()

    const [a, b] = await Promise.all([
      resolveShow(db, provider, '1396', 'en-GB'),
      resolveShow(db, provider, '1396', 'en-GB'),
    ])

    expect(a.id).toBe(b.id)
    expect(await db.select().from(shows)).toHaveLength(1)
  })

  it('creates one show when the requests arrive under different ids for it', async () => {
    const provider = racingProvider()

    const [a, b] = await Promise.all([
      resolveShow(db, provider, '1396', 'en-GB'),
      resolveShow(db, provider, 'an-id-that-redirects', 'en-GB'),
    ])

    expect(a.id).toBe(b.id)
    expect(a.externalId).toBe('1396')
    expect(b.externalId).toBe('1396')
    expect(await db.select().from(shows)).toHaveLength(1)
    expect(
      await db
        .select()
        .from(externalIds)
        .where(and(eq(externalIds.entityType, 'show'), eq(externalIds.externalId, '1396'))),
    ).toHaveLength(1)
  })
})
