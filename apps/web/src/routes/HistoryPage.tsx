import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ACTIVITY_KINDS,
  ACTIVITY_SORT_KEYS,
  type ActivityEntry,
  type ActivitySort,
} from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { useAuth } from '../lib/auth-context.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { useActivityKindFilterCookie } from '../lib/use-activity-kind-filter-cookie.js'
import { useDateRangeCookie } from '../lib/use-date-range-cookie.js'
import { useDebouncedValue } from '../lib/use-debounced-value.js'
import { localDayEndISO, localDayStartISO } from '../lib/date.js'
import { ratingToStars } from '../lib/rating.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { ActivityTile } from '../components/library/ActivityTile.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { FiltersPanel } from '../components/library/FiltersPanel.js'
import { ActivityKindFilterPanel } from '../components/library/ActivityKindFilterPanel.js'
import { DateRangeFilterPanel } from '../components/library/DateRangeFilterPanel.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Same page size as the API's own default limit (listActivityQuerySchema,
 * packages/shared/src/schemas/activity.ts) — kept explicit here rather than
 * relying on the server default so getNextPageParam's offset math has a
 * known page size to work from. */
const PAGE_SIZE = 60

/** Sentinel group key for an entry dated exactly 1900-01-01 — Trakt's "I
 * don't remember when" marker (only ever seen on imported watches, but
 * checked generically here the same way the old per-play version did). */
const UNKNOWN_DATE_KEY = '__unknown_date__'

function isUnknownOccurredAt(entry: ActivityEntry): boolean {
  return new Date(entry.occurredAt).getUTCFullYear() === 1900
}

