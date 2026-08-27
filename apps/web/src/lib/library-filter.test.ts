import { describe, expect, it } from 'vitest'
import {
  filterByMyRating,
  myRatingComparatorAsc,
  myRatingComparatorDesc,
  myRatingRange,
} from './library-filter.js'

describe('myRatingRange', () => {
  it('returns null when nothing in the library is rated', () => {
    expect(myRatingRange([{ myRating: null }, { myRating: null }])).toBeNull()
  })

  it('returns the observed min/max, ignoring unrated items', () => {
    expect(myRatingRange([{ myRating: 4 }, { myRating: null }, { myRating: 10 }])).toEqual({
      min: 4,
      max: 10,
    })
  })
})

describe('filterByMyRating', () => {
  const items = [{ myRating: 2 }, { myRating: 6 }, { myRating: 10 }, { myRating: null }]

  it('is inclusive on both ends for a known rating', () => {
    expect(filterByMyRating(items, 6, 10, 'neutral')).toEqual([
      { myRating: 6 },
      { myRating: 10 },
      { myRating: null },
    ])
  })

  it('neutral (default) lets an unrated item through regardless of range', () => {
    expect(filterByMyRating(items, 8, 10, 'neutral')).toContainEqual({ myRating: null })
  })

  it('exclude hides every unrated item, range still applies to the rest', () => {
    expect(filterByMyRating(items, 1, 10, 'exclude')).toEqual([
      { myRating: 2 },
      { myRating: 6 },
      { myRating: 10 },
    ])
  })

  it('include shows only unrated items, ignoring the range entirely', () => {
    expect(filterByMyRating(items, 1, 2, 'include')).toEqual([{ myRating: null }])
  })
})

describe('myRatingComparatorDesc / myRatingComparatorAsc', () => {
  it('sorts unrated last in both directions', () => {
    const items = [{ myRating: 6 }, { myRating: null }, { myRating: 10 }]
    expect(items.toSorted(myRatingComparatorDesc)).toEqual([
      { myRating: 10 },
      { myRating: 6 },
      { myRating: null },
    ])
    expect(items.toSorted(myRatingComparatorAsc)).toEqual([
      { myRating: 6 },
      { myRating: 10 },
      { myRating: null },
    ])
  })
})
