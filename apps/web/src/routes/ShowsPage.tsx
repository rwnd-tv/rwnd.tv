import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { LibraryShow } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import {
  collectGenres,
  collectStatuses,
  DROPPED_FILTER_MODES,
  filterByDropped,
  filterByGenres,
  filterByRating,
  filterByReleaseYear,
  filterByStatus,
  filterByTitle,
  filterByWatchedYear,
  lastWatchedComparatorAsc,
  lastWatchedComparatorDesc,
  ratingComparatorAsc,
  ratingComparatorDesc,
  ratingRange,
  titleComparatorAsc,
  titleComparatorDesc,
  UNKNOWN_WATCHED_MODES,
  watchedYearRange,
  yearComparatorAsc,
  yearComparatorDesc,
  yearRange,
} from '../lib/library-filter.js'
import type { DroppedFilterMode, UnknownWatchedMode } from '../lib/library-filter.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { useGenreFilterCookie } from '../lib/use-genre-filter-cookie.js'
import { useYearRangeCookie } from '../lib/use-year-range-cookie.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { FiltersPanel } from '../components/library/FiltersPanel.js'
import { GenreFilterPanel } from '../components/library/GenreFilterPanel.js'
import { StatusFilterPanel } from '../components/library/StatusFilterPanel.js'
import { ReleaseYearFilterPanel } from '../components/library/ReleaseYearFilterPanel.js'
import { RatingFilterPanel } from '../components/library/RatingFilterPanel.js'
import { WatchedYearFilterPanel } from '../components/library/WatchedYearFilterPanel.js'
import { DroppedFilterPanel } from '../components/library/DroppedFilterPanel.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

const SORT_KEYS = [
  'lastWatchedDesc',
  'lastWatchedAsc',
  'titleAsc',
  'titleDesc',
  'yearDesc',
  'yearAsc',
  'progressDesc',
  'progressAsc',
  'ratingDesc',
  'ratingAsc',
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
    case 'lastWatchedDesc':
      return sorted.sort(lastWatchedComparatorDesc)
    case 'lastWatchedAsc':
      return sorted.sort(lastWatchedComparatorAsc)
    case 'progressDesc':
      return sorted.sort(progressComparator(-1))
    case 'progressAsc':
      return sorted.sort(progressComparator(1))
    case 'ratingDesc':
      return sorted.sort(ratingComparatorDesc)
    case 'ratingAsc':
      return sorted.sort(ratingComparatorAsc)
  }
}

