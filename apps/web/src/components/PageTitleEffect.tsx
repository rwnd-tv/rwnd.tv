import { useEffect } from 'react'
import { useLocation, useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { api } from '../lib/api-client.js'

/** Static top-level sections — each maps its exact path to the same i18n
 * key the sidebar uses for that page (Sidebar.tsx), so the breadcrumb
 * always agrees with the nav label. Dynamic pages (ShowDetailPage,
 * SeasonDetailPage, MovieDetailPage) aren't listed here — they're handled
 * separately below, since their trailing segment depends on loaded data,
 * not just the path. */
const SECTION_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/shows': 'nav.shows',
  '/movies': 'nav.movies',
  '/history': 'nav.history',
  '/import': 'nav.import',
  '/settings': 'nav.settings',
}

/**
 * Sets the browser tab title to a breadcrumb trail — "[LABEL] rwnd.tv >
 * TV Shows > Game of Thrones (2011)" — for every page under Layout,
 * overriding the plain "[LABEL] rwnd.tv" EnvironmentTitleEffect sets
 * globally. Lives here (rendered from Layout.tsx) rather than alongside
 * EnvironmentTitleEffect in main.tsx because it needs route context —
 * login/register/setup/404 aren't wrapped by Layout and keep the plain
 * title, which is fine since there's nothing to break out for there.
 */
export function PageTitleEffect() {
  const { t } = useTranslation()
  const location = useLocation()
  const { data: settings } = usePublicSettings()
  const showMatch = useMatch('/shows/:slug')
  const seasonMatch = useMatch('/shows/:slug/season/:seasonNumber')
  const movieMatch = useMatch('/movies/:slug')
  // Either show match supplies a slug — a season page needs the show's
  // title too, same as the show page itself.
  const slug = showMatch?.params.slug ?? seasonMatch?.params.slug

  // Same queryKey as ShowDetailPage.tsx — React Query dedupes/shares the
  // fetch rather than issuing a second request, so this is free once that
  // page's own query has resolved (or resolves this one first, on a
  // fresh load/refresh where this effect mounts before the page does).
  const { data: show } = useQuery({
    queryKey: ['show', slug],
    queryFn: () => api.library.show(slug!),
    enabled: Boolean(slug),
  })

  // Same queryKey as SeasonDetailPage.tsx.
  const seasonNumber = seasonMatch ? Number(seasonMatch.params.seasonNumber) : NaN
  const { data: season } = useQuery({
    queryKey: ['show', slug, 'season', seasonNumber],
    queryFn: () => api.library.season(slug!, seasonNumber),
    enabled: Boolean(seasonMatch) && Number.isInteger(seasonNumber),
  })

  // Same queryKey as MovieDetailPage.tsx.
  const movieSlug = movieMatch?.params.slug
  const { data: movie } = useQuery({
    queryKey: ['movie', movieSlug],
    queryFn: () => api.library.movie(movieSlug!),
    enabled: Boolean(movieSlug),
  })

  useEffect(() => {
    const base = settings?.environmentLabel ? `[${settings.environmentLabel}] rwnd.tv` : 'rwnd.tv'
    const segments = [base]

    const sectionKey = SECTION_KEYS[location.pathname]
    if (sectionKey) {
      segments.push(t(sectionKey))
    } else if (showMatch) {
      segments.push(t('nav.shows'))
      if (show) segments.push(show.year ? `${show.title} (${show.year})` : show.title)
    } else if (seasonMatch) {
      segments.push(t('nav.shows'))
      if (show) segments.push(show.year ? `${show.title} (${show.year})` : show.title)
      if (season) {
        segments.push(
          season.name ??
            (season.seasonNumber === 0
              ? t('showDetail.specials')
              : t('import.progress.season', { number: season.seasonNumber })),
        )
      }
    } else if (movieMatch) {
      segments.push(t('nav.movies'))
      if (movie) segments.push(movie.year ? `${movie.title} (${movie.year})` : movie.title)
    }

    document.title = segments.join(' > ')
  }, [
    location.pathname,
    settings?.environmentLabel,
    showMatch,
    seasonMatch,
    movieMatch,
    show,
    season,
    movie,
    t,
  ])

  return null
}
