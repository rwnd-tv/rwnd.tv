import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'

/** "2d 4h 12m" — always shows minutes, hours once a day has passed, days
 * once a day has (i.e. never a bare "12h 340m"). Compact/technical rather
 * than prose, so no i18n pluralization needed (matches how a version
 * number or byte count reads the same across locales). */
function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (days > 0 || hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

export function AboutPanel() {
  const { t } = useTranslation()
  const { data: settings } = usePublicSettings()
  const { data: about } = useQuery({
    queryKey: ['settings', 'about'],
    queryFn: () => api.settings.getAbout(),
  })

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('settings.about.title')}</h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {settings && (
          <>
            <dt className="text-right font-medium">{t('settings.about.version')}</dt>
            <dd>{settings.appVersion}</dd>
          </>
        )}
        {about && (
          <>
            <dt className="text-right font-medium">{t('settings.about.nodeVersion')}</dt>
            <dd>{about.nodeVersion}</dd>
            <dt className="text-right font-medium">{t('settings.about.postgresVersion')}</dt>
            <dd>{about.postgresVersion}</dd>
            <dt className="text-right font-medium">{t('settings.about.migrationCount')}</dt>
            <dd>{about.migrationCount}</dd>
            <dt className="text-right font-medium">{t('settings.about.uptime')}</dt>
            <dd>{formatUptime(about.uptimeSeconds)}</dd>
            {about.environmentLabel && (
              <>
                <dt className="text-right font-medium">{t('settings.about.environment')}</dt>
                <dd>{about.environmentLabel}</dd>
              </>
            )}
          </>
        )}
      </dl>
    </Card>
  )
}
