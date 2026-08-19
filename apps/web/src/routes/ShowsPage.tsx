import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { LibraryShow } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import {
  collectGenres,
  filterByGenres,
  filterByReleaseYear,
  filterByTitle,
  lastWatchedComparator,
  titleComparatorAsc,
  titleComparatorDesc,
  yearComparatorAsc,
  yearComparatorDesc,
  yearRange,
} from '../lib/library-filter.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { useGenreFilterCookie } from '../lib/use-genre-filter-cookie.js'
import { useYearRangeCookie } from '../lib/use-year-range-cookie.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { FiltersPanel } from '../components/library/FiltersPanel.js'
import { GenreFilterPanel } from '../components/library/GenreFilterPanel.js'
import { ReleaseYearFilterPanel } from '../components/library/ReleaseYearFilterPanel.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

const SORT_KEYS = [
  'lastWatched',
  'titleAsc',
  'titleDesc',
  'yearDesc',
  'yearAsc',
  'progressDesc',
  'progressAsc',
] as const
type SortKey = (typeof SORT_KEYS)[number]

/** `null`, not a sentinel number, for "no cached total to compute a
 * fraction from" — lets progressComparator give it the same "always sorts
 * last, regardless of direction" treatment yearComparatorAsc/Desc give an
 * unknown year, rather than a magic value that only worked for one
 * direction. */
function progressFraction(show: LibraryShow): number | null {
  if (show.totalEpisodes === null || show.totalEpisodes === 0) return null
  return show.watchedEpisodes / show.totalEpisodes
}

function progressComparator(direction: 1 | -1) {
  return (a: LibraryShow, b: LibraryShow) => {
    const fa = progressFraction(a)
    const fb = progressFraction(b)
    if (fa === fb) return 0
    if (fa === null) return 1
    if (fb === null) return -1
    return direction * (fa - fb)
  }
}

function sortShows(shows: LibraryShow[], sortBy: SortKey, locale: string): LibraryShow[] {
  const sorted = [...shows]
  switch (sortBy) {
    case 'titleAsc':
      return sorted.sort(titleComparatorAsc(locale))
    case 'titleDesc':
      return sorted.sort(titleComparatorDesc(locale))
    case 'yearDesc':
      return sorted.sort(yearComparatorDesc)
    case 'yearAsc':
      return sorted.sort(yearComparatorAsc)
    case 'lastWatched':
      return sorted.sort(lastWatchedComparator)
    case 'progressDesc':
      return sorted.sort(progressComparator(-1))
    case 'progressAsc':
      return sorted.sort(progressComparator(1))
  }
}

export function ShowsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useSortCookie('rwnd_shows_sort', SORT_KEYS, 'lastWatched')
  const [genreFilters, setGenreFilters] = useGenreFilterCookie('rwnd_shows_genre_filters')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['library', 'shows'],
    queryFn: () => api.library.shows(),
  })

  const availableGenres = useMemo(() => collectGenres(data?.shows ?? [], locale), [data, locale])
  // null when nothing in the library has a known year — ShowsPage doesn't
  // render the Released section at all in that case, so there's no slider
  // with a broken/empty range to show.
  const libraryYearRange = useMemo(() => yearRange(data?.shows ?? []), [data])
  const [yearFilter, setYearFilter] = useYearRangeCookie(
    'rwnd_shows_year_filter',
    libraryYearRange?.min ?? 0,
    libraryYearRange?.max ?? 0,
    libraryYearRange !== null,
  )

  const shows = useMemo(() => {
    const byTitle = filterByTitle(data?.shows ?? [], filter)
    const byGenre = filterByGenres(byTitle, genreFilters)
    const byYear = filterByReleaseYear(byGenre, yearFilter.after, yearFilter.before)
    return sortShows(byYear, sortBy, locale)
  }, [data, filter, genreFilters, yearFilter, sortBy, locale])

  function resetFilters() {
    setGenreFilters(() => ({}))
    if (libraryYearRange) {
      setYearFilter({ after: libraryYearRange.min, before: libraryYearRange.max })
    }
  }

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('shows.title')}</h1>

      {isError && (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )}

      {!isError && data?.shows.length === 0 && (
        <p className="text-[var(--color-fg-muted)]">{t('shows.empty')}</p>
      )}

      {!isError && data && data.shows.length > 0 && (
        <>
          <LibraryControls<SortKey>
            filterValue={filter}
            onFilterChange={setFilter}
            filterLabel={t('shows.filterLabel')}
            filterPlaceholder={t('shows.filterPlaceholder')}
            betweenFilterAndSort={
              <Button
                variant="secondary"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                {t('shows.filtersButton')}
              </Button>
            }
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortLabel={t('shows.sortLabel')}
            sortOptions={[
              { value: 'lastWatched', label: t('shows.sortLastWatched') },
              { value: 'titleAsc', label: t('shows.sortTitleAsc') },
              { value: 'titleDesc', label: t('shows.sortTitleDesc') },
              { value: 'yearDesc', label: t('shows.sortYearDesc') },
              { value: 'yearAsc', label: t('shows.sortYearAsc') },
              { value: 'progressDesc', label: t('shows.sortProgressDesc') },
              { value: 'progressAsc', label: t('shows.sortProgressAsc') },
            ]}
          />

          {filtersOpen && (
            <FiltersPanel>
              <GenreFilterPanel
                genres={availableGenres}
                filters={genreFilters}
                onChange={setGenreFilters}
                groupLabel={t('shows.filtersPanel.genres')}
                includeLabel={t('shows.filtersPanel.include')}
                excludeLabel={t('shows.filtersPanel.exclude')}
              />
              {libraryYearRange && (
                <ReleaseYearFilterPanel
                  min={libraryYearRange.min}
                  max={libraryYearRange.max}
                  range={yearFilter}
                  onChange={setYearFilter}
                  groupLabel={t('shows.filtersPanel.released')}
                  afterLabel={t('shows.filtersPanel.after')}
                  beforeLabel={t('shows.filtersPanel.before')}
                />
              )}
              <div>
                <Button variant="secondary" type="button" onClick={resetFilters}>
                  {t('shows.filtersPanel.reset')}
                </Button>
              </div>
            </FiltersPanel>
          )}

          {shows.length === 0 ? (
            <p className="text-[var(--color-fg-muted)]">
              {filter.trim() ? t('shows.noMatches', { query: filter }) : t('shows.noFilterMatches')}
            </p>
          ) : (
            <PosterGrid>
              {shows.map((show) => (
                <PosterTile
                  key={show.id}
                  title={show.title}
                  year={show.year}
                  posterPath={show.posterPath}
                >
                  {show.totalEpisodes !== null ? (
                    <div className="flex flex-col gap-1">
                      <ProgressBar
                        value={show.watchedEpisodes}
                        max={show.totalEpisodes}
                        label={t('shows.progressAria', {
                          title: show.title,
                          watched: show.watchedEpisodes,
                          total: show.totalEpisodes,
                        })}
                      />
                      <p className="text-xs text-[var(--color-fg-muted)]">
                        {t('shows.progress', {
                          watched: show.watchedEpisodes,
                          total: show.totalEpisodes,
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      {t('shows.progressUnknown', { count: show.watchedEpisodes })}
                    </p>
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
