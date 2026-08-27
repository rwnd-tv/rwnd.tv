import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WatchlistItemMedia } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { useAuth } from '../lib/auth-context.js'
import { filterByTitle, titleComparatorAsc, titleComparatorDesc } from '../lib/library-filter.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { LibraryControls } from '../components/library/LibraryControls.js'
import { Button } from '../components/ui/Button.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Field } from '../components/ui/Field.js'
import { Spinner } from '../components/ui/Spinner.js'

// Not cookie-persisted like ShowsPage.tsx/MoviesPage.tsx's own sort — a
// watchlist holds a handful of titles, remembering the sort across visits
// wasn't asked for here and would be one more thing to keep in sync per
// list. Plain union rather than a `SORT_KEYS` array + useSortCookie: with
// nothing to validate against (no cookie, no external source), there's no
// runtime need for the array, just the type.
type SortKey = 'addedDesc' | 'addedAsc' | 'titleAsc' | 'titleDesc'

function sortItems(items: WatchlistItemMedia[], sortBy: SortKey, locale: string) {
  const sorted = [...items]
  switch (sortBy) {
    case 'addedDesc':
      return sorted.sort((a, b) => b.listedAt.localeCompare(a.listedAt))
    case 'addedAsc':
      return sorted.sort((a, b) => a.listedAt.localeCompare(b.listedAt))
    case 'titleAsc':
      return sorted.sort(titleComparatorAsc(locale))
    case 'titleDesc':
      return sorted.sort(titleComparatorDesc(locale))
  }
}

/** Small pin glyph for "set as this list's cover", filled when the tile is
 * the current pin. Page-local rather than shared/exported, matching this
 * codebase's one-icon-per-file convention for a component used in exactly
 * one place. */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l2 6 6 1-4.5 4.5L17 20l-5-3-5 3 1.5-6.5L4 9l6-1z" />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/**
 * One watchlist's shows and movies (apps/api/src/routes/watchlists.ts) —
 * WatchlistsPage.tsx's per-tile drill-down. Lighter than ShowsPage.tsx/
 * MoviesPage.tsx: title filter + sort only, no filter-panel stack — a
 * watchlist holds a handful of titles, not the whole library, and none of
 * the genre/status/rating dimensions those pages filter by apply to
 * "should this be on my list" in the first place.
 */
export function WatchlistDetailPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('addedDesc')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const {
    data: watchlist,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['watchlists', id],
    queryFn: () => api.watchlists.get(id!),
    enabled: Boolean(id),
  })

  const rename = useMutation({
    mutationFn: () => api.watchlists.update(id!, { name: renameValue }),
    onSuccess: () => {
      setRenameOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
  })

  const deleteList = useMutation({
    mutationFn: () => api.watchlists.delete(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      navigate('/watchlists')
    },
  })

  const setCover = useMutation({
    mutationFn: (coverItemId: string | null) => api.watchlists.update(id!, { coverItemId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['watchlists'] }),
  })

  const removeItem = useMutation({
    mutationFn: (item: WatchlistItemMedia) =>
      item.type === 'show'
        ? api.library.removeShowFromWatchlist(item.slug, id!)
        : api.library.removeMovieFromWatchlist(item.slug, id!),
    onSuccess: () => void invalidateWatchData(queryClient),
  })

  const items = useMemo(() => {
    const filtered = filterByTitle(watchlist?.items ?? [], filter)
    return sortItems(filtered, sortBy, locale)
  }, [watchlist, filter, sortBy, locale])

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('watchlists.notFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!watchlist) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{watchlist.name}</h1>
        {!watchlist.isDefault && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRenameValue(watchlist.name)
                setRenameOpen(true)
              }}
            >
              {t('watchlists.rename')}
            </Button>
            <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
              {t('watchlists.delete')}
            </Button>
          </div>
        )}
      </div>

      {watchlist.items.length === 0 ? (
        <p className="text-[var(--color-fg-muted)]">{t('watchlists.detailEmpty')}</p>
      ) : (
        <>
          <LibraryControls<SortKey>
            filterValue={filter}
            onFilterChange={setFilter}
            filterLabel={t('watchlists.filterLabel')}
            filterPlaceholder={t('watchlists.filterPlaceholder')}
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortLabel={t('watchlists.sortLabel')}
            sortOptions={[
              { value: 'addedDesc', label: t('watchlists.sortAddedDesc') },
              { value: 'addedAsc', label: t('watchlists.sortAddedAsc') },
              { value: 'titleAsc', label: t('watchlists.sortTitleAsc') },
              { value: 'titleDesc', label: t('watchlists.sortTitleDesc') },
            ]}
          />

          {items.length === 0 ? (
            <p className="text-[var(--color-fg-muted)]">
              {t('watchlists.noMatches', { query: filter })}
            </p>
          ) : (
            <PosterGrid>
              {items.map((item) => {
                const isCover = watchlist.coverItemId === item.itemId
                return (
                  <PosterTile
                    key={item.itemId}
                    title={item.title}
                    year={item.year}
                    posterPath={item.posterPath}
                    to={item.type === 'show' ? `/shows/${item.slug}` : `/movies/${item.slug}`}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={t(isCover ? 'watchlists.unsetCover' : 'watchlists.setCover')}
                        aria-label={t(isCover ? 'watchlists.unsetCover' : 'watchlists.setCover')}
                        disabled={setCover.isPending}
                        onClick={() => setCover.mutate(isCover ? null : item.itemId)}
                        className="rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <PinIcon filled={isCover} />
                      </button>
                      <button
                        type="button"
                        title={t('watchlists.removeItem')}
                        aria-label={t('watchlists.removeItem')}
                        disabled={removeItem.isPending}
                        onClick={() => removeItem.mutate(item)}
                        className="rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  </PosterTile>
                )
              })}
            </PosterGrid>
          )}
        </>
      )}

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} title={t('watchlists.rename')}>
        <Field
          label={t('watchlists.newListNameLabel')}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          required
        />
        {rename.isError && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
            {rename.error instanceof ApiError
              ? rename.error.message
              : t('common.somethingWentWrong')}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={renameValue.trim().length === 0}
            isLoading={rename.isPending}
            onClick={() => rename.mutate()}
          >
            {t('watchlists.rename')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('watchlists.delete')}>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('watchlists.deleteConfirmBody', { name: watchlist.name })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={deleteList.isPending}
            onClick={() => deleteList.mutate()}
          >
            {t('watchlists.delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
