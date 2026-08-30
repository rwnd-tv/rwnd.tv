import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth.js'
import { TokensPanel } from '../components/settings/TokensPanel.js'
import { DatabasePanel } from '../components/settings/DatabasePanel.js'
import { AboutPanel } from '../components/settings/AboutPanel.js'
import { InstanceSettingsPanel } from '../components/settings/InstanceSettingsPanel.js'
import { InvitesPanel } from '../components/settings/InvitesPanel.js'

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <TokensPanel />
      <DatabasePanel />
      <AboutPanel />
      {user?.role === 'admin' && <InstanceSettingsPanel />}
      {user?.role === 'admin' && <InvitesPanel />}
    </div>
  )
}
