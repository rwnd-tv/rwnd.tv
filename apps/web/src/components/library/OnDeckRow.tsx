import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { PosterTile } from './PosterTile.js'

/**
 * Dashboard's "continue watching" row (DashboardPage.tsx) — one card per
 * show the user watched in the last 30 days and hasn't finished, each
 * linking straight to the next episode they haven't seen yet (see
 * GET /library/on-deck's doc comment in apps/api/src/routes/library.ts for
 * how "next" is decided). Renders nothing at all — not even the "On Deck"
 * heading — while loading or once loaded with zero shows, rather than
 * showing an empty section: unlike the TV Shows/Movies gallery, there's no
 * "you don't have anything yet" empty state worth having here, since a
 * user with no recent activity just doesn't get this row. Its own heading
 * doubles as the Dashboard's page title (James: drop the generic
 * "Dashboard" h1 and promote this one instead) — DashboardPage.tsx has no
 * h1 of its own, so the page is titleless on the rare load with nothing
 * on deck, same tradeoff as the row itself disappearing.
 *
 * A single flex row with `overflow-x-auto` (not PosterGrid.tsx's wrapping
 * grid) is deliberate — this is meant to read as one continuous "keep
 * going" row you scroll sideways through, the same shape Netflix/Plex's
 * own continue-watching rows use, and it's what keeps this working on a
 * narrow phone screen without a separate mobile layout: the row just
 * scrolls instead of squeezing cards down or wrapping.
 */
export function OnDeckRow() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['library', 'on-deck'],
    queryFn: () => api.library.onDeck(),
  })

  if (isLoading || !data || data.shows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t('dashboard.onDeck.title')}</h1>
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
              {t('dashboard.onDeck.episodeLabel', {
                season: show.seasonNumber,
                episode: show.episodeNumber,
              })}
            </p>
          </PosterTile>
        ))}
      </ul>
    </div>
  )
}