function groupByDay(entries: ActivityEntry[], locale: string) {
  const groups = new Map<string, ActivityEntry[]>()
  for (const entry of entries) {
    const date = new Date(entry.occurredAt)
    const day = isUnknownOccurredAt(entry)
      ? UNKNOWN_DATE_KEY
      : date.toLocaleDateString(locale, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
    const existing = groups.get(day) ?? []
    existing.push(entry)
    groups.set(day, existing)
  }
  return groups
}

function selectionKey(entry: Pick<ActivityEntry, 'kind' | 'id'>): string {
  return `${entry.kind}:${entry.id}`
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const locale = user?.locale ?? 'en-GB'

  const [filter, setFilter] = useState('')
  const debouncedFilter = useDebouncedValue(filter, 350)
  const [sortBy, setSortBy] = useSortCookie<ActivitySort>(
    'rwnd_history_sort',
    ACTIVITY_SORT_KEYS,
    'occurredDesc',
  )
  const [shownKinds, setShownKinds] = useActivityKindFilterCookie('rwnd_history_kind_filters')
  const [dateRange, setDateRange] = useDateRangeCookie('rwnd_history_date_range')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const kindsParam = shownKinds.size < ACTIVITY_KINDS.length ? [...shownKinds].sort() : undefined
  const kindsCacheKey = kindsParam?.join(',') ?? 'all'
  const dateRangeCacheKey = `${dateRange.after ?? ''}_${dateRange.before ?? ''}`
  // Deselecting every kind checkbox means "show nothing" — no API call can
  // express that (an empty `kinds` list is indistinguishable from "no
  // filter" over the wire, api-client.ts's activity.list), so it's handled
  // entirely client-side by not fetching at all.
  const hasSelectedKind = shownKinds.size > 0

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['activity', debouncedFilter, sortBy, kindsCacheKey, dateRangeCacheKey],
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.activity.list({
        offset: pageParam,
        limit: PAGE_SIZE,
        q: debouncedFilter.trim() || undefined,
        kinds: kindsParam,
        sort: sortBy,
        after: dateRange.after ? localDayStartISO(dateRange.after) : undefined,
        before: dateRange.before ? localDayEndISO(dateRange.before) : undefined,
      }),
    initialPageParam: 0,
    enabled: hasSelectedKind,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined
      return allPages.reduce((sum, page) => sum + page.entries.length, 0)
    },
    // Changing the filter/sort/kinds query params swaps to a new query key —
    // without this, `isLoading` briefly goes true on every change (no cached
    // data for the new key yet), which unmounts the whole page tree below
    // (the `isLoading` early return) and loses the FiltersPanel's `<details>`
    // open/closed DOM state. Keeping the previous page's data on screen
    // during the refetch avoids that.
    placeholderData: keepPreviousData,
  })

  const removeMutation = useMutation({
    mutationFn: (entries: Array<Pick<ActivityEntry, 'kind' | 'id'>>) =>
      api.activity.removeMany(entries),
    onSuccess: async () => {
      await invalidateWatchData(queryClient)
      setSelectedKeys(new Set())
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, watchedAt }: { id: string; watchedAt: string }) =>
      api.plays.updateWatchedAt(id, watchedAt),
    onSuccess: async () => {
      await invalidateWatchData(queryClient)
      setEditingKey(null)
    },
  })

  // Force-empty rather than reading `data` directly while no kind is
  // selected — `placeholderData: keepPreviousData` would otherwise keep
  // showing the last-fetched (non-empty) page indefinitely, since a
  // disabled query never runs to replace it.
  const entries = useMemo(
    () => (hasSelectedKind ? (data?.pages.flatMap((page) => page.entries) ?? []) : []),
    [data, hasSelectedKind],
  )
  const total = hasSelectedKind ? (data?.pages[0]?.total ?? 0) : 0
  // A filter (kind or title) narrowing the result to zero is a different
  // situation from a genuinely empty account — the latter hides the whole
  // filter/sort UI below (nothing to filter yet), which would otherwise
  // trap a user who's just unchecked every kind checkbox with no visible
  // way back to recheck one.
  const hasActiveFilter =
    debouncedFilter.trim().length > 0 ||
    kindsParam !== undefined ||
    dateRange.after !== null ||
    dateRange.before !== null
  const entryByKey = useMemo(
    () => new Map(entries.map((entry) => [selectionKey(entry), entry])),
    [entries],
  )
  const editingEntry = editingKey ? entryByKey.get(editingKey) : undefined
  const singleSelectedEntry =
    selectedKeys.size === 1 ? entryByKey.get([...selectedKeys][0]!) : undefined

  function toggleSelect(entry: ActivityEntry) {
    const key = selectionKey(entry)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function entryTitle(entry: ActivityEntry): string {
    if (entry.media.type === 'episode') {
      const label = t('history.episodeLabelShort', {
        season: entry.media.seasonNumber,
        episode: entry.media.episodeNumber,
      })
      return `${entry.media.showTitle ?? ''} · ${label} · ${entry.media.title}`
    }
    return entry.media.title
  }

  function entryCaption(entry: ActivityEntry): string {
    if (entry.kind === 'watch') {
      const sourceLabel = t(`history.sourceLabel.${entry.source}`)
      if (isUnknownOccurredAt(entry)) return sourceLabel
      const time = new Date(entry.occurredAt).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
      })
      return `${time} · ${sourceLabel}`
    }
    if (entry.kind === 'rating') {
      // `rating` is only optional in the schema because it's shared across
      // every kind — the API's rating branch (activity.ts) always sets it
      // for a 'rating' entry. Repeated glyphs on the same 1-5 scale
      // RatingPicker.tsx uses, not the raw 1-10 value or a bare count.
      return t('history.ratingCaption', { stars: '★'.repeat(ratingToStars(entry.rating!)) })
    }
    if (entry.kind === 'watchlist') {
      return entry.notes
        ? `${t('history.watchlistCaption')} — ${entry.notes}`
        : t('history.watchlistCaption')
    }
    return t('history.droppedCaption')
  }

  function kindLabel(kind: (typeof ACTIVITY_KINDS)[number]): string {
    return t(`history.kindLabel.${kind}`)
  }

  const isChronological = sortBy === 'occurredDesc' || sortBy === 'occurredAsc'
  const grouped = isChronological ? groupByDay(entries, locale) : null

  function renderTile(entry: ActivityEntry) {
    const key = selectionKey(entry)
    return (
      <ActivityTile
        key={key}
        entry={entry}
        title={entryTitle(entry)}
        caption={entryCaption(entry)}
        selected={selectedKeys.has(key)}
        onToggleSelect={() => toggleSelect(entry)}
        selectAriaLabel={t('history.selectAria', { title: entryTitle(entry) })}
      />
    )
  }

  if (isLoading) {
    return <Spinner label={t('common.loading')} />
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('history.title')}</h1>

      {total === 0 && entries.length === 0 && !hasActiveFilter ? (
        <p className="text-[var(--color-fg-muted)]">{t('history.empty')}</p>
      ) : (
        <>
          <LibraryControls<ActivitySort>
            filterValue={filter}
            onFilterChange={setFilter}
            filterLabel={t('history.filterLabel')}
            filterPlaceholder={t('history.filterPlaceholder')}
            betweenFilterAndSort={
              <Button
                variant="secondary"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                {t('history.filtersButton')}
              </Button>
            }
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortLabel={t('history.sortLabel')}
            sortOptions={[
              { value: 'occurredDesc', label: t('history.sortOccurredDesc') },
              { value: 'occurredAsc', label: t('history.sortOccurredAsc') },
              { value: 'titleAsc', label: t('history.sortTitleAsc') },
              { value: 'titleDesc', label: t('history.sortTitleDesc') },
            ]}
          />

          {filtersOpen && (
            <FiltersPanel>
              <ActivityKindFilterPanel
                shown={shownKinds}
                onChange={setShownKinds}
                labelFor={kindLabel}
                groupLabel={t('history.filtersPanel.kind')}
              />
              <DateRangeFilterPanel
                range={dateRange}
                onChange={setDateRange}
                groupLabel={t('history.filtersPanel.dateRange')}
                afterLabel={t('history.filtersPanel.after')}
                beforeLabel={t('history.filtersPanel.before')}
              />
              <div>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setShownKinds(new Set(ACTIVITY_KINDS))
                    setDateRange({ after: null, before: null })
                  }}
                >
                  {t('history.filtersPanel.reset')}
                </Button>
              </div>
            </FiltersPanel>
          )}

          {selectedKeys.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] p-3">
              <span className="text-sm">
                {t('history.selection.count', { count: selectedKeys.size })}
              </span>
              <Button
                variant="secondary"
                type="button"
                disabled={!singleSelectedEntry || singleSelectedEntry.kind !== 'watch'}
                onClick={() => setEditingKey([...selectedKeys][0]!)}
              >
                {t('history.selection.editDate')}
              </Button>
              <Button
                variant="danger"
                type="button"
                isLoading={removeMutation.isPending}
                onClick={() =>
                  removeMutation.mutate(
                    [...selectedKeys]
                      .map((key) => entryByKey.get(key))
                      .filter((e): e is ActivityEntry => e !== undefined),
                  )
                }
              >
                {t('history.selection.remove')}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setSelectedKeys(new Set())}>
                {t('history.selection.clear')}
              </Button>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="text-[var(--color-fg-muted)]">
              {filter.trim()
                ? t('history.noMatches', { query: filter })
                : t('history.noFilterMatches')}
            </p>
          ) : grouped ? (
            Array.from(grouped.entries()).map(([day, dayEntries]) => (
              <section key={day} aria-labelledby={`day-${day}`}>
                <h1 id={`day-${day}`} className="mb-2 text-lg font-semibold">
                  {day === UNKNOWN_DATE_KEY ? t('history.unknownDate') : day}
                </h1>
                <PosterGrid>{dayEntries.map(renderTile)}</PosterGrid>
              </section>
            ))
          ) : (
            <PosterGrid>{entries.map(renderTile)}</PosterGrid>
          )}

          {hasSelectedKind && hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => fetchNextPage()}
              isLoading={isFetchingNextPage}
            >
              {t('history.loadMore')}
            </Button>
          )}
        </>
      )}

      <WatchDateDialog
        open={editingKey !== null}
        episodeLabel={editingEntry ? entryTitle(editingEntry) : ''}
        episode={{
          title: editingEntry ? entryTitle(editingEntry) : null,
          runtimeMinutes: null,
          firstAired: null,
        }}
        locale={locale}
        allowNowWatching={false}
        initialWatchedAt={editingEntry?.occurredAt}
        titleOverride={
          editingEntry
            ? t('history.editDateDialog.title', { title: entryTitle(editingEntry) })
            : undefined
        }
        confirmLabel={t('history.editDateDialog.confirm')}
        onConfirm={(watchedAtIso) => {
          if (editingEntry) editMutation.mutate({ id: editingEntry.id, watchedAt: watchedAtIso })
        }}
        onCancel={() => setEditingKey(null)}
      />
    </div>
  )
}
