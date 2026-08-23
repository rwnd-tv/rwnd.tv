import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { SearchResult } from '@rwnd/shared'
import { api } from '../lib/api-client.js'

export function SearchResultCard({ result }: { result: SearchResult }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Both a show and a movie result resolve to a local row (creating one on
  // demand if this is the first time anyone's touched it — same
  // resolveShow()/resolveMovie() every other watch/drop/refresh action
  // already relies on) and then navigate to that page's own Watched button
  // flow, rather than logging a watch inline here. Resolving first (rather
  // than linking straight to a slug we don't have yet) is what gets a real
  // slug to navigate to.
  const resolve = useMutation({
    mutationFn: () =>
      result.type === 'show'
        ? api.library.resolveShow({ source: result.source, externalId: result.externalId })
        : api.library.resolveMovie({ source: result.source, externalId: result.externalId }),
    onSuccess: ({ slug }) =>
      navigate(result.type === 'show' ? `/shows/${slug}` : `/movies/${slug}`),
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
      <button
        type="button"
        className="flex shrink-0 items-start"
        disabled={resolve.isPending}
        onClick={() => resolve.mutate()}
      >
        {poster}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="truncate font-medium">
            <button
              type="button"
              className="truncate hover:underline"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              {titleText}
            </button>
          </h3>
          {result.overview && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-fg-muted)]">
              {result.overview}
            </p>
          )}
        </div>

        {resolve.isError && (
          <p className="text-sm text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
        )}
      </div>
    </li>
  )
}
