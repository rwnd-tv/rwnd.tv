import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Play } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

function groupByDay(plays: Play[], locale: string) {
  const groups = new Map<string, Play[]>()
  for (const play of plays) {
    const day = new Date(play.watchedAt).toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const existing = groups.get(day) ?? []
    existing.push(play)
    groups.set(day, existing)
  }
  return groups
}

function playTitle(play: Play, t: (key: string, opts?: Record<string, unknown>) => string) {
  if (play.media.type === 'movie') return play.media.title
  const label = t('history.episodeLabel', {
    season: play.media.seasonNumber,
    episode: play.media.episodeNumber,
  })
  return `${play.media.showTitle ?? ''} · ${label} · ${play.media.title}`
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const locale = user?.locale ?? 'en-GB'

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['plays'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => api.plays.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const removePlay = useMutation({
    mutationFn: (id: string) => api.plays.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plays'] }),
  })

  const allPlays = useMemo(() => data?.pages.flatMap((page) => page.plays) ?? [], [data])
  const grouped = useMemo(() => groupByDay(allPlays, locale), [allPlays, locale])

  if (isLoading) {
    return <Spinner label={t('common.loading')} />
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('history.title')}</h1>
      {allPlays.length === 0 ? (
        <p className="text-[var(--color-fg-muted)]">{t('history.empty')}</p>
      ) : (
        <>
          {Array.from(grouped.entries()).map(([day, plays]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2
                id={`day-${day}`}
                className="mb-2 text-sm font-semibold text-[var(--color-fg-muted)]"
              >
                {day}
              </h2>
              <ul className="flex flex-col gap-2">
                {plays.map((play) => (
                  <li
                    key={play.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {play.media.posterPath && (
                        <img
                          src={play.media.posterPath}
                          alt=""
                          width={40}
                          height={60}
                          className="h-[60px] w-10 shrink-0 rounded object-cover"
                        />
                      )}
                      <span className="truncate">{playTitle(play, t)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => removePlay.mutate(play.id)}
                      aria-label={`${t('history.remove')}: ${playTitle(play, t)}`}
                    >
                      {t('history.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hasNextPage && (
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
    </div>
  )
}
