import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  collectGenres,
  myRatingRange,
  ratingRange,
  UNKNOWN_WATCHED_MODES,
  UNRATED_MODES,
  watchedYearRange,
  yearRange,
  type GenreFilters,
  type UnknownWatchedMode,
  type UnratedMode,
  type YearRange,
} from './library-filter.js'
import { useGenreFilterCookie } from './use-genre-filter-cookie.js'
import { useSortCookie } from './use-sort-cookie.js'
import { useYearRangeCookie, type AfterBefore } from './use-year-range-cookie.js'

export interface LibraryFilterState {
  filter: string
  setFilter: (value: string) => void
  filtersOpen: boolean
  setFiltersOpen: Dispatch<SetStateAction<boolean>>
  genreFilters: GenreFilters
  setGenreFilters: (updater: GenreFilters | ((prev: GenreFilters) => GenreFilters)) => void
  availableGenres: string[]
  libraryYearRange: YearRange | null
  yearFilter: AfterBefore
  setYearFilter: (next: AfterBefore) => void
  libraryRatingRange: YearRange | null
  ratingFilter: AfterBefore
  setRatingFilter: (next: AfterBefore) => void
  libraryMyRatingRange: YearRange | null
  myRatingFilter: AfterBefore
  setMyRatingFilter: (next: AfterBefore) => void
  unratedMode: UnratedMode
  setUnratedMode: (value: UnratedMode) => void
  libraryWatchedYearRange: YearRange | null
  watchedYearFilter: AfterBefore
  setWatchedYearFilter: (next: AfterBefore) => void
  unknownWatchedMode: UnknownWatchedMode
  setUnknownWatchedMode: (value: UnknownWatchedMode) => void
  resetShared: () => void
}

/**
 * The filter/sort state ShowsPage.tsx and MoviesPage.tsx both wire up
 * identically — genre, release year, TMDB rating, my rating (+ unrated
 * mode), and watched year (+ unknown mode), plus the library-derived
 * ranges/genre list those are seeded from, and whether the filters panel
 * is open. Confirmed identical between the two pages down to the cookie
 * name suffix (`_genre_filters`, `_year_filter`, `_rating_filter`,
 * `_my_rating_filter`, `_unrated_mode`, `_watched_year_filter`,
 * `_watched_unknown_mode`) — `cookiePrefix` (`rwnd_shows`/`rwnd_movies`)
 * reproduces each page's existing cookie names exactly, so no stored
 * preference gets invalidated by this move.
 *
 * Deliberately *not* shared: `sortBy` (10 of 12 sort keys per page share a
 * comparator already, but the two pages' sort-key sets/switch statements
 * differ enough not to be worth forcing into one), the filter pipeline
 * itself (Shows interleaves two extra status/dropped steps no page shares),
 * `resetFilters` (Shows resets two more fields after this hook's own
 * `resetShared`), and all JSX/per-item rendering — those stay in each page.
 */
export function useLibraryFilterState<
  T extends {
    genres: string[]
    year: number | null
    voteAverage: number | null
    myRating: number | null
    lastWatchedAt: string
  },
>(cookiePrefix: string, items: T[], locale: string): LibraryFilterState {
  const [filter, setFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [genreFilters, setGenreFilters] = useGenreFilterCookie(`${cookiePrefix}_genre_filters`)

  const availableGenres = useMemo(() => collectGenres(items, locale), [items, locale])

  // null when nothing in the library has a known year — the caller doesn't
  // render the Released section at all in that case, so there's no slider
  // with a broken/empty range to show. Same treatment for the three ranges
  // below.
  const libraryYearRange = useMemo(() => yearRange(items), [items])
  const [yearFilter, setYearFilter] = useYearRangeCookie(
    `${cookiePrefix}_year_filter`,
    libraryYearRange?.min ?? 0,
    libraryYearRange?.max ?? 0,
    libraryYearRange !== null,
  )

  const libraryRatingRange = useMemo(() => ratingRange(items), [items])
  const [ratingFilter, setRatingFilter] = useYearRangeCookie(
    `${cookiePrefix}_rating_filter`,
    libraryRatingRange?.min ?? 0,
    libraryRatingRange?.max ?? 0,
    libraryRatingRange !== null,
  )

  // Independent of libraryRatingRange above — see myRatingRange's own doc
  // comment for why this is a separate field, not the same TMDB one.
  const libraryMyRatingRange = useMemo(() => myRatingRange(items), [items])
  const [myRatingFilter, setMyRatingFilter] = useYearRangeCookie(
    `${cookiePrefix}_my_rating_filter`,
    libraryMyRatingRange?.min ?? 0,
    libraryMyRatingRange?.max ?? 0,
    libraryMyRatingRange !== null,
  )
  const [unratedMode, setUnratedMode] = useSortCookie<UnratedMode>(
    `${cookiePrefix}_unrated_mode`,
    UNRATED_MODES,
    'neutral',
  )

  // 1900 (Trakt's "I don't remember when" sentinel) is excluded from this
  // range entirely — see watchedYearRange() — so the "After" slider can
  // never be dragged back to it. Items with that sentinel are governed by
  // unknownWatchedMode instead, not by the slider.
  const libraryWatchedYearRange = useMemo(() => watchedYearRange(items), [items])
  const [watchedYearFilter, setWatchedYearFilter] = useYearRangeCookie(
    `${cookiePrefix}_watched_year_filter`,
    libraryWatchedYearRange?.min ?? 0,
    libraryWatchedYearRange?.max ?? 0,
    libraryWatchedYearRange !== null,
  )
  const [unknownWatchedMode, setUnknownWatchedMode] = useSortCookie<UnknownWatchedMode>(
    `${cookiePrefix}_watched_unknown_mode`,
    UNKNOWN_WATCHED_MODES,
    'neutral',
  )

  function resetShared() {
    setGenreFilters(() => ({}))
    if (libraryYearRange) {
      setYearFilter({ after: libraryYearRange.min, before: libraryYearRange.max })
    }
    if (libraryRatingRange) {
      setRatingFilter({ after: libraryRatingRange.min, before: libraryRatingRange.max })
    }
    if (libraryMyRatingRange) {
      setMyRatingFilter({ after: libraryMyRatingRange.min, before: libraryMyRatingRange.max })
    }
    setUnratedMode('neutral')
    if (libraryWatchedYearRange) {
      setWatchedYearFilter({
        after: libraryWatchedYearRange.min,
        before: libraryWatchedYearRange.max,
      })
    }
    setUnknownWatchedMode('neutral')
  }

  return {
    filter,
    setFilter,
    filtersOpen,
    setFiltersOpen,
    genreFilters,
    setGenreFilters,
    availableGenres,
    libraryYearRange,
    yearFilter,
    setYearFilter,
    libraryRatingRange,
    ratingFilter,
    setRatingFilter,
    libraryMyRatingRange,
    myRatingFilter,
    setMyRatingFilter,
    unratedMode,
    setUnratedMode,
    libraryWatchedYearRange,
    watchedYearFilter,
    setWatchedYearFilter,
    unknownWatchedMode,
    setUnknownWatchedMode,
    resetShared,
  }
}
