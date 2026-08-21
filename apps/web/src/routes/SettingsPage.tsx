import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth-context.js'
import { ProfileForm } from '../components/settings/ProfileForm.js'
import { TokensPanel } from '../components/settings/TokensPanel.js'
import { DatabasePanel } from '../components/settings/DatabasePanel.js'
import { InstanceSettingsPanel } from '../components/settings/InstanceSettingsPanel.js'

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <ProfileForm />
      <TokensPanel />
      <DatabasePanel />
      {user?.role === 'admin' && <InstanceSettingsPanel />}
    </div>
  )
}
