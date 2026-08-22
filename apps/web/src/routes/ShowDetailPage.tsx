import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ShowDetail } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { useAuth } from '../lib/auth-context.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { WatchDateDialog } from '../components/library/WatchDateDialog.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

/** Same tick used on episode tiles (SeasonDetailPage.tsx's CheckIcon) —
 * duplicated rather than shared/exported, matching this codebase's existing
 * precedent of one small icon component per file. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** TMDB's own CDN-hosted logo asset — same "short" mark already used for
 * the required attribution footer in README.md, reused here rather than a
 * bare "★" so the rating is attributed to its source the way a Trakt-style
 * rating chip credits IMDb/RT/Metacritic. Not bundled as a local asset:
 * TMDB's attribution terms require using their logo unmodified, and
 * linking their own hosted copy is the simplest way not to accidentally
 * violate that (no local crop/recolor/re-export to get out of sync with). */
const TMDB_LOGO_URL =
  'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg'

/** "2012" when the first and last watch land in the same year, otherwise
 * "2012 - 2014" — matches what was asked for over always showing a range,
 * which would read oddly for a show binged entirely within one year. */
function watchedPeriodRange(firstWatchedAt: string, lastWatchedAt: string): string {
  const firstYear = new Date(firstWatchedAt).getFullYear()
  const lastYear = new Date(lastWatchedAt).getFullYear()
  return firstYear === lastYear ? String(firstYear) : `${firstYear} - ${lastYear}`
}

