import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { slugify } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { PosterTile } from '../components/library/PosterTile.js'
import { Button } from '../components/ui/Button.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Field } from '../components/ui/Field.js'
import { Spinner } from '../components/ui/Spinner.js'

/**
 * Index of the current user's watchlists (apps/api/src/routes/watchlists.ts)
 * — one tile per list, Default always first (the API's own ordering), each
 * linking to `/watchlists/{id}/{slug}` (WatchlistDetailPage.tsx). Same
 * PosterGrid/PosterTile shell as ShowsPage.tsx/MoviesPage.tsx, but far
 * simpler: no filter/sort controls — a user has a handful of lists, not
 * hundreds of titles.
 *
 * The `{slug}` segment is the list's name slugified client-side, purely
 * for a readable URL (the same treatment `/admin/users/{id}/{slug}` got,
 * see UserRow.tsx) — it's never persisted, never checked for uniqueness,
 * and WatchlistDetailPage.tsx ignores it entirely when resolving the page
 * (the `{id}` alone does that), so a slug left stale by a later rename
 * never breaks a bookmarked or shared link. Names are unique per user
 * (`watchlists_user_name_idx`) but their slugs aren't ("Sci-Fi!" and
 * "Sci Fi" both give `sci-fi`) and a name can be emoji or punctuation
 * only, so the id stays the real key; falls back to no slug segment at
 * all (still routed, see App.tsx) if slugifying leaves nothing.
 */
export function WatchlistsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => api.watchlists.list(),
  })

  const createList = useMutation({
    mutationFn: () => api.watchlists.create({ name }),
    onSuccess: () => {
      setCreateOpen(false)
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('watchlists.title')}</h1>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          {t('watchlists.newList')}
        </Button>
      </div>

      {isError && (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )}

      {!isError && data && (
        <PosterGrid>
          {data.watchlists.map((watchlist) => {
            const slug = slugify(watchlist.name)
            return (
              <PosterTile
                key={watchlist.id}
                title={watchlist.name}
                year={null}
                posterPath={watchlist.coverPosterPath}
                to={slug ? `/watchlists/${watchlist.id}/${slug}` : `/watchlists/${watchlist.id}`}
              >
                <p className="text-xs text-[var(--color-fg-muted)]">
                  {t('watchlists.itemCount', { count: watchlist.itemCount })}
                </p>
              </PosterTile>
            )
          })}
        </PosterGrid>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('watchlists.newList')}
      >
        <Field
          label={t('watchlists.newListNameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {createList.isError && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
            {createList.error instanceof ApiError
              ? createList.error.message
              : t('common.somethingWentWrong')}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={name.trim().length === 0}
            isLoading={createList.isPending}
            onClick={() => createList.mutate()}
          >
            {t('watchlists.newListCreate')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
