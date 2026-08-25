import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth-context.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { Avatar } from './Avatar.js'
import {
  DashboardIcon,
  HistoryIcon,
  ImportIcon,
  MoviesIcon,
  SettingsIcon,
  ShowsIcon,
} from './icons.js'

function SidebarLink({
  to,
  label,
  icon,
  collapsed,
  onNavigate,
}: {
  to: string
  label: string
  icon: ReactNode
  collapsed: boolean
  onNavigate: () => void
}) {
  return (
    <li>
      <NavLink
        to={to}
        title={collapsed ? label : undefined}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
            isActive
              ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
              : 'text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
          }`
        }
      >
        {icon}
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    </li>
  )
}

/** Collapsible left-hand nav for the whole site, sitting below Layout's
 * full-width top bar (which owns the hamburger toggle — collapsed state
 * lives in Layout, passed down here). `top-16`/`h-[calc(100dvh-4rem)]` pin
 * it to fill the viewport below that 64px (h-16) header — `dvh`, not plain
 * `vh`: on mobile Chrome/Safari, `100vh` is the *largest* possible viewport
 * (as if the address bar were already hidden), so with `vh` this nav
 * rendered taller than what was actually on screen whenever the address bar
 * was showing, pushing Import/Settings/Profile off the bottom until the bar
 * auto-hid on scroll (found live on Android Chrome, 2026-08-21).
 *
 * `svh` (pinned to the smallest possible viewport) was tried in between —
 * no mid-scroll jank, since the nav never resizes, but that also means it's
 * *permanently* short by the address bar's height once the bar auto-hides,
 * leaving Import/Settings/Profile sitting above a dead gap the rest of the
 * time (James, 2026-08-21: prefers `dvh`'s momentary jank while the address
 * bar is actively animating over `svh`'s permanently-wrong resting state —
 * being correct once the scroll settles matters more than being stable
 * during it). Back to `dvh`. Otherwise self-contained: fetches its own
 * auth/settings state instead of having Layout thread props through, since
 * usePublicSettings and useAuth are cached React Query hooks — calling them
 * again here is free, not a second network request.
 *
 * Below the `sm` breakpoint (640px), "collapsed" stops meaning "icon rail"
 * and means "hidden entirely" instead — an icon rail still ate a real slice
 * of an already-narrow phone screen, enough to knock the shows/movies
 * gallery down to a single column (PosterGrid.tsx's `auto-fill` grid is
 * meant to fit 2 there). "Expanded" below that breakpoint switches from an
 * in-flow column to a `fixed` overlay spanning the same width, floating
 * over the content instead of squeezing it (James, 2026-08-21). `onNavigate`
 * (wired to Layout's `closeSidebarIfMobile`) closes that overlay after a
 * link click — Layout, not Sidebar, decides whether that actually applies
 * (checked against the same breakpoint at click time), since desktop's
 * expanded rail should stay open across navigation same as always. */
export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: settings } = usePublicSettings()

  return (
    <nav
      aria-label={t('nav.main')}
      className={
        collapsed
          ? 'hidden h-[calc(100dvh-4rem)] w-16 flex-shrink-0 flex-col border-r border-[var(--color-border)] transition-[width] duration-200 sm:sticky sm:top-16 sm:flex'
          : 'fixed left-0 top-16 z-30 flex h-[calc(100dvh-4rem)] w-56 flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] transition-[width] duration-200 sm:sticky sm:z-auto'
      }
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <SidebarLink
          to="/dashboard"
          label={t('nav.dashboard')}
          icon={<DashboardIcon />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <SidebarLink
          to="/shows"
          label={t('nav.shows')}
          icon={<ShowsIcon />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <SidebarLink
          to="/movies"
          label={t('nav.movies')}
          icon={<MoviesIcon />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <SidebarLink
          to="/history"
          label={t('nav.history')}
          icon={<HistoryIcon />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </ul>

      <ul className="flex flex-col gap-1 border-t border-[var(--color-border)] px-2 py-2">
        {settings?.traktConfigured && (
          <SidebarLink
            to="/import"
            label={t('nav.import')}
            icon={<ImportIcon />}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        )}
        <SidebarLink
          to="/settings"
          label={t('nav.settings')}
          icon={<SettingsIcon />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </ul>

      {/* Which account is active — James's ask from real multi-account use
          (switching between his own account and a managed "Carol Bulman"
          account while testing Plex webhook attribution): nothing here
          showed identity at all before this, so it was easy to lose track
          of which account a shared browser was currently on. Links to
          ProfilePage.tsx, where the avatar itself is changed and — since
          2026-08-25 — Log out now lives (this used to be a separate
          standalone Log out button here; James: once the Profile page had
          its own, the sidebar's copy was redundant with this row). */}
      {user && (
        <Link
          to="/profile"
          title={collapsed ? user.displayName : undefined}
          onClick={onNavigate}
          className="flex items-center gap-3 border-t border-[var(--color-border)] px-3.5 py-3 text-sm font-medium hover:bg-[var(--color-surface)]"
        >
          <Avatar user={user} size={32} />
          {!collapsed && <span className="min-w-0 truncate">{user.displayName}</span>}
        </Link>
      )}
    </nav>
  )
}
