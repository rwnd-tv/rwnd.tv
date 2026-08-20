import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth-context.js'
import { api } from '../lib/api-client.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import {
  DashboardIcon,
  HistoryIcon,
  ImportIcon,
  LogoutIcon,
  MoviesIcon,
  SettingsIcon,
  ShowsIcon,
} from './icons.js'

function SidebarLink({
  to,
  label,
  icon,
  collapsed,
}: {
  to: string
  label: string
  icon: ReactNode
  collapsed: boolean
}) {
  return (
    <li>
      <NavLink
        to={to}
        title={collapsed ? label : undefined}
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
 * lives in Layout, passed down here). `top-16`/`h-[calc(100vh-4rem)]` pin it
 * to fill the viewport below that 64px (h-16) header. Otherwise
 * self-contained: fetches its own auth/settings state instead of having
 * Layout thread props through, since usePublicSettings and useAuth are
 * cached React Query hooks — calling them again here is free, not a second
 * network request. */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: settings } = usePublicSettings()

  async function handleLogout() {
    await api.auth.logout()
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  }

  return (
    <nav
      aria-label={t('nav.main')}
      className={`sticky top-16 flex h-[calc(100vh-4rem)] flex-shrink-0 flex-col border-r border-[var(--color-border)] transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        <SidebarLink
          to="/dashboard"
          label={t('nav.dashboard')}
          icon={<DashboardIcon />}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/shows"
          label={t('nav.shows')}
          icon={<ShowsIcon />}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/movies"
          label={t('nav.movies')}
          icon={<MoviesIcon />}
          collapsed={collapsed}
        />
        <SidebarLink
          to="/history"
          label={t('nav.history')}
          icon={<HistoryIcon />}
          collapsed={collapsed}
        />
      </ul>

      <ul className="flex flex-col gap-1 border-t border-[var(--color-border)] px-2 py-2">
        {settings?.traktConfigured && (
          <SidebarLink
            to="/import"
            label={t('nav.import')}
            icon={<ImportIcon />}
            collapsed={collapsed}
          />
        )}
        <SidebarLink
          to="/settings"
          label={t('nav.settings')}
          icon={<SettingsIcon />}
          collapsed={collapsed}
        />
        {user && (
          <li>
            <button
              type="button"
              onClick={handleLogout}
              title={collapsed ? t('nav.logout') : undefined}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              <LogoutIcon />
              {!collapsed && <span className="truncate">{t('nav.logout')}</span>}
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}
