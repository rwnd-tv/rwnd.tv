import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SearchResult } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { Button } from './ui/Button.js'

export function SearchResultCard({ result }: { result: SearchResult }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const logPlay = useMutation({
    mutationFn: () =>
      api.plays.create({ movie: { source: result.source, externalId: result.externalId } }),
    onSuccess: () => invalidateWatchData(queryClient),
  })

  // Shows have their own page to add watches from (the normal Watched
  // button flow there) — there's no per-movie page yet, so movies keep
  // logging a watch straight from the search result via logPlay above.
  // Resolving here (rather than linking straight to a slug we don't have
  // yet) creates the local show row on demand if this is the first time
  // anyone's touched it — same resolveShow() every other watch/drop/refresh
  // action already relies on — then navigates once it has a real slug to
  // go to.
  const resolveShow = useMutation({
    mutationFn: () =>
      api.library.resolveShow({ source: result.source, externalId: result.externalId }),
    onSuccess: ({ slug }) => navigate(`/shows/${slug}`),
  })

  const poster = result.posterPath ? (
    <img
      src={result.posterPath}
      alt=""
      width={64}
      height={96}
      loading="lazy"
      className="h-24 w-16 shrink-0 rounded object-cover"
    />
  ) : (
    <div
      aria-hidden="true"
      className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-[var(--color-border)] text-lg font-semibold"
    >
      {result.title.charAt(0)}
    </div>
  )

  const titleText = `${result.title}${result.year ? ` (${result.year})` : ''}`

  return (
    <li className="flex gap-4 rounded-lg border border-[var(--color-border)] p-4">
      {result.type === 'show' ? (
        <button
          type="button"
          className="flex shrink-0 items-start"
          disabled={resolveShow.isPending}
          onClick={() => resolveShow.mutate()}
        >
          {poster}
        </button>
      ) : (
        poster
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="truncate font-medium">
            {result.type === 'show' ? (
              <button
                type="button"
                className="truncate hover:underline"
                disabled={resolveShow.isPending}
                onClick={() => resolveShow.mutate()}
              >
                {titleText}
              </button>
            ) : (
              titleText
            )}
          </h3>
          {result.overview && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-fg-muted)]">
              {result.overview}
            </p>
          )}
        </div>

        {result.type === 'show' ? (
          resolveShow.isError && (
            <p className="text-sm text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
          )
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={logPlay.isPending}
              onClick={() => logPlay.mutate()}
            >
              {t('search.logWatch')}
            </Button>
            {logPlay.isSuccess && (
              <span className="text-sm text-[var(--color-fg-muted)]">{t('search.logged')}</span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
