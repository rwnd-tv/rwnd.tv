import { NavLink, Outlet, useMatches } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth-context.js'
import { api } from '../lib/api-client.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import type { RouteHandle } from '../lib/route-handle.js'
import { Button } from './ui/Button.js'
import { EnvironmentBadge } from './EnvironmentBadge.js'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
      : 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
  }`

export function Layout() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: settings } = usePublicSettings()
  const matches = useMatches()

  // Every page defaults to the existing 896px reading column. Gallery pages
  // (ShowsPage, MoviesPage) opt into the full viewport instead, via
  // `handle: { width: 'full' }` on their route in App.tsx — read here
  // through useMatches() rather than route path so the width lives with
  // the route definition, not as a path allow-list duplicated in Layout.
  // Applied to both <nav> and <main> so the header lines up with whichever
  // width is in use.
  const isFullWidth = matches.some(
    (match) => (match.handle as RouteHandle | undefined)?.width === 'full',
  )
  const containerClass = isFullWidth ? 'mx-auto w-full px-4' : 'mx-auto max-w-4xl px-4'

  async function handleLogout() {
    await api.auth.logout()
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-[var(--color-primary)] focus:px-3 focus:py-2 focus:text-[var(--color-primary-fg)]"
      >
        Skip to content
      </a>
      <header className="border-b border-[var(--color-border)]">
        <nav
          aria-label="Main"
          className={`flex flex-wrap items-center justify-between gap-4 py-3 ${containerClass}`}
        >
          <span className="flex items-center gap-2 text-lg font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            {t('app.name')}
            <EnvironmentBadge label={settings?.environmentLabel} />
          </span>
          <div className="flex items-center gap-2">
            <NavLink to="/shows" className={navLinkClass}>
              {t('nav.shows')}
            </NavLink>
            <NavLink to="/movies" className={navLinkClass}>
              {t('nav.movies')}
            </NavLink>
            <NavLink to="/search" className={navLinkClass}>
              {t('nav.search')}
            </NavLink>
            <NavLink to="/history" className={navLinkClass}>
              {t('nav.history')}
            </NavLink>
            {settings?.traktConfigured && (
              <NavLink to="/import" className={navLinkClass}>
                {t('nav.import')}
              </NavLink>
            )}
            <NavLink to="/settings" className={navLinkClass}>
              {t('nav.settings')}
            </NavLink>
            {user && (
              <Button variant="ghost" onClick={handleLogout}>
                {t('nav.logout')}
              </Button>
            )}
          </div>
        </nav>
      </header>
      <main id="main-content" className={`py-6 ${containerClass}`}>
        <Outlet />
      </main>
    </div>
  )
}
