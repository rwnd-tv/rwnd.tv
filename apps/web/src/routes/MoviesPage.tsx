import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { LibraryMovie } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import {
  filterByTitle,
  lastWatchedComparator,
  titleComparatorAsc,
  yearComparatorDesc,
} from '../lib/library-filter.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { Spinner } from '../components/ui/Spinner.js'

const SORT_KEYS = ['lastWatched', 'title', 'year', 'timesWatched'] as const
type SortKey = (typeof SORT_KEYS)[number]

function sortMovies(movies: LibraryMovie[], sortBy: SortKey, locale: string): LibraryMovie[] {
  const sorted = [...movies]
  switch (sortBy) {
    case 'title':
      return sorted.sort(titleComparatorAsc(locale))
    case 'year':
      return sorted.sort(yearComparatorDesc)
    case 'lastWatched':
      return sorted.sort(lastWatchedComparator)
    case 'timesWatched':
      return sorted.sort((a, b) => b.playCount - a.playCount)
  }
}

export function MoviesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useSortCookie('rwnd_movies_sort', SORT_KEYS, 'lastWatched')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['library', 'movies'],
    queryFn: () => api.library.movies(),
  })

  const movies = useMemo(() => {
    const filtered = filterByTitle(data?.movies ?? [], filter)
    return sortMovies(filtered, sortBy, locale)
  }, [data, filter, sortBy, locale])

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
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortLabel={t('movies.sortLabel')}
            sortOptions={[
              { value: 'lastWatched', label: t('movies.sortLastWatched') },
              { value: 'title', label: t('movies.sortTitle') },
              { value: 'year', label: t('movies.sortYear') },
              { value: 'timesWatched', label: t('movies.sortTimesWatched') },
            ]}
          />

          {movies.length === 0 ? (
            <p className="text-[var(--color-fg-muted)]">
              {t('movies.noMatches', { query: filter })}
            </p>
          ) : (
            <PosterGrid>
              {movies.map((movie) => (
                <PosterTile
                  key={movie.id}
                  title={movie.title}
                  year={movie.year}
                  posterPath={movie.posterPath}
                >
                  {movie.playCount > 1 && (
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      {t('movies.timesWatched', { count: movie.playCount })}
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