export function ShowDetailPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const queryClient = useQueryClient()
  const [watchDialogOpen, setWatchDialogOpen] = useState(false)

  const {
    data: show,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['show', slug],
    queryFn: () => api.library.show(slug!),
    enabled: Boolean(slug),
  })

  // Toggles between the two endpoints based on current cache state rather
  // than needing a separate "drop"/"undrop" mutation pair — mutate() takes
  // no arguments either way, and the button's own label already reflects
  // which action is next.
  const toggleDropped = useMutation({
    mutationFn: () => (show?.dropped ? api.library.undropShow(slug!) : api.library.dropShow(slug!)),
    onSuccess: (status) => {
      // Patches the two changed fields into the already-cached ShowDetail
      // rather than refetching — the endpoint already returns them, so a
      // second round trip would be redundant (see droppedStatusSchema's
      // doc comment in packages/shared/src/schemas/library.ts).
      queryClient.setQueryData(['show', slug], (prev: ShowDetail | undefined) =>
        prev ? { ...prev, ...status } : prev,
      )
      // The gallery's own cached list needs the same update, but isn't
      // held here — invalidate rather than patch, same reasoning as
      // invalidateWatchData in lib/query-client.ts.
      void queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  // Logs a new watch for every non-special episode of the show at once —
  // the show-level equivalent of EpisodeCard's markWatched in
  // SeasonDetailPage.tsx. Unlike toggleDropped above, there's no single
  // changed field to patch into the cache: watched counts, per-season
  // progress, and history all need a real refetch.
  const markWatched = useMutation({
    mutationFn: (watchedAt: string) => api.library.markShowWatched(slug!, watchedAt),
    onSuccess: () => {
      setWatchDialogOpen(false)
      void invalidateWatchData(queryClient)
      // Prefix match — invalidates this show's own detail query and any
      // cached season pages under it (['show', slug, 'season', N]) in one
      // call, since every one of them just went stale.
      void queryClient.invalidateQueries({ queryKey: ['show', slug] })
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('showDetail.notFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!show) return null

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="aspect-[2/3] w-48 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface)]">
          {show.posterPath ? (
            <img
              src={show.posterPath}
              alt=""
              width={342}
              height={513}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-center text-4xl font-semibold text-[var(--color-fg-muted)]"
            >
              {show.title.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-2xl font-semibold">{show.title}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--color-fg-muted)]">
            {(
              [
                show.year,
                show.genres.length > 0 ? show.genres.join(', ') : null,
                show.status,
                show.dropped ? t('showDetail.droppedFact') : null,
                show.voteAverage !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {show.tmdbId ? (
                      <a
                        href={`https://www.themoviedb.org/tv/${show.tmdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('showDetail.viewOnTmdb')}
                      >
                        <img src={TMDB_LOGO_URL} alt={t('showDetail.viewOnTmdb')} className="h-3" />
                      </a>
                    ) : (
                      <img src={TMDB_LOGO_URL} alt={t('showDetail.ratingSource')} className="h-3" />
                    )}
                    {show.voteAverage.toFixed(1)}
                  </span>
                ) : null,
              ] satisfies (ReactNode | null)[]
            )
              .filter((fact) => fact !== null)
              .map((fact, index) => (
                <span key={index} className="flex items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true">·</span>}
                  {fact}
                </span>
              ))}
          </div>
          {show.overview && <p className="max-w-2xl text-sm">{show.overview}</p>}

          {show.totalEpisodes !== null ? (
            <div className="flex max-w-xs flex-col gap-1">
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
                {t('shows.progress', { watched: show.watchedEpisodes, total: show.totalEpisodes })}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('shows.progressUnknown', { count: show.watchedEpisodes })}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={!show.tmdbId}
              title={show.tmdbId ? undefined : t('showDetail.watchedButtonDisabled')}
              onClick={() => setWatchDialogOpen(true)}
            >
              <CheckIcon />
              {t('showDetail.watchedButton')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={toggleDropped.isPending}
              onClick={() => toggleDropped.mutate()}
            >
              {t(show.dropped ? 'showDetail.undrop' : 'showDetail.drop')}
            </Button>
          </div>

          {show.firstWatchedAt && show.lastWatchedAt ? (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('showDetail.watchedPeriod', {
                range: watchedPeriodRange(show.firstWatchedAt, show.lastWatchedAt),
              })}
            </p>
          ) : (
            show.hasUnknownWatchDate && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('showDetail.watchedUnknown')}
              </p>
            )
          )}
        </div>
      </div>

      <WatchDateDialog
        open={watchDialogOpen}
        episodeLabel={show.title}
        episode={{ title: show.title, runtimeMinutes: null, firstAired: null }}
        locale={locale}
        onConfirm={(watchedAt) => markWatched.mutate(watchedAt)}
        onCancel={() => setWatchDialogOpen(false)}
      />

      {show.seasons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('showDetail.seasonsTitle')}</h2>
          <PosterGrid>
            {show.seasons.map((season) => {
              const seasonName =
                season.name ??
                (season.seasonNumber === 0
                  ? t('showDetail.specials')
                  : t('import.progress.season', { number: season.seasonNumber }))
              const posterPath = season.posterPath ?? show.posterPath
              // Specials don't get a premiere year — a "Specials" season is
              // a grab-bag TMDB backdates to the show's own start, which
              // would misleadingly imply a real season aired then.
              const seasonYear =
                season.seasonNumber > 0 && season.airDate
                  ? new Date(season.airDate).getUTCFullYear()
                  : null
              return (
                <li key={season.seasonNumber} className="flex flex-col gap-2">
                  <Link
                    to={`/shows/${show.slug}/season/${season.seasonNumber}`}
                    className="flex flex-col gap-2 rounded-lg"
                  >
                    <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-[var(--color-surface)]">
                      {posterPath ? (
                        <img
                          src={posterPath}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={342}
                          height={513}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="flex h-full items-center justify-center text-2xl font-semibold text-[var(--color-fg-muted)]"
                        >
                          {seasonName.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="truncate text-sm font-medium" title={seasonName}>
                        {seasonName}
                      </h3>
                      <p className="text-xs text-[var(--color-fg-muted)]">
                        {[
                          t('shows.progress', {
                            watched: season.watchedEpisodes,
                            total: season.episodeCount,
                          }),
                          seasonYear,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </Link>
                  <ProgressBar
                    value={season.watchedEpisodes}
                    max={season.episodeCount}
                    label={t('showDetail.seasonProgressAria', {
                      season: seasonName,
                      watched: season.watchedEpisodes,
                      total: season.episodeCount,
                    })}
                  />
                </li>
              )
            })}
          </PosterGrid>
        </div>
      )}
    </div>
  )
}
