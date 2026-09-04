import { useTranslation } from 'react-i18next'
import { isAdminRole } from '@rwnd/shared'
import { useAuth } from '../lib/use-auth.js'
import { AboutPanel } from '../components/settings/AboutPanel.js'
import { TokensPanel } from '../components/settings/TokensPanel.js'
import { LinkedAccountsPanel } from '../components/settings/LinkedAccountsPanel.js'
import { CalendarFeedsPanel } from '../components/settings/CalendarFeedsPanel.js'
import { DatabasePanel } from '../components/settings/DatabasePanel.js'
import { InstanceSettingsPanel } from '../components/settings/InstanceSettingsPanel.js'
import { InvitesPanel } from '../components/settings/InvitesPanel.js'

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = Boolean(user && isAdminRole(user.role))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <AboutPanel />
      <TokensPanel />
      <LinkedAccountsPanel />
      <CalendarFeedsPanel />
      <DatabasePanel />
      {isAdmin && <InstanceSettingsPanel />}
      {isAdmin && <InvitesPanel />}
    </div>
  )
}
