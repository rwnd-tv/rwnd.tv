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
import { BarChart } from '../components/stats/BarChart.js'
import { WeekHourHeatmap } from '../components/stats/WeekHourHeatmap.js'

const ALL_TIME = 'all'

/**
 * Stats and insights (M6): a year selector (rescoping the totals/top-lists
 * below via GET /stats/summary's after/before) and an activity-over-time
 * chart, on top of totals/time-watched/top-10 shows/movies, plus a
 * day/hour heatmap, top genres, and a ratings histogram. `handle:
 * fullWidthHandle` (App.tsx) — the stat-tile grid, chart, and poster rows
 * want the full column, same reasoning as the gallery pages.
 *
 * The timeline query (GET /stats/timeline) is deliberately unscoped and
 * fetched once — see statsTimelineSchema's doc comment — so it drives both
 * the year selector's own option list and the activity chart/heatmap's
 * bucketing, entirely client-side, without refetching when `selectedYear`
 * changes.
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

  const { totals, topShows, topMovies, topGenres, ratings } = summary.data

  const genreChartData = topGenres.map((genre) => ({
    key: genre.genre,
    label: genre.genre,
    value: genre.minutes,
    title: `${genre.genre}: ${formatDuration(genre.minutes, t)} (${t('stats.genres.titlesCount', { count: genre.titles })})`,
  }))

  const ratingsChartData = ratings.distribution.map((bucket) => ({
    key: String(bucket.rating),
    label: String(bucket.rating),
    value: bucket.total,
    title: `${bucket.rating}: ${t('stats.ratings.count', { count: bucket.total })}`,
  }))

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

      {/* xl, not sm — "313 days, 4 hours" (Time watched, the widest value
          this grid ever holds) needs real room: confirmed live that even
          ~990px (well past `sm`'s 640px) still wraps it into 4 separate
          one-word lines once split across 4 narrow columns. 2 columns has
          enough width to read cleanly at any size below that. Landed on
          `xl` (not `sm`, not `2xl`) after live back-and-forth: `2xl`
          (1536px) turned out to demand more width than is reasonable to
          expect even on a large monitor — this value alone needs ~622px
          per tile to stay on one line, which only fits 4-across above
          ~2800px — so at narrower widths this is deliberately accepting a
          wrap onto a second line ("313 days," / "4 hours") rather than
          chasing single-line fit at an ever-larger breakpoint. */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('stats.heatmap.title')}</h2>
        {timeline.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <WeekHourHeatmap
            episodePlays={timeline.data?.episodePlays ?? []}
            moviePlays={timeline.data?.moviePlays ?? []}
            year={selectedYear}
            locale={locale}
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

      {topGenres.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('stats.genres.title')}</h2>
          <BarChart
            data={genreChartData}
            orientation="horizontal"
            formatValue={(v) => formatDuration(v, t)}
          />
        </div>
      )}

      {ratings.total > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('stats.ratings.title')}</h2>
          {selectedYear !== ALL_TIME && (
            <p className="text-xs text-[var(--color-fg-muted)]">{t('stats.ratings.scopeNote')}</p>
          )}
          {/* xl, matching the totals grid above — same reasoning, kept
              consistent even though these two values are short enough not
              to be hit by it in practice today. */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile label={t('stats.ratings.total')} value={ratings.total.toLocaleString()} />
            {/* average is only null when total is 0, already excluded by this section's own guard above */}
            <StatTile label={t('stats.ratings.average')} value={ratings.average!.toFixed(1)} />
          </div>
          <BarChart data={ratingsChartData} />
        </div>
      )}
    </div>
  )
}
