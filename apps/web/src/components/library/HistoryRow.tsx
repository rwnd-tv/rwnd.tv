import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/auth-context.js'
import { PosterTile } from './PosterTile.js'

/** How many recent plays the Dashboard's History row shows — a horizontal
 * row, not the paginated History page (HistoryPage.tsx), so a fixed cap
 * rather than cursor pagination. Same cap as Continue Watching/Upcoming
 * (DASHBOARD_ROW_LIMIT in apps/api/src/routes/library.ts) — James, 2026-08-24. */
const HISTORY_ROW_LIMIT = 8

/**
 * Dashboard's "History" row (DashboardPage.tsx), after Upcoming (UpNextRow)
 * — one card per recent play (movie or episode watch), newest first, so it
 * scrolls from most-recently-watched on the left to older on the right.
 * Unlike OnDeckRow.tsx/UpNextRow.tsx, this isn't deduplicated per show/movie
 * — a rewatch or a binged episode gets its own tile, same as the History
 * page's own per-play listing (HistoryPage.tsx). Reuses GET /plays (the same
 * endpoint HistoryPage.tsx pages through) rather than a new endpoint — it
 * already returns exactly this, newest first.
 *
 * Same "renders nothing, not even its own heading, while loading or with
 * zero plays" and horizontal-scroll-row shape as OnDeckRow.tsx/UpNextRow.tsx,
 * for the same reasons — see those components' doc comments.
 */
export function HistoryRow() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const { data, isLoading } = useQuery({
    queryKey: ['plays', 'recent'],
    queryFn: () => api.plays.list(undefined, HISTORY_ROW_LIMIT),
  })

  if (isLoading || !data || data.plays.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">
        <Link to="/history" className="hover:underline">
          {t('dashboard.history.title')}
        </Link>
      </h1>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {data.plays.map((play) => {
          const isMovie = play.media.type === 'movie'
          const title = isMovie ? play.media.title : (play.media.showTitle ?? play.media.title)
          const to = isMovie
            ? play.media.movieSlug
              ? `/movies/${play.media.movieSlug}`
              : undefined
            : play.media.showSlug
              ? `/shows/${play.media.showSlug}/season/${play.media.seasonNumber}/episode/${play.media.episodeNumber}`
              : undefined
          const watchedDate = new Date(play.watchedAt).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
          })

          return (
            <PosterTile
              key={play.id}
              title={title}
              year={null}
              posterPath={play.media.posterPath}
              to={to}
              className="w-40 flex-shrink-0"
            >
              <p className="text-xs text-[var(--color-fg-muted)]">
                {isMovie
                  ? t('dashboard.history.watchedLabel', { date: watchedDate })
                  : t('dashboard.history.episodeLabel', {
                      season: play.media.seasonNumber,
                      episode: play.media.episodeNumber,
                      date: watchedDate,
                    })}
              </p>
            </PosterTile>
          )
        })}
      </ul>
    </div>
  )
}
