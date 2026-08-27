import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { LibraryMovie } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import {
  collectGenres,
  filterByGenres,
  filterByMyRating,
  filterByRating,
  filterByReleaseYear,
  filterByTitle,
  filterByWatchedYear,
  lastWatchedComparatorAsc,
  lastWatchedComparatorDesc,
  myRatingComparatorAsc,
  myRatingComparatorDesc,
  myRatingRange,
  ratingComparatorAsc,
  ratingComparatorDesc,
  ratingRange,
  titleComparatorAsc,
  titleComparatorDesc,
  UNKNOWN_WATCHED_MODES,
  UNRATED_MODES,
  watchedYearRange,
  yearComparatorAsc,
  yearComparatorDesc,
  yearRange,
} from '../lib/library-filter.js'
import type { UnknownWatchedMode, UnratedMode } from '../lib/library-filter.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { useGenreFilterCookie } from '../lib/use-genre-filter-cookie.js'
import { useYearRangeCookie } from '../lib/use-year-range-cookie.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { FiltersPanel } from '../components/library/FiltersPanel.js'
import { GenreFilterPanel } from '../components/library/GenreFilterPanel.js'
import { ReleaseYearFilterPanel } from '../components/library/ReleaseYearFilterPanel.js'
import { RatingFilterPanel } from '../components/library/RatingFilterPanel.js'
import { MyRatingFilterPanel } from '../components/library/MyRatingFilterPanel.js'
import { WatchedYearFilterPanel } from '../components/library/WatchedYearFilterPanel.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

const SORT_KEYS = [
  'lastWatchedDesc',
  'lastWatchedAsc',
  'titleAsc',
  'titleDesc',
  'yearDesc',
  'yearAsc',
  'timesWatchedDesc',
  'timesWatchedAsc',
  'ratingDesc',
  'ratingAsc',
  'myRatingDesc',
  'myRatingAsc',
] as const
type SortKey = (typeof SORT_KEYS)[number]

function sortMovies(movies: LibraryMovie[], sortBy: SortKey, locale: string): LibraryMovie[] {
  const sorted = [...movies]
  switch (sortBy) {
    case 'titleAsc':
      return sorted.sort(titleComparatorAsc(locale))
    case 'titleDesc':
      return sorted.sort(titleComparatorDesc(locale))
    case 'yearDesc':
      return sorted.sort(yearComparatorDesc)
    case 'yearAsc':
      return sorted.sort(yearComparatorAsc)
    case 'lastWatchedDesc':
      return sorted.sort(lastWatchedComparatorDesc)
    case 'lastWatchedAsc':
      return sorted.sort(lastWatchedComparatorAsc)
    case 'timesWatchedDesc':
      return sorted.sort((a, b) => b.playCount - a.playCount)
    case 'timesWatchedAsc':
      return sorted.sort((a, b) => a.playCount - b.playCount)
    case 'ratingDesc':
      return sorted.sort(ratingComparatorDesc)
    case 'ratingAsc':
      return sorted.sort(ratingComparatorAsc)
    case 'myRatingDesc':
      return sorted.sort(myRatingComparatorDesc)
    case 'myRatingAsc':
      return sorted.sort(myRatingComparatorAsc)
  }
}

