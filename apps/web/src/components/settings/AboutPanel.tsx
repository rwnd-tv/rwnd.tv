import { useTranslation } from 'react-i18next'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'

export function AboutPanel() {
  const { t } = useTranslation()
  const { data } = usePublicSettings()

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('settings.about.title')}</h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
      {data && (
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('settings.about.version', { version: data.appVersion })}
        </p>
      )}
    </Card>
  )
}
