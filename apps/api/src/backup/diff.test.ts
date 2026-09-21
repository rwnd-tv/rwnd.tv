import { describe, expect, it } from 'vitest'
import type { BackupFile, BackupMovie, BackupShow } from '@rwnd/shared'
import { indexByRef, multisetDiff } from './diff.js'

function movie(overrides: Partial<BackupMovie> = {}): BackupMovie {
  return {
    ref: { source: 'tmdb', externalId: '1' },
    title: 'A Movie',
    year: 2020,
    runtimeMinutes: 100,
    overview: null,
    posterPath: null,
    ...overrides,
  }
}

function show(overrides: Partial<BackupShow> = {}): BackupShow {
  return {
    ref: { source: 'tmdb', externalId: '2' },
    slug: 'a-show',
    title: 'A Show',
    year: 2020,
    overview: null,
    posterPath: null,
    status: null,
    genres: [],
    voteAverage: null,
    seasons: [],
    episodes: [],
    ...overrides,
  }
}

function backupFile(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    formatVersion: 3,
    createdAt: new Date().toISOString(),
    description: 'test',
    counts: { watchHistory: 0, ratings: 0, watchlist: 0, droppedShows: 0 },
    skipped: 0,
    movies: [],
    shows: [],
    watchHistory: [],
    ratings: [],
    watchlist: [],
    watchlists: [],
    droppedShows: [],
    ...overrides,
  }
}

// Pure, no DB — computeBackupDiff itself is only exercised by the
// integration tests in apps/api/src/test/backups.test.ts, which need a
// real database to build a "current" snapshot from.
describe('multisetDiff', () => {
  it('reports no changes when both sides are identical', () => {
    const { added, removed } = multisetDiff(['a', 'b'], ['a', 'b'], (x) => x)
    expect(added).toEqual([])
    expect(removed).toEqual([])
  })

  it('reports entries only in current as added', () => {
    const { added, removed } = multisetDiff(['a', 'b'], ['a'], (x) => x)
    expect(added).toEqual(['b'])
    expect(removed).toEqual([])
  })

  it('reports entries only in the backup as removed', () => {
    const { added, removed } = multisetDiff(['a'], ['a', 'b'], (x) => x)
    expect(added).toEqual([])
    expect(removed).toEqual(['b'])
  })

  it('matches duplicates as a multiset, not a set', () => {
    // Two genuinely identical entries on each side (e.g. a bulk import
    // producing two watch-history rows with the same key) must match
    // pairwise, not collapse to "present on both sides" and stop there.
    const { added, removed } = multisetDiff(['a', 'a', 'a'], ['a', 'a'], (x) => x)
    expect(added).toEqual(['a'])
    expect(removed).toEqual([])
  })

  it('leaves unmatched duplicates as removed once currentEntries runs out', () => {
    const { added, removed } = multisetDiff(['a'], ['a', 'a', 'a'], (x) => x)
    expect(added).toEqual([])
    expect(removed).toEqual(['a', 'a'])
  })

  it('returns the real entry objects, not just their keys', () => {
    const current = [
      { id: 1, name: 'kept' },
      { id: 2, name: 'new' },
    ]
    const backup = [
      { id: 1, name: 'kept' },
      { id: 3, name: 'gone' },
    ]
    const { added, removed } = multisetDiff(current, backup, (x) => String(x.id))
    expect(added).toEqual([{ id: 2, name: 'new' }])
    expect(removed).toEqual([{ id: 3, name: 'gone' }])
  })
})

describe('indexByRef', () => {
  it('finds a movie/show by ref', () => {
    const m = movie({ ref: { source: 'tmdb', externalId: '603' }, title: 'The Matrix' })
    const s = show({ ref: { source: 'tvdb', externalId: '81189' }, title: 'Breaking Bad' })
    const index = indexByRef(backupFile({ movies: [m], shows: [s] }))

    expect(index.movies.get('tmdb:603')).toEqual(m)
    expect(index.shows.get('tvdb:81189')).toEqual(s)
  })

  it('misses cleanly (undefined, not a throw) for an unknown ref', () => {
    const index = indexByRef(backupFile())
    expect(index.movies.get('tmdb:999')).toBeUndefined()
    expect(index.shows.get('tvdb:999')).toBeUndefined()
  })

  it('does not cross-match the same externalId under a different source', () => {
    // The exact hazard ExternalRef's own doc comment exists to prevent -
    // a TMDB id and a same-numbered TVDB id must stay distinct.
    const tmdbMovie = movie({ ref: { source: 'tmdb', externalId: '1' }, title: 'TMDB Movie' })
    const tvdbShow = show({ ref: { source: 'tvdb', externalId: '1' }, title: 'TVDB Show' })
    const index = indexByRef(backupFile({ movies: [tmdbMovie], shows: [tvdbShow] }))

    expect(index.movies.get('tvdb:1')).toBeUndefined()
    expect(index.shows.get('tmdb:1')).toBeUndefined()
    expect(index.movies.get('tmdb:1')?.title).toBe('TMDB Movie')
    expect(index.shows.get('tvdb:1')?.title).toBe('TVDB Show')
  })

  it('keeps the first entry on a duplicate ref (matches Array.find semantics)', () => {
    const first = movie({ ref: { source: 'tmdb', externalId: '1' }, title: 'First' })
    const second = movie({ ref: { source: 'tmdb', externalId: '1' }, title: 'Second' })
    const index = indexByRef(backupFile({ movies: [first, second] }))

    expect(index.movies.get('tmdb:1')?.title).toBe('First')
  })
})
