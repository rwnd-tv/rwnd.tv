import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/auth-context.js'
import { formatDashboardDate } from '../../lib/date.js'
import { PosterTile } from './PosterTile.js'

/** Beyond Today/Tomorrow, an Upcoming date within this many days renders as
 * a weekday name ("Wednesday") instead of "27 Aug" — James, 2026-08-25. */
const UPCOMING_WEEKDAY_WINDOW_DAYS = 7
import { RowSkeleton } from './RowSkeleton.js'

/**
 * Dashboard's "coming up" row (DashboardPage.tsx) — one card per show the
 * user watched in the last 30 days and hasn't dropped, showing the next
 * episode that hasn't aired yet (see GET /library/up-next's doc comment in
 * apps/api/src/routes/library.ts). Deliberately independent of
 * OnDeckRow.tsx: a show can be behind on already-aired episodes *and* have
 * something upcoming at the same time, so a show can appear in both rows
 * at once rather than this one excluding whatever On Deck already covers.
 *
 * Same RowSkeleton.tsx-while-loading, renders-nothing-once-empty, and
 * horizontal-scroll-row shape as OnDeckRow.tsx, for the same reasons — see
 * that component's doc comment. Also an `<h1>`, same as
 * that row (James, 2026-08-23) — neither row is really "the" page title
 * over the other, they're peers, so the Dashboard just has two.
 */
export function UpNextRow() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const { data, isLoading } = useQuery({
    queryKey: ['library', 'up-next'],
    queryFn: () => api.library.upNext(),
  })

  if (isLoading || !data) return <RowSkeleton />
  if (data.shows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t('dashboard.upNext.title')}</h1>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {data.shows.map((show) => (
          <PosterTile
            key={show.slug}
            title={show.title}
            year={null}
            posterPath={show.posterPath}
            to={`/shows/${show.slug}/season/${show.seasonNumber}/episode/${show.episodeNumber}`}
            className="w-40 flex-shrink-0"
          >
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('dashboard.upNext.episodeLabel', {
                season: show.seasonNumber,
                episode: show.episodeNumber,
                date: formatDashboardDate(
                  new Date(show.firstAired),
                  locale,
                  t,
                  UPCOMING_WEEKDAY_WINDOW_DAYS,
                ),
              })}
            </p>
          </PosterTile>
        ))}
      </ul>
    </div>
  )
}
