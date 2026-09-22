import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { bucketByMonth, bucketByYear } from '../../lib/stats-buckets.js'
import { BarChart, type BarChartDatum } from './BarChart.js'

/**
 * StatsPage.tsx's activity-over-time chart (stage 2, M6) — a thin wrapper
 * choosing month-vs-year buckets around the selected year and combining
 * episode/movie counts into one bar per bucket, delegating the actual
 * rendering to the generic BarChart. `year === 'all'` buckets by local year
 * across the whole timeline (one bar per year with any activity); a
 * specific year buckets by local month within it (twelve bars, zero-filled).
 *
 * "Stacking" here means summing episode+movie counts into a single bar
 * value rather than a true two-color stacked bar — BarChart's data shape is
 * one value per bar; the split is preserved in each bar's tooltip/
 * accessible text instead.
 *
 * `onYearClick`, when given, makes each bar in the "all time" view (one per
 * year) clickable, drilling into that year — StatsPage.tsx wires this to
 * its own year-selector state, so clicking a bar is equivalent to picking
 * that year from the dropdown. Only meaningful for the all-time view: a
 * bar in a single-year view is already a month, which this page has
 * nothing to drill further into, so `onYearClick` is ignored there.
 */
export function ActivityChart({
  episodePlays,
  moviePlays,
  year,
  locale,
  onYearClick,
}: {
  episodePlays: number[]
  moviePlays: number[]
  year: number | 'all'
  locale: string
  onYearClick?: (year: number) => void
}) {
  const { t } = useTranslation()

  const data = useMemo<BarChartDatum[]>(() => {
    const tooltip = (label: string, episodes: number, movies: number) =>
      `${label}: ${t('stats.activity.episodesCount', { count: episodes })}, ${t(
        'stats.activity.moviesCount',
        { count: movies },
      )}`

    if (year === 'all') {
      const episodesByYear = bucketByYear(episodePlays)
      const moviesByYear = bucketByYear(moviePlays)
      const years = [...new Set([...episodesByYear.keys(), ...moviesByYear.keys()])].sort()
      return years.map((y) => {
        const episodes = episodesByYear.get(y) ?? 0
        const movies = moviesByYear.get(y) ?? 0
        const label = String(y)
        return {
          key: label,
          label,
          value: episodes + movies,
          title: tooltip(label, episodes, movies),
        }
      })
    }

    const episodesByMonth = bucketByMonth(episodePlays, year)
    const moviesByMonth = bucketByMonth(moviePlays, year)
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' })
    return episodesByMonth.map((episodes, month) => {
      const movies = moviesByMonth[month]!
      const label = monthFormatter.format(new Date(year, month, 1))
      return {
        key: String(month),
        label,
        value: episodes + movies,
        title: tooltip(label, episodes, movies),
      }
    })
  }, [episodePlays, moviePlays, year, locale, t])

  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-[var(--color-fg-muted)]">{t('stats.activity.empty')}</p>
  }

  const onBarClick =
    year === 'all' && onYearClick
      ? (datum: BarChartDatum) => onYearClick(Number(datum.key))
      : undefined

  return <BarChart data={data} onBarClick={onBarClick} />
}
