import { useState } from 'react'
import { Link, Outlet, useMatches } from 'react-router'
import { useTranslation } from 'react-i18next'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { getCookie, setSessionCookie } from '../lib/cookies.js'
import type { RouteHandle } from '../lib/route-handle.js'
import { EnvironmentBadge } from './EnvironmentBadge.js'
import { PageTitleEffect } from './PageTitleEffect.js'
import { Sidebar } from './Sidebar.js'
import { MenuIcon } from './icons.js'

const SIDEBAR_COLLAPSED_COOKIE = 'sidebar-collapsed'

// Matches Tailwind's default `sm` breakpoint — see Sidebar.tsx's own doc
// comment for why "collapsed" means something different below it (hidden
// entirely vs. an icon rail).
const MOBILE_BREAKPOINT_QUERY = '(max-width: 639px)'

export function Layout() {
  const { t } = useTranslation()
  const { data: settings } = usePublicSettings()
  const matches = useMatches()
  const [collapsed, setCollapsed] = useState(() => getCookie(SIDEBAR_COLLAPSED_COOKIE) === 'true')

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current
      setSessionCookie(SIDEBAR_COLLAPSED_COOKIE, String(next))
      return next
    })
  }

  // On mobile, the expanded sidebar is a full overlay (see Sidebar.tsx) —
  // clicking a nav link inside it should close it back down rather than
  // leaving it floating over the page it just navigated to. On desktop the
  // expanded rail is meant to stay open across navigation, same as always,
  // so this only acts below the breakpoint — checked at click time rather
  // than tracked in state, since nothing else here needs to re-render on
  // resize.
  function closeSidebarIfMobile() {
    if (!window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) return
    setCollapsed((current) => {
      if (current) return current
      setSessionCookie(SIDEBAR_COLLAPSED_COOKIE, 'true')
      return true
    })
  }

  // Every page defaults to the existing 896px reading column. Gallery pages
  // (ShowsPage, MoviesPage) opt into the full viewport instead, via
  // `handle: { width: 'full' }` on their route in App.tsx — read here
  // through useMatches() rather than route path so the width lives with
  // the route definition, not as a path allow-list duplicated in Layout.
  const isFullWidth = matches.some(
    (match) => (match.handle as RouteHandle | undefined)?.width === 'full',
  )
  // `w-full` is required here, not just `max-w-4xl` — main is a block child
  // of the plain (non-flex) content wrapper below, so normal block-flow
  // width:auto would already fill it; `w-full` just makes that explicit and
  // keeps this resilient if that wrapper's display ever changes.
  const containerClass = isFullWidth ? 'mx-auto w-full px-4' : 'mx-auto w-full max-w-4xl px-4'

  return (
    <div className="flex min-h-screen flex-col">
      <PageTitleEffect />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-[var(--color-primary)] focus:px-3 focus:py-2 focus:text-[var(--color-primary-fg)]"
      >
        Skip to content
      </a>
      {/* Full-width top bar: hamburger, then the mark, then the wordmark —
          spans the whole page rather than being capped to the reading
          column. Sidebar + content sit in a row underneath it. */}
      <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          title={t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')}
          // p-3 (not p-2) so the icon lands 20px from the page edge (8px
          // header px-2 + 12px button padding), matching the nav icons
          // below it (Sidebar's ul px-2 + link px-3 — see Sidebar.tsx).
          className="flex flex-shrink-0 items-center justify-center rounded-md p-3 text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
        >
          <MenuIcon />
        </button>
        {/* "/" redirects to "/dashboard" (see App.tsx) — Layout only renders
            behind ProtectedRoute, so this is always the logged-in home. */}
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-6 w-6 flex-shrink-0" />
          <span className="min-w-0 truncate text-lg font-semibold">{t('app.name')}</span>
        </Link>
        <EnvironmentBadge label={settings?.environmentLabel} />
      </header>
      <div className="flex flex-1">
        <Sidebar collapsed={collapsed} onNavigate={closeSidebarIfMobile} />
        <div className="min-w-0 flex-1">
          <main id="main-content" className={`py-6 ${containerClass}`}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
