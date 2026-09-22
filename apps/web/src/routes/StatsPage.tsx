import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api-client.js'
import { formatDuration } from '../lib/duration.js'
import { Spinner } from '../components/ui/Spinner.js'
import { StatTile } from '../components/stats/StatTile.js'
import { TopTitlesRow } from '../components/stats/TopTitlesRow.js'

/**
 * Stage 1 (M6) of the Stats and insights feature: totals, time watched, and
 * top-10 shows/movies, all-time only. `handle: fullWidthHandle` (App.tsx) —
 * the stat-tile grid and poster rows want the full column, same reasoning
 * as the gallery pages. Stage 2 adds a year selector (rescoping everything
 * here via GET /stats/summary's after/before) and an activity-over-time
 * chart; stage 3 adds the day/hour heatmap, top genres, and a ratings
 * histogram. See the M6 plan for why those are staged separately.
 */
export function StatsPage() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: () => api.stats.summary(),
  })

  if (isLoading || !data) {
    if (isError) {
      return (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )
    }
    return <Spinner label={t('common.loading')} />
  }

  const { totals, topShows, topMovies } = data

  if (totals.plays === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>
        <p className="text-[var(--color-fg-muted)]">{t('stats.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label={t('stats.totals.episodesWatched')}
          value={totals.episodePlays.toLocaleString()}
        />
        <StatTile
          label={t('stats.totals.moviesWatched')}
          value={totals.moviePlays.toLocaleString()}
        />
        <StatTile
          label={t('stats.totals.showsWatched')}
          value={totals.distinctShows.toLocaleString()}
        />
        <StatTile
          label={t('stats.totals.timeWatched')}
          value={formatDuration(totals.minutesWatched, t)}
          subLabel={
            totals.playsWithoutRuntime > 0
              ? t('stats.totals.estimatedNote', { count: totals.playsWithoutRuntime })
              : undefined
          }
        />
      </div>

      <TopTitlesRow
        title={t('stats.topShows.title')}
        items={topShows}
        linkPrefix="/shows"
        renderSecondary={(show) => t('stats.topShows.episodes', { count: show.episodes })}
      />
      <TopTitlesRow
        title={t('stats.topMovies.title')}
        items={topMovies}
        linkPrefix="/movies"
        renderSecondary={(movie) => formatDuration(movie.minutes, t)}
      />
    </div>
  )
}
