import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { resetAuthCache } from '../../lib/reset-auth-cache.js'
import { Button } from '../ui/Button.js'
import { LogoutIcon } from '../icons.js'

/**
 * Moved here from Sidebar.tsx's own standalone Log out button — James,
 * 2026-08-25: once this page (Profile at the time, renamed Account the
 * same day) had its own Log out, the sidebar's copy became redundant (the
 * sidebar's avatar+name row already links straight to this page), so it's
 * a page-only action now rather than living in both places. Started as
 * its own bottom-of-page Card, then moved the same day to sit inline next
 * to the "Account" heading (AccountPage.tsx) — no longer a section, just
 * a plain button, hence no Card wrapper here anymore.
 */
export function LogoutButton() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  async function handleLogout() {
    await api.auth.logout()
    await resetAuthCache(queryClient)
  }

  return (
    <Button type="button" variant="secondary" onClick={() => void handleLogout()}>
      <LogoutIcon />
      {t('nav.logout')}
    </Button>
  )
}
