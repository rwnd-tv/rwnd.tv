import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Play } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { useAuth } from '../lib/auth-context.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Sentinel group key for plays dated exactly 1900-01-01 — Trakt's "I don't
 * remember when" marker, not a real date — so they bucket under one
 * "Unknown date" heading instead of a bogus "1 January 1900" per play.
 * Checked via UTC year, not the locale-formatted string, so it can't be
 * thrown off by the browser's timezone shifting the calendar day. */
const UNKNOWN_DATE_KEY = '__unknown_date__'

function groupByDay(plays: Play[], locale: string) {
  const groups = new Map<string, Play[]>()
  for (const play of plays) {
    const watchedDate = new Date(play.watchedAt)
    const day =
      watchedDate.getUTCFullYear() === 1900
        ? UNKNOWN_DATE_KEY
        : watchedDate.toLocaleDateString(locale, {
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

/** Whether `play` carries Trakt's "I don't remember when" sentinel — see
 * UNKNOWN_DATE_KEY above. A time of day makes no sense for these, so
 * formatWatchedMeta below omits it rather than rendering a bogus midnight. */
function isUnknownWatchedAt(play: Play) {
  return new Date(play.watchedAt).getUTCFullYear() === 1900
}

/** "{{time}} · {{source}}" line under each entry's title — the time this
 * specific watch happened at (day is already the section heading above),
 * and how it got logged (manual entry, Plex scrobble, or an import). */
function formatWatchedMeta(
  play: Play,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const sourceLabel = t(`history.sourceLabel.${play.source}`)
  if (isUnknownWatchedAt(play)) return sourceLabel
  const time = new Date(play.watchedAt).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${time} · ${sourceLabel}`
}

function playTitle(play: Play, t: (key: string, opts?: Record<string, unknown>) => string) {
  if (play.media.type === 'movie') return play.media.title
  const label = t('history.episodeLabelShort', {
    season: play.media.seasonNumber,
    episode: play.media.episodeNumber,
  })
  return `${play.media.showTitle ?? ''} · ${label} · ${play.media.title}`
}

/** Where this entry links to, or null for one with no detail page to send
 * the user to — a play whose media row predates `showSlug`/`movieSlug`
 * existing (schemas/plays.ts), or a future non-slug source. Movie
 * counterpart of the episode branch's showSlug link, added once
 * MovieDetailPage.tsx existed to link to. */
function playHref(play: Play): string | null {
  if (play.media.type === 'episode') {
    return play.media.showSlug ? `/shows/${play.media.showSlug}` : null
  }
  return play.media.movieSlug ? `/movies/${play.media.movieSlug}` : null
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
    onSuccess: () => invalidateWatchData(queryClient),
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
                {day === UNKNOWN_DATE_KEY ? t('history.unknownDate') : day}
              </h2>
              <ul className="flex flex-col gap-2">
                {plays.map((play) => {
                  const href = playHref(play)
                  const meta = formatWatchedMeta(play, locale, t)
                  return (
                    <li
                      key={play.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {href ? (
                          <Link
                            to={href}
                            className="flex min-w-0 items-center gap-3 hover:underline"
                          >
                            {play.media.posterPath && (
                              <img
                                src={play.media.posterPath}
                                alt=""
                                width={40}
                                height={60}
                                className="h-[60px] w-10 shrink-0 rounded object-cover"
                              />
                            )}
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{playTitle(play, t)}</span>
                              <span className="truncate text-xs text-[var(--color-fg-muted)]">
                                {meta}
                              </span>
                            </div>
                          </Link>
                        ) : (
                          <>
                            {play.media.posterPath && (
                              <img
                                src={play.media.posterPath}
                                alt=""
                                width={40}
                                height={60}
                                className="h-[60px] w-10 shrink-0 rounded object-cover"
                              />
                            )}
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{playTitle(play, t)}</span>
                              <span className="truncate text-xs text-[var(--color-fg-muted)]">
                                {meta}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => removePlay.mutate(play.id)}
                        aria-label={`${t('history.remove')}: ${playTitle(play, t)}`}
                      >
                        {t('history.remove')}
                      </Button>
                    </li>
                  )
                })}
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
