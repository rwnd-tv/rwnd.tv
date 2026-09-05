import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { movies } from '@rwnd/db'
import { resetDb, testDb } from '../test/helpers.js'
import { localeRegion, releaseDateExpr, resolveReleaseDate } from './release-date.js'

describe('localeRegion', () => {
  it('extracts the region subtag from a BCP-47 locale', () => {
    expect(localeRegion('en-GB')).toBe('GB')
    expect(localeRegion('en-US')).toBe('US')
  })

  it('returns null for a locale with no region subtag', () => {
    expect(localeRegion('en')).toBeNull()
  })

  it('returns null rather than throwing for a malformed locale', () => {
    expect(localeRegion('en_GB')).toBeNull()
    expect(localeRegion('')).toBeNull()
    expect(localeRegion('💥')).toBeNull()
  })
})

describe('resolveReleaseDate', () => {
  const movie = { releaseDate: '1999-03-30', releaseDates: { GB: '1999-06-11', US: '1999-03-31' } }

  it('prefers the region date when one exists', () => {
    expect(resolveReleaseDate(movie, 'GB')).toEqual({ date: '1999-06-11', region: 'GB' })
  })

  it('falls back to the primary date when the region has no entry', () => {
    expect(resolveReleaseDate(movie, 'JP')).toEqual({ date: '1999-03-30', region: null })
  })

  it('falls back to the primary date when there is no region at all', () => {
    expect(resolveReleaseDate(movie, null)).toEqual({ date: '1999-03-30', region: null })
  })

  it('returns a null date when neither the region nor the primary date exists', () => {
    expect(resolveReleaseDate({ releaseDate: null, releaseDates: {} }, 'GB')).toEqual({
      date: null,
      region: null,
    })
  })

  it('falls back to the primary date when releaseDates itself is null', () => {
    expect(resolveReleaseDate({ releaseDate: '1999-03-30', releaseDates: null }, 'GB')).toEqual({
      date: '1999-03-30',
      region: null,
    })
  })
})

// releaseDateExpr must agree with resolveReleaseDate on the same data —
// build.ts's buildMoviesEvents relies on the SQL form doing exactly what
// the detail route's JS form does, or a user would see a different date
// in their calendar feed than on the movie's own page.
describe('releaseDateExpr (SQL form) agrees with resolveReleaseDate (JS form)', () => {
  const db = testDb()
  beforeEach(() => resetDb(db))

  async function insertMovie(releaseDate: string | null, releaseDates: Record<string, string>) {
    const [movie] = await db
      .insert(movies)
      .values({
        title: 'Test Movie',
        slug: `test-movie-${crypto.randomUUID()}`,
        releaseDate,
        releaseDates,
      })
      .returning()
    return movie!
  }

  async function queryResolvedDate(movieId: string, region: string | null): Promise<string | null> {
    const [row] = await db
      .select({ date: releaseDateExpr(region) })
      .from(movies)
      .where(eq(movies.id, movieId))
    return row!.date
  }

  it('agrees on a region hit', async () => {
    const movie = await insertMovie('1999-03-30', { GB: '1999-06-11', US: '1999-03-31' })
    const sqlResult = await queryResolvedDate(movie.id, 'GB')
    const jsResult = resolveReleaseDate(movie, 'GB')
    expect(sqlResult).toBe('1999-06-11')
    expect(sqlResult).toBe(jsResult.date)
  })

  it('agrees on a region miss, falling back to the primary date', async () => {
    const movie = await insertMovie('1999-03-30', { US: '1999-03-31' })
    const sqlResult = await queryResolvedDate(movie.id, 'JP')
    const jsResult = resolveReleaseDate(movie, 'JP')
    expect(sqlResult).toBe('1999-03-30')
    expect(sqlResult).toBe(jsResult.date)
  })

  it('agrees when there is no region at all', async () => {
    const movie = await insertMovie('1999-03-30', { GB: '1999-06-11' })
    const sqlResult = await queryResolvedDate(movie.id, null)
    const jsResult = resolveReleaseDate(movie, null)
    expect(sqlResult).toBe('1999-03-30')
    expect(sqlResult).toBe(jsResult.date)
  })

  it('agrees when neither the region nor the primary date exists', async () => {
    const movie = await insertMovie(null, {})
    const sqlResult = await queryResolvedDate(movie.id, 'GB')
    const jsResult = resolveReleaseDate(movie, 'GB')
    expect(sqlResult).toBeNull()
    expect(jsResult.date).toBeNull()
  })
})
