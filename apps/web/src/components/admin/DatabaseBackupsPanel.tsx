import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DatabaseBackupRetention } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

const QUERY_KEY = ['admin', 'databaseBackups']

// Same source LandingPage.tsx links its self-hosting doc from — restoring
// stays a manual shell procedure (ADR 0008), not a route, so this panel can
// only point at where that procedure is documented, not perform it.
const REPO = 'https://github.com/rwnd-tv/rwnd.tv'
const RESTORE_DOCS_URL = `${REPO}/blob/main/docs/self-hosting.md#restoring`

/** "12.4 MB" — compact/technical rather than prose, same reasoning as
 * AboutPanel.tsx's formatUptime: a byte count reads the same across
 * locales, so no i18n pluralization is needed for it. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(1)} MB`
}

/**
 * Read-only status for, plus the editable retention policy of, the
 * automatic whole-database backup job (apps/api/src/lib/database-backup.ts,
 * ADR 0008, docs/TODO.md's "Admin interface for the instance's automatic
 * database backups") — `GET`/`PATCH /admin/database-backups`. No manual
 * "back up now" trigger here, deliberately: that needs its own route shape
 * (a process spawned on request rather than a timer) and its own decision.
 *
 * Stays visible and explains itself when DATABASE_BACKUP_DIR isn't set,
 * rather than hiding — same convention as the Role/Delete-account panels on
 * AdminUserPage.tsx (a blocked panel explains why in place). That's also
 * why this reads `configured` from its own admin-only response instead of
 * a public `*Configured` field on instanceSettingsSchema: nothing here
 * needs to be decided before the admin-only route is reachable.
 *
 * The backup cadence itself (`intervalHours`) is shown but not editable —
 * only the retention tiers are (RetentionTiers' own doc comment explains
 * why the cadence stays fixed).
 */
export function DatabaseBackupsPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAdminDatabaseBackups')

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.admin.databaseBackupStatus(),
  })

  const [dailyRetentionDays, setDailyRetentionDays] = useState('')
  const [weeklyRetentionWeeks, setWeeklyRetentionWeeks] = useState('')
  const [monthlyRetentionMonths, setMonthlyRetentionMonths] = useState('')
  const [saveError, setSaveError] = useState<string>()

  // Seeds the editable fields from the query once it loads, same "sync
  // during render on identity change" technique as InstanceSettingsPanel.tsx
  // (see its own doc comment for why not useState(data) or a useEffect).
  const [loadedRetention, setLoadedRetention] = useState<DatabaseBackupRetention>()
  if (data?.retention && data.retention !== loadedRetention) {
    setLoadedRetention(data.retention)
    setDailyRetentionDays(String(data.retention.dailyRetentionDays))
    setWeeklyRetentionWeeks(String(data.retention.weeklyRetentionWeeks))
    setMonthlyRetentionMonths(String(data.retention.monthlyRetentionMonths))
  }

  const updateRetention = useMutation({
    mutationFn: () =>
      api.admin.updateDatabaseBackupRetention({
        dailyRetentionDays: Number(dailyRetentionDays),
        weeklyRetentionWeeks: Number(weeklyRetentionWeeks),
        monthlyRetentionMonths: Number(monthlyRetentionMonths),
      }),
    onSuccess: (updated) => {
      // The PATCH response is already the full, fresh status — write it
      // straight into the cache rather than invalidating and refetching.
      queryClient.setQueryData(QUERY_KEY, updated)
      setSaveError(undefined)
    },
    onError: (err) =>
      setSaveError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  const dirty =
    data?.retention !== undefined &&
    (Number(dailyRetentionDays) !== data.retention.dailyRetentionDays ||
      Number(weeklyRetentionWeeks) !== data.retention.weeklyRetentionWeeks ||
      Number(monthlyRetentionMonths) !== data.retention.monthlyRetentionMonths)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaveError(undefined)
    updateRetention.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('admin.databaseBackups.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : isError ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {t('common.somethingWentWrong')}
          </p>
        ) : data && !data.configured ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t('admin.databaseBackups.notConfigured')}
          </p>
        ) : data ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-right font-medium">{t('admin.databaseBackups.lastBackup')}</dt>
              <dd>
                {data.files[0]
                  ? t('admin.databaseBackups.lastBackupValue', {
                      date: new Date(data.files[0].createdAt).toLocaleString(i18n.language),
                      size: formatBytes(data.files[0].bytes),
                    })
                  : t('admin.databaseBackups.lastBackupNone')}
              </dd>
              <dt className="text-right font-medium">{t('admin.databaseBackups.schedule')}</dt>
              <dd>{t('admin.databaseBackups.scheduleValue', { hours: data.intervalHours })}</dd>
            </dl>

            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('admin.databaseBackups.restorePrompt')}{' '}
              <a
                href={RESTORE_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] underline"
              >
                {t('admin.databaseBackups.restoreLinkText')}
              </a>
              .
            </p>

            {data.lastRun?.status === 'failed' && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {t('admin.databaseBackups.lastRunFailed', {
                  date: new Date(data.lastRun.at).toLocaleString(i18n.language),
                  message: data.lastRun.message,
                })}
              </p>
            )}

            {data.directoryError && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {t('admin.databaseBackups.directoryError', { message: data.directoryError })}
              </p>
            )}

            {data.files.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm text-[var(--color-fg-muted)]">
                {data.files.map((file) => (
                  <li key={file.name} className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="text-[var(--color-fg)]">
                        {new Date(file.createdAt).toLocaleString(i18n.language)}
                      </span>
                      <span className="text-xs break-words">{file.name}</span>
                    </div>
                    <span className="shrink-0">{formatBytes(file.bytes)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 border-t border-[var(--color-border)] pt-4">
              <h3 className="mb-1 text-sm font-semibold">
                {t('admin.databaseBackups.retentionTitle')}
              </h3>
              <p className="mb-3 text-sm text-[var(--color-fg-muted)]">
                {t('admin.databaseBackups.retentionDescription')}
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field
                    label={t('admin.databaseBackups.dailyRetentionDays')}
                    type="number"
                    min={1}
                    max={3650}
                    value={dailyRetentionDays}
                    onChange={(e) => setDailyRetentionDays(e.target.value)}
                    required
                  />
                  <Field
                    label={t('admin.databaseBackups.weeklyRetentionWeeks')}
                    type="number"
                    min={0}
                    max={520}
                    value={weeklyRetentionWeeks}
                    onChange={(e) => setWeeklyRetentionWeeks(e.target.value)}
                    required
                  />
                  <Field
                    label={t('admin.databaseBackups.monthlyRetentionMonths')}
                    type="number"
                    min={0}
                    max={600}
                    value={monthlyRetentionMonths}
                    onChange={(e) => setMonthlyRetentionMonths(e.target.value)}
                    required
                  />
                </div>
                {saveError && (
                  <p role="alert" className="text-sm text-[var(--color-danger)]">
                    {saveError}
                  </p>
                )}
                <div>
                  <Button type="submit" disabled={!dirty} isLoading={updateRetention.isPending}>
                    {t('admin.databaseBackups.retentionSave')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </details>
    </Card>
  )
}