export function ShowsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useSortCookie('rwnd_shows_sort', SORT_KEYS, 'lastWatchedDesc')
  const [genreFilters, setGenreFilters] = useGenreFilterCookie('rwnd_shows_genre_filters')
  // Reuses the genre cookie hook — its logic is already fully generic over
  // a Record<string, 'include'|'exclude'>, nothing genre-specific about it.
  const [statusFilters, setStatusFilters] = useGenreFilterCookie('rwnd_shows_status_filters')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['library', 'shows'],
    queryFn: () => api.library.shows(),
  })

  const availableGenres = useMemo(() => collectGenres(data?.shows ?? [], locale), [data, locale])
  // TMDB doesn't localize `status` itself, so it's translated here rather
  // than at cache time — falls back to the raw string for a status this
  // app doesn't have a translation for yet (see refresh.ts's own comment
  // about "a status this list doesn't know about yet").
  function statusLabel(status: string): string {
    return t(`shows.filtersPanel.statusValues.${status}`, { defaultValue: status })
  }
  const availableStatuses = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: 'base' })
    return collectStatuses(data?.shows ?? []).sort((a, b) =>
      collator.compare(
        t(`shows.filtersPanel.statusValues.${a}`, { defaultValue: a }),
        t(`shows.filtersPanel.statusValues.${b}`, { defaultValue: b }),
      ),
    )
  }, [data, locale, t])
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
  // null when nothing in the library has a cached rating yet — same
  // "don't render a broken/empty slider" treatment as libraryYearRange.
  const libraryRatingRange = useMemo(() => ratingRange(data?.shows ?? []), [data])
  const [ratingFilter, setRatingFilter] = useYearRangeCookie(
    'rwnd_shows_rating_filter',
    libraryRatingRange?.min ?? 0,
    libraryRatingRange?.max ?? 0,
    libraryRatingRange !== null,
  )
  // 1900 (Trakt's "I don't remember when" sentinel) is excluded from this
  // range entirely — see watchedYearRange() — so the "After" slider can
  // never be dragged back to it. Shows with that sentinel are governed by
  // unknownWatchedMode instead, not by the slider.
  const libraryWatchedYearRange = useMemo(() => watchedYearRange(data?.shows ?? []), [data])
  const [watchedYearFilter, setWatchedYearFilter] = useYearRangeCookie(
    'rwnd_shows_watched_year_filter',
    libraryWatchedYearRange?.min ?? 0,
    libraryWatchedYearRange?.max ?? 0,
    libraryWatchedYearRange !== null,
  )
  const [unknownWatchedMode, setUnknownWatchedMode] = useSortCookie<UnknownWatchedMode>(
    'rwnd_shows_watched_unknown_mode',
    UNKNOWN_WATCHED_MODES,
    'neutral',
  )
  // Default 'exclude', unlike unknownWatchedMode's 'neutral' default —
  // dropped shows are meant to be hidden from the gallery unless asked for.
  const [droppedMode, setDroppedMode] = useSortCookie<DroppedFilterMode>(
    'rwnd_shows_dropped_mode',
    DROPPED_FILTER_MODES,
    'exclude',
  )

  const shows = useMemo(() => {
    const byTitle = filterByTitle(data?.shows ?? [], filter)
    const byGenre = filterByGenres(byTitle, genreFilters)
    const byStatus = filterByStatus(byGenre, statusFilters)
    const byYear = filterByReleaseYear(byStatus, yearFilter.after, yearFilter.before)
    const byRating = filterByRating(byYear, ratingFilter.after, ratingFilter.before)
    const byWatchedYear = filterByWatchedYear(
      byRating,
      watchedYearFilter.after,
      watchedYearFilter.before,
      unknownWatchedMode,
    )
    const byDropped = filterByDropped(byWatchedYear, droppedMode)
    return sortShows(byDropped, sortBy, locale)
  }, [
    data,
    filter,
    genreFilters,
    statusFilters,
    yearFilter,
    ratingFilter,
    watchedYearFilter,
    unknownWatchedMode,
    droppedMode,
    sortBy,
    locale,
  ])

  function resetFilters() {
    setGenreFilters(() => ({}))
    setStatusFilters(() => ({}))
    if (libraryYearRange) {
      setYearFilter({ after: libraryYearRange.min, before: libraryYearRange.max })
    }
    if (libraryRatingRange) {
      setRatingFilter({ after: libraryRatingRange.min, before: libraryRatingRange.max })
    }
    if (libraryWatchedYearRange) {
      setWatchedYearFilter({
        after: libraryWatchedYearRange.min,
        before: libraryWatchedYearRange.max,
      })
    }
    setUnknownWatchedMode('neutral')
    setDroppedMode('exclude')
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
              { value: 'lastWatchedDesc', label: t('shows.sortLastWatchedDesc') },
              { value: 'lastWatchedAsc', label: t('shows.sortLastWatchedAsc') },
              { value: 'titleAsc', label: t('shows.sortTitleAsc') },
              { value: 'titleDesc', label: t('shows.sortTitleDesc') },
              { value: 'yearDesc', label: t('shows.sortYearDesc') },
              { value: 'yearAsc', label: t('shows.sortYearAsc') },
              { value: 'progressDesc', label: t('shows.sortProgressDesc') },
              { value: 'progressAsc', label: t('shows.sortProgressAsc') },
              { value: 'ratingDesc', label: t('shows.sortRatingDesc') },
              { value: 'ratingAsc', label: t('shows.sortRatingAsc') },
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
              <StatusFilterPanel
                statuses={availableStatuses}
                labelFor={statusLabel}
                filters={statusFilters}
                onChange={setStatusFilters}
                groupLabel={t('shows.filtersPanel.status')}
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
              {libraryRatingRange && (
                <RatingFilterPanel
                  min={libraryRatingRange.min}
                  max={libraryRatingRange.max}
                  range={ratingFilter}
                  onChange={setRatingFilter}
                  groupLabel={t('shows.filtersPanel.rating')}
                  minLabel={t('shows.filtersPanel.min')}
                  maxLabel={t('shows.filtersPanel.max')}
                />
              )}
              <DroppedFilterPanel
                mode={droppedMode}
                onChange={setDroppedMode}
                groupLabel={t('shows.filtersPanel.dropped')}
                rowLabel={t('shows.filtersPanel.dropped')}
                includeLabel={t('shows.filtersPanel.include')}
                excludeLabel={t('shows.filtersPanel.exclude')}
              />
              {libraryWatchedYearRange && (
                <WatchedYearFilterPanel
                  min={libraryWatchedYearRange.min}
                  max={libraryWatchedYearRange.max}
                  range={watchedYearFilter}
                  onChange={setWatchedYearFilter}
                  unknownMode={unknownWatchedMode}
                  onUnknownModeChange={setUnknownWatchedMode}
                  groupLabel={t('shows.filtersPanel.watched')}
                  afterLabel={t('shows.filtersPanel.after')}
                  beforeLabel={t('shows.filtersPanel.before')}
                  unknownLabel={t('shows.filtersPanel.unknown')}
                  includeLabel={t('shows.filtersPanel.include')}
                  excludeLabel={t('shows.filtersPanel.exclude')}
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
                  to={`/shows/${show.slug}`}
                  grayscale={show.dropped}
                >
                  {show.dropped && (
                    <p className="text-xs font-medium text-[var(--color-danger)]">
                      {t('shows.droppedBadge')}
                    </p>
                  )}
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
