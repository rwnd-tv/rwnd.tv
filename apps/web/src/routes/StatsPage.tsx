import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api-client.js'
import { formatDuration } from '../lib/duration.js'
import { localDayEndISO, localDayStartISO } from '../lib/date.js'
import { availableYearsFrom } from '../lib/stats-buckets.js'
import { useAuth } from '../lib/use-auth.js'
import { Spinner } from '../components/ui/Spinner.js'
import { Select } from '../components/ui/Select.js'
import { StatTile } from '../components/stats/StatTile.js'
import { TopTitlesRow } from '../components/stats/TopTitlesRow.js'
import { ActivityChart } from '../components/stats/ActivityChart.js'

const ALL_TIME = 'all'

/**
 * Stage 2 (M6) of the Stats and insights feature: adds a year selector
 * (rescoping the totals/top-lists below via GET /stats/summary's
 * after/before) and an activity-over-time chart, on top of stage 1's
 * totals/time-watched/top-10 shows/movies. Stage 3 adds the day/hour
 * heatmap, top genres, and a ratings histogram. See the M6 plan for why
 * those are staged separately. `handle: fullWidthHandle` (App.tsx) — the
 * stat-tile grid, chart, and poster rows want the full column, same
 * reasoning as the gallery pages.
 *
 * The timeline query (GET /stats/timeline) is deliberately unscoped and
 * fetched once — see statsTimelineSchema's doc comment — so it drives both
 * the year selector's own option list and the activity chart's bucketing,
 * entirely client-side, without refetching when `selectedYear` changes.
 */
export function StatsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [selectedYear, setSelectedYear] = useState<number | typeof ALL_TIME>(ALL_TIME)

  const timeline = useQuery({
    queryKey: ['stats', 'timeline'],
    queryFn: () => api.stats.timeline(),
  })

  const { after, before } =
    selectedYear === ALL_TIME
      ? {}
      : {
          after: localDayStartISO(`${selectedYear}-01-01`),
          before: localDayEndISO(`${selectedYear}-12-31`),
        }

  const summary = useQuery({
    queryKey: ['stats', 'summary', after, before],
    queryFn: () => api.stats.summary({ after, before }),
  })

  const availableYears = useMemo(
    () => availableYearsFrom(timeline.data?.episodePlays ?? [], timeline.data?.moviePlays ?? []),
    [timeline.data],
  )

  if (summary.isLoading || !summary.data) {
    if (summary.isError) {
      return (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )
    }
    return <Spinner label={t('common.loading')} />
  }

  const { totals, topShows, topMovies } = summary.data

  if (totals.plays === 0 && selectedYear === ALL_TIME) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>
        <p className="text-[var(--color-fg-muted)]">{t('stats.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>
        {availableYears.length > 0 && (
          <Select
            label={t('stats.year.label')}
            hideLabel
            className="w-40"
            value={selectedYear}
            onChange={(e) =>
              setSelectedYear(e.target.value === ALL_TIME ? ALL_TIME : Number(e.target.value))
            }
          >
            <option value={ALL_TIME}>{t('stats.year.all')}</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        )}
      </div>

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

      {selectedYear === ALL_TIME && totals.unknownDatePlays > 0 && (
        <p className="text-xs text-[var(--color-fg-muted)]">
          {t('stats.totals.unknownDateNote', { count: totals.unknownDatePlays })}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('stats.activity.title')}</h2>
        {timeline.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <ActivityChart
            episodePlays={timeline.data?.episodePlays ?? []}
            moviePlays={timeline.data?.moviePlays ?? []}
            year={selectedYear}
            locale={locale}
            onYearClick={setSelectedYear}
          />
        )}
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
