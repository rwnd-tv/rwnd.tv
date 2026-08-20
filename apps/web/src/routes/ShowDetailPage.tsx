import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { PosterGrid } from '../components/library/PosterGrid.js'
import { ProgressBar } from '../components/library/ProgressBar.js'
import { Spinner } from '../components/ui/Spinner.js'

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

  const {
    data: show,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['show', slug],
    queryFn: () => api.library.show(slug!),
    enabled: Boolean(slug),
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
          <p className="text-sm text-[var(--color-fg-muted)]">
            {[show.year, show.genres.join(', '), show.status].filter(Boolean).join(' · ')}
          </p>
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