export function MoviesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useSortCookie('rwnd_movies_sort', SORT_KEYS, 'lastWatchedDesc')
  const [genreFilters, setGenreFilters] = useGenreFilterCookie('rwnd_movies_genre_filters')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['library', 'movies'],
    queryFn: () => api.library.movies(),
  })

  const availableGenres = useMemo(() => collectGenres(data?.movies ?? [], locale), [data, locale])
  // null when nothing in the library has a known year — MoviesPage doesn't
  // render the Released section at all in that case, same as ShowsPage.
  const libraryYearRange = useMemo(() => yearRange(data?.movies ?? []), [data])
  const [yearFilter, setYearFilter] = useYearRangeCookie(
    'rwnd_movies_year_filter',
    libraryYearRange?.min ?? 0,
    libraryYearRange?.max ?? 0,
    libraryYearRange !== null,
  )
  // null when nothing in the library has a cached rating yet — same
  // "don't render a broken/empty slider" treatment as libraryYearRange.
  const libraryRatingRange = useMemo(() => ratingRange(data?.movies ?? []), [data])
  const [ratingFilter, setRatingFilter] = useYearRangeCookie(
    'rwnd_movies_rating_filter',
    libraryRatingRange?.min ?? 0,
    libraryRatingRange?.max ?? 0,
    libraryRatingRange !== null,
  )
  // Independent of libraryRatingRange above — see ShowsPage.tsx's identical
  // field for the same reasoning.
  const libraryMyRatingRange = useMemo(() => myRatingRange(data?.movies ?? []), [data])
  const [myRatingFilter, setMyRatingFilter] = useYearRangeCookie(
    'rwnd_movies_my_rating_filter',
    libraryMyRatingRange?.min ?? 0,
    libraryMyRatingRange?.max ?? 0,
    libraryMyRatingRange !== null,
  )
  const [unratedMode, setUnratedMode] = useSortCookie<UnratedMode>(
    'rwnd_movies_unrated_mode',
    UNRATED_MODES,
    'neutral',
  )
  // 1900 (Trakt's "I don't remember when" sentinel) is excluded from this
  // range entirely — see watchedYearRange() — so the "After" slider can
  // never be dragged back to it. Movies with that sentinel are governed by
  // unknownWatchedMode instead, not by the slider.
  const libraryWatchedYearRange = useMemo(() => watchedYearRange(data?.movies ?? []), [data])
  const [watchedYearFilter, setWatchedYearFilter] = useYearRangeCookie(
    'rwnd_movies_watched_year_filter',
    libraryWatchedYearRange?.min ?? 0,
    libraryWatchedYearRange?.max ?? 0,
    libraryWatchedYearRange !== null,
  )
  const [unknownWatchedMode, setUnknownWatchedMode] = useSortCookie<UnknownWatchedMode>(
    'rwnd_movies_watched_unknown_mode',
    UNKNOWN_WATCHED_MODES,
    'neutral',
  )

  const movies = useMemo(() => {
    const byTitle = filterByTitle(data?.movies ?? [], filter)
    const byGenre = filterByGenres(byTitle, genreFilters)
    const byYear = filterByReleaseYear(byGenre, yearFilter.after, yearFilter.before)
    const byRating = filterByRating(byYear, ratingFilter.after, ratingFilter.before)
    const byMyRating = filterByMyRating(
      byRating,
      myRatingFilter.after,
      myRatingFilter.before,
      unratedMode,
    )
    const byWatchedYear = filterByWatchedYear(
      byMyRating,
      watchedYearFilter.after,
      watchedYearFilter.before,
      unknownWatchedMode,
    )
    return sortMovies(byWatchedYear, sortBy, locale)
  }, [
    data,
    filter,
    genreFilters,
    yearFilter,
    ratingFilter,
    myRatingFilter,
    unratedMode,
    watchedYearFilter,
    unknownWatchedMode,
    sortBy,
    locale,
  ])

  function resetFilters() {
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

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('movies.title')}</h1>

      {isError && (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )}

      {!isError && data?.movies.length === 0 && (
        <p className="text-[var(--color-fg-muted)]">{t('movies.empty')}</p>
      )}

      {!isError && data && data.movies.length > 0 && (
        <>
          <LibraryControls<SortKey>
            filterValue={filter}
            onFilterChange={setFilter}
            filterLabel={t('movies.filterLabel')}
            filterPlaceholder={t('movies.filterPlaceholder')}
            betweenFilterAndSort={
              <Button
                variant="secondary"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                {t('movies.filtersButton')}
              </Button>
            }
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortLabel={t('movies.sortLabel')}
            sortOptions={[
              { value: 'lastWatchedDesc', label: t('movies.sortLastWatchedDesc') },
              { value: 'lastWatchedAsc', label: t('movies.sortLastWatchedAsc') },
              { value: 'titleAsc', label: t('movies.sortTitleAsc') },
              { value: 'titleDesc', label: t('movies.sortTitleDesc') },
              { value: 'yearDesc', label: t('movies.sortYearDesc') },
              { value: 'yearAsc', label: t('movies.sortYearAsc') },
              { value: 'timesWatchedDesc', label: t('movies.sortTimesWatchedDesc') },
              { value: 'timesWatchedAsc', label: t('movies.sortTimesWatchedAsc') },
              { value: 'ratingDesc', label: t('movies.sortRatingDesc') },
              { value: 'ratingAsc', label: t('movies.sortRatingAsc') },
              { value: 'myRatingDesc', label: t('movies.sortMyRatingDesc') },
              { value: 'myRatingAsc', label: t('movies.sortMyRatingAsc') },
            ]}
          />

          {filtersOpen && (
            <FiltersPanel>
              <GenreFilterPanel
                genres={availableGenres}
                filters={genreFilters}
                onChange={setGenreFilters}
                groupLabel={t('movies.filtersPanel.genres')}
                includeLabel={t('movies.filtersPanel.include')}
                excludeLabel={t('movies.filtersPanel.exclude')}
              />
              {libraryYearRange && (
                <ReleaseYearFilterPanel
                  min={libraryYearRange.min}
                  max={libraryYearRange.max}
                  range={yearFilter}
                  onChange={setYearFilter}
                  groupLabel={t('movies.filtersPanel.released')}
                  afterLabel={t('movies.filtersPanel.after')}
                  beforeLabel={t('movies.filtersPanel.before')}
                />
              )}
              {libraryRatingRange && (
                <RatingFilterPanel
                  min={libraryRatingRange.min}
                  max={libraryRatingRange.max}
                  range={ratingFilter}
                  onChange={setRatingFilter}
                  groupLabel={t('movies.filtersPanel.rating')}
                  minLabel={t('movies.filtersPanel.min')}
                  maxLabel={t('movies.filtersPanel.max')}
                />
              )}
              {libraryMyRatingRange && (
                <MyRatingFilterPanel
                  min={libraryMyRatingRange.min}
                  max={libraryMyRatingRange.max}
                  range={myRatingFilter}
                  onChange={setMyRatingFilter}
                  unratedMode={unratedMode}
                  onUnratedModeChange={setUnratedMode}
                  groupLabel={t('movies.filtersPanel.myRating')}
                  minLabel={t('movies.filtersPanel.min')}
                  maxLabel={t('movies.filtersPanel.max')}
                  unratedLabel={t('movies.filtersPanel.unrated')}
                  includeLabel={t('movies.filtersPanel.include')}
                  excludeLabel={t('movies.filtersPanel.exclude')}
                />
              )}
              {libraryWatchedYearRange && (
                <WatchedYearFilterPanel
                  min={libraryWatchedYearRange.min}
                  max={libraryWatchedYearRange.max}
                  range={watchedYearFilter}
                  onChange={setWatchedYearFilter}
                  unknownMode={unknownWatchedMode}
                  onUnknownModeChange={setUnknownWatchedMode}
                  groupLabel={t('movies.filtersPanel.watched')}
                  afterLabel={t('movies.filtersPanel.after')}
                  beforeLabel={t('movies.filtersPanel.before')}
                  unknownLabel={t('movies.filtersPanel.unknown')}
                  includeLabel={t('movies.filtersPanel.include')}
                  excludeLabel={t('movies.filtersPanel.exclude')}
                />
              )}
              <div>
                <Button variant="secondary" type="button" onClick={resetFilters}>
                  {t('movies.filtersPanel.reset')}
                </Button>
              </div>
            </FiltersPanel>
          )}

          {movies.length === 0 ? (
            <p className="text-[var(--color-fg-muted)]">
              {filter.trim()
                ? t('movies.noMatches', { query: filter })
                : t('movies.noFilterMatches')}
            </p>
          ) : (
            <PosterGrid>
              {movies.map((movie) => (
                <PosterTile
                  key={movie.id}
                  title={movie.title}
                  year={movie.year}
                  posterPath={movie.posterPath}
                  to={`/movies/${movie.slug}`}
                >
                  {(movie.playCount > 1 || movie.myRating !== null) && (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                      {movie.playCount > 1 && (
                        <p>{t('movies.timesWatched', { count: movie.playCount })}</p>
                      )}
                      {movie.myRating !== null && (
                        // ml-auto rather than justify-between on the row —
                        // pushes the rating to the right edge whether or
                        // not the "Watched N times" text is present, so a
                        // once-watched movie (no times-watched text at all)
                        // still gets a right-justified rating on its own.
                        <p
                          className="ml-auto"
                          title={t('rating.yourRatingAria', { rating: movie.myRating })}
                        >
                          ★ {(movie.myRating / 2).toFixed(1)}
                        </p>
                      )}
                    </div>
                  )}
                </PosterTile>
              ))}
            </PosterGrid>
          )}
        </>
      )}
    </div>
  )
}
