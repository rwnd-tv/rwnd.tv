import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

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

/** Moved to the top of the Settings page and made the one panel expanded
 * by default (James, 2026-09-02, alongside making every other panel on
 * this page collapsible and collapsed by default) — version/runtime
 * info is the thing most worth seeing immediately, e.g. when reporting
 * a bug. See account/AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component. */
export function AboutPanel() {
  const { t } = useTranslation()
  const [open, setOpen] = usePanelOpen('panelSettingsAbout', true)
  const { data: settings } = usePublicSettings()
  const { data: about } = useQuery({
    queryKey: ['settings', 'about'],
    queryFn: () => api.settings.getAbout(),
  })

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.about.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
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
      </details>
    </Card>
  )
}
