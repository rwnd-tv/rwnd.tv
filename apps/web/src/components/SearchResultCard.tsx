import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SearchResult } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { Button } from './ui/Button.js'
import { Field } from './ui/Field.js'

export function SearchResultCard({ result }: { result: SearchResult }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [season, setSeason] = useState(1)
  const [episode, setEpisode] = useState(1)

  const logPlay = useMutation({
    mutationFn: () =>
      result.type === 'movie'
        ? api.plays.create({ movie: { source: result.source, externalId: result.externalId } })
        : api.plays.create({
            episode: {
              source: result.source,
              showExternalId: result.externalId,
              seasonNumber: season,
              episodeNumber: episode,
            },
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plays'] }),
  })

  return (
    <li className="flex gap-4 rounded-lg border border-[var(--color-border)] p-4">
      {result.posterPath ? (
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
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="truncate font-medium">
            {result.title} {result.year ? `(${result.year})` : ''}
          </h3>
          {result.overview && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--color-fg-muted)]">
              {result.overview}
            </p>
          )}
        </div>

        {result.type === 'show' && expanded && (
          <div className="flex items-end gap-2">
            <Field
              label="Season"
              type="number"
              min={0}
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="w-20"
            />
            <Field
              label="Episode"
              type="number"
              min={1}
              value={episode}
              onChange={(e) => setEpisode(Number(e.target.value))}
              className="w-20"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={logPlay.isPending}
            onClick={() => {
              if (result.type === 'show' && !expanded) {
                setExpanded(true)
                return
              }
              logPlay.mutate()
            }}
          >
            {t('search.logWatch')}
          </Button>
          {logPlay.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('search.logged')}</span>
          )}
        </div>
      </div>
    </li>
  )
}
