import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getCookie } from './cookies.js'
import { useLibraryFilterState } from './use-library-filter-state.js'

interface Item {
  genres: string[]
  year: number | null
  voteAverage: number | null
  myRating: number | null
  lastWatchedAt: string
}

const items: Item[] = [
  {
    genres: ['Drama', 'Comedy'],
    year: 2010,
    voteAverage: 7.2,
    myRating: 6,
    lastWatchedAt: '2024-03-01T00:00:00.000Z',
  },
  {
    genres: ['Action'],
    year: 2020,
    voteAverage: 8.9,
    myRating: null,
    lastWatchedAt: '2025-06-15T00:00:00.000Z',
  },
]

describe('useLibraryFilterState', () => {
  it('computes availableGenres (sorted) and the library-derived ranges from the given items', () => {
    const { result } = renderHook(() => useLibraryFilterState('test_ranges', items, 'en-GB'))

    expect(result.current.availableGenres).toEqual(['Action', 'Comedy', 'Drama'])
    expect(result.current.libraryYearRange).toEqual({ min: 2010, max: 2020 })
    expect(result.current.libraryRatingRange).toEqual({ min: 7.2, max: 8.9 })
    expect(result.current.libraryMyRatingRange).toEqual({ min: 6, max: 6 })
    expect(result.current.libraryWatchedYearRange).toEqual({ min: 2024, max: 2025 })
  })

  it('returns null ranges, and seeds filters at {0,0}, when nothing in the library has a value', () => {
    const { result } = renderHook(() => useLibraryFilterState('test_empty', [], 'en-GB'))

    expect(result.current.libraryYearRange).toBeNull()
    expect(result.current.libraryRatingRange).toBeNull()
    expect(result.current.libraryMyRatingRange).toBeNull()
    expect(result.current.libraryWatchedYearRange).toBeNull()
    expect(result.current.yearFilter).toEqual({ after: 0, before: 0 })
  })

  it('hydrates genreFilters from an existing cookie', () => {
    document.cookie = `test_hydrate_genre_filters=${encodeURIComponent(
      JSON.stringify({ Drama: 'include' }),
    )}; path=/`

    const { result } = renderHook(() => useLibraryFilterState('test_hydrate', items, 'en-GB'))

    expect(result.current.genreFilters).toEqual({ Drama: 'include' })
  })

  it('setters persist through to the matching cookie name', () => {
    const { result } = renderHook(() => useLibraryFilterState('test_persist', items, 'en-GB'))

    act(() => result.current.setGenreFilters({ Comedy: 'exclude' }))
    expect(getCookie('test_persist_genre_filters')).toBe(JSON.stringify({ Comedy: 'exclude' }))

    act(() => result.current.setYearFilter({ after: 2012, before: 2018 }))
    expect(getCookie('test_persist_year_filter')).toBe(
      JSON.stringify({ after: 2012, before: 2018 }),
    )

    act(() => result.current.setUnratedMode('exclude'))
    expect(getCookie('test_persist_unrated_mode')).toBe('exclude')
  })

  it('resetShared resets every shared field back to its library-derived default', () => {
    const { result } = renderHook(() => useLibraryFilterState('test_reset', items, 'en-GB'))

    act(() => {
      result.current.setGenreFilters({ Comedy: 'exclude' })
      result.current.setYearFilter({ after: 2015, before: 2016 })
      result.current.setRatingFilter({ after: 8, before: 8.5 })
      result.current.setMyRatingFilter({ after: 6, before: 6 })
      result.current.setUnratedMode('exclude')
      result.current.setWatchedYearFilter({ after: 2024, before: 2024 })
      result.current.setUnknownWatchedMode('include')
    })

    act(() => result.current.resetShared())

    expect(result.current.genreFilters).toEqual({})
    expect(result.current.yearFilter).toEqual({ after: 2010, before: 2020 })
    expect(result.current.ratingFilter).toEqual({ after: 7.2, before: 8.9 })
    expect(result.current.myRatingFilter).toEqual({ after: 6, before: 6 })
    expect(result.current.unratedMode).toBe('neutral')
    expect(result.current.watchedYearFilter).toEqual({ after: 2024, before: 2025 })
    expect(result.current.unknownWatchedMode).toBe('neutral')
  })
})
