import { describe, expect, it } from 'vitest'
import { multisetDiff } from './diff.js'

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
