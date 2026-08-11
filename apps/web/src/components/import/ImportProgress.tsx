import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { ImportJobStatus } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'

const ACTIVE_STATUSES: ReadonlySet<ImportJobStatus> = new Set(['pending', 'running'])

export function ImportProgress() {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: ['import', 'jobs'],
    queryFn: () => api.imports.jobs(),
    refetchInterval: (query) => {
      const latest = query.state.data?.jobs[0]
      return latest && ACTIVE_STATUSES.has(latest.status) ? 1500 : false
    },
  })

  const latest = data?.jobs[0]
  if (!latest) return null

  const total = latest.itemsTotal
  const percent = total ? Math.min(100, Math.round((latest.itemsProcessed / total) * 100)) : null

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{t('import.progress.title')}</h2>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t(`import.progress.status.${latest.status}`)}
      </p>

      <div
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-all"
          style={{ width: percent != null ? `${percent}%` : '0%' }}
        />
      </div>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t('import.progress.counts', {
          processed: latest.itemsProcessed,
          total: total ?? '?',
          imported: latest.itemsImported,
        })}
      </p>

      {latest.failures.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t('import.progress.failuresSummary', { count: latest.failures.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
            {latest.failures.map((failure, i) => (
              <li key={i}>
                {failure.title ? `${failure.title} — ` : ''}
                {failure.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {latest.error && <p className="mt-2 text-sm text-[var(--color-danger)]">{latest.error}</p>}
    </Card>
  )
}
