import { NavLink, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth-context.js'
import { api } from '../lib/api-client.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
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
          className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-3"
        >
          <span className="flex items-center gap-2 text-lg font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            {t('app.name')}
            <EnvironmentBadge label={settings?.environmentLabel} />
          </span>
          <div className="flex items-center gap-2">
            <NavLink to="/search" className={navLinkClass}>
              {t('nav.search')}
            </NavLink>
            <NavLink to="/history" className={navLinkClass}>
              {t('nav.history')}
            </NavLink>
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
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
