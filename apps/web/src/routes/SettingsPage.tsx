import { useTranslation } from 'react-i18next'
import { AboutPanel } from '../components/settings/AboutPanel.js'
import { WebhooksPanel } from '../components/settings/WebhooksPanel.js'
import { LinkedAccountsPanel } from '../components/settings/LinkedAccountsPanel.js'
import { CalendarFeedsPanel } from '../components/settings/CalendarFeedsPanel.js'
import { DatabasePanel } from '../components/settings/DatabasePanel.js'

export function SettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <AboutPanel />
      <WebhooksPanel />
      <LinkedAccountsPanel />
      <CalendarFeedsPanel />
      <DatabasePanel />
    </div>
  )
}
