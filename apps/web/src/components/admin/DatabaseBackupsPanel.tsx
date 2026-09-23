import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DatabaseBackupRetention, DatabaseBackupStatus } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { CollapsiblePanel } from '../ui/CollapsiblePanel.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { Spinner } from '../ui/Spinner.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

const QUERY_KEY = ['admin', 'databaseBackups']

// Same source LandingPage.tsx links its self-hosting doc from — restoring
// stays documented here too, since the manual shell procedure remains the
// only option when restoreAvailable is false (not running under
// docker-entrypoint.sh) or the caller isn't the owner.
const REPO = 'https://github.com/rwnd-tv/rwnd.tv'
const RESTORE_DOCS_URL = `${REPO}/blob/main/docs/self-hosting.md#restoring`

/** How long the "Restoring…" state polls GET /health before giving up and
 * telling the owner to check the host directly — generous relative to a
 * self-hosted container's real restart time (image already pulled/built,
 * migrations run against data that's already there), which is normally a
 * handful of seconds. */
const RESTORE_POLL_TIMEOUT_MS = 60_000
const RESTORE_POLL_INTERVAL_MS = 2_000

/** "12.4 MB" — compact/technical rather than prose, same reasoning as
 * AboutPanel.tsx's formatUptime: a byte count reads the same across
 * locales, so no i18n pluralization is needed for it. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(1)} MB`
}

/**
 * The confirm-and-restore dialog for one file (a regular backup or a
 * pre-restore snapshot — both restorable through the same route). Same
 * typed-confirmation-plus-password shape as DeleteAccountCard.tsx/
 * TransferOwnershipCard.tsx, except the typed value is the instance name
 * rather than the caller's own email: the consequence here (every user's
 * data replaced) is instance-wide, not personal.
 *
 * `onRestoring` fires once the 202 lands — DatabaseBackupsPanel.tsx owns
 * the actual polling state, since it has to survive this dialog closing.
 */
function RestoreDialog({
  file,
  createdAt,
  onClose,
  onRestoring,
}: {
  file: string
  createdAt: string
  onClose: () => void
  onRestoring: () => void
}) {
  const { t, i18n } = useTranslation()
  const { data: settings } = usePublicSettings()
  const [confirmInstanceName, setConfirmInstanceName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string>()

  const restore = useMutation({
    mutationFn: () =>
      api.admin.restoreDatabaseBackup(file, { confirmInstanceName, currentPassword }),
    onSuccess: onRestoring,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    restore.mutate()
  }

  return (
    <Dialog open onClose={onClose} title={t('admin.databaseBackups.restoreConfirmTitle')}>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t('admin.databaseBackups.restoreConfirmBody', {
          file,
          date: new Date(createdAt).toLocaleString(i18n.language),
        })}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('admin.databaseBackups.restoreConfirmInstanceName', {
            name: settings?.instanceName ?? 'rwnd.tv',
          })}
          value={confirmInstanceName}
          onChange={(e) => setConfirmInstanceName(e.target.value)}
          required
        />
        <Field
          label={t('admin.databaseBackups.restoreConfirmPassword')}
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          error={error}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" isLoading={restore.isPending}>
            {t('admin.databaseBackups.restoreButton')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Polls GET /health (a public, unauthenticated route) after a restore's
 * 202, and moves to `/login` once it's back — never `/admin`, since the
 * acting owner's own session row was itself part of what just got replaced.
 * Only counts the API as "back" after at least one failed poll first: the
 * old process is still answering for the ~500ms between the 202 response
 * and its own `exitForRestore()` call, and a success on the very first poll
 * would otherwise be mistaken for the new process already being up. */
function RestoringState() {
  const { t } = useTranslation()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    let sawFailure = false
    const startedAt = Date.now()

    const interval = setInterval(() => {
      void (async () => {
        try {
          await api.health()
          if (cancelled) return
          if (sawFailure) {
            window.location.assign('/login')
            return
          }
        } catch {
          sawFailure = true
        }
        if (!cancelled && Date.now() - startedAt > RESTORE_POLL_TIMEOUT_MS) {
          setTimedOut(true)
          clearInterval(interval)
        }
      })()
    }, RESTORE_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {timedOut ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {t('admin.databaseBackups.restoreTimedOut')}
        </p>
      ) : (
        <>
          <Spinner label={t('admin.databaseBackups.restoreInProgressTitle')} />
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t('admin.databaseBackups.restoreInProgressBody')}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Read-only status for, plus the editable retention policy of, the
 * automatic whole-database backup job (apps/api/src/lib/database-backup.ts,
 * ADR 0008, docs/TODO.md's "Admin interface for the instance's automatic
 * database backups") — `GET`/`PATCH /admin/database-backups`. Also a manual
 * "back up now" trigger (`POST .../run`), which shares the same
 * concurrent-run guard and lastRun bookkeeping as the scheduled job, so a
 * 409 or a failed run surfaces the same way either path produced it.
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
 *
 * Restore (ADR 0008's 2026-09-22 update): owner-only, and only offered when
 * `restoreAvailable` (the API is running under docker-entrypoint.sh — see
 * apps/api/src/lib/database-restore.ts). Neither gap hides the feature —
 * same "explain, don't disappear" convention as the whole panel — it just
 * explains why the button isn't there. Every restore first takes an
 * automatic pre-restore snapshot as an undo point, listed in its own
 * section below with the same Restore button, so undoing a restore is the
 * same one-click flow as doing one.
 */
export function DatabaseBackupsPanel() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
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
  const [runSucceeded, setRunSucceeded] = useState(false)
  const [runError, setRunError] = useState<string>()
  const [restoreTarget, setRestoreTarget] = useState<{ file: string; createdAt: string }>()
  const [restoring, setRestoring] = useState(false)

  // Seeds the editable fields from the query once it loads, same "sync
  // during render on identity change" technique as InstanceSettingsPanel.tsx
  // (see its own doc comment for why not useState(data) or a useEffect) -
  // re-seeding per field against what THAT field last read from the server,
  // not against the field's current value, for the same reason
  // InstanceSettingsPanel.tsx does: "Run backup now" (below) writes a fresh
  // status object into this query's cache on every click via
  // queryClient.setQueryData, giving `data.retention` a new identity even
  // when the retention values themselves haven't changed, which used to
  // blanket-overwrite all three fields and silently discard an in-progress
  // edit made while a run was in flight.
  const [loadedRetention, setLoadedRetention] = useState<DatabaseBackupRetention>()
  if (data?.retention && data.retention !== loadedRetention) {
    const prev = loadedRetention
    setLoadedRetention(data.retention)
    setDailyRetentionDays((current) =>
      prev && data.retention.dailyRetentionDays === prev.dailyRetentionDays
        ? current
        : String(data.retention.dailyRetentionDays),
    )
    setWeeklyRetentionWeeks((current) =>
      prev && data.retention.weeklyRetentionWeeks === prev.weeklyRetentionWeeks
        ? current
        : String(data.retention.weeklyRetentionWeeks),
    )
    setMonthlyRetentionMonths((current) =>
      prev && data.retention.monthlyRetentionMonths === prev.monthlyRetentionMonths
        ? current
        : String(data.retention.monthlyRetentionMonths),
    )
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

  const runNow = useMutation({
    mutationFn: () => api.admin.runDatabaseBackupNow(),
    onSuccess: (updated) => {
      // Same status shape PATCH's onSuccess writes straight into the
      // cache — a failed run (e.g. a version mismatch) still comes back as
      // a 200 with lastRun.status === 'failed', surfaced by the
      // lastRunFailed banner below rather than as a mutation error here.
      queryClient.setQueryData(QUERY_KEY, updated)
      setRunError(undefined)
      setRunSucceeded(true)
    },
    onError: (err) => {
      // A 409 (already running / not configured) or 429 (rate limited)
      // lands here instead, with the server's own message.
      setRunSucceeded(false)
      setRunError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    },
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

  const canRestore = user?.role === 'owner'

  function restoreButton(file: { name: string; createdAt: string }) {
    if (!data || !data.configured) return null
    if (!canRestore || !data.restoreAvailable) return null
    return (
      <Button
        type="button"
        variant="danger"
        className="shrink-0"
        onClick={() => setRestoreTarget({ file: file.name, createdAt: file.createdAt })}
      >
        {t('admin.databaseBackups.restoreButton')}
      </Button>
    )
  }

  function renderFileList(files: DatabaseBackupStatus['files']) {
    return (
      <ul className="flex flex-col gap-2 text-sm text-[var(--color-fg-muted)]">
        {files.map((file) => (
          <li key={file.name} className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="text-[var(--color-fg)]">
                {new Date(file.createdAt).toLocaleString(i18n.language)}
              </span>
              <span className="text-xs break-words">{file.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span>{formatBytes(file.bytes)}</span>
              {restoreButton(file)}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <CollapsiblePanel title={t('admin.databaseBackups.title')} open={open} onOpenChange={setOpen}>
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
      ) : data && restoring ? (
        <RestoringState />
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

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRunSucceeded(false)
                runNow.mutate()
              }}
              isLoading={runNow.isPending}
            >
              {t('admin.databaseBackups.runNow')}
            </Button>
            {runSucceeded && (
              <span role="status" className="text-sm text-[var(--color-fg-muted)]">
                {t('admin.databaseBackups.runNowSucceeded')}
              </span>
            )}
            {runError && (
              <span role="alert" className="text-sm text-[var(--color-danger)]">
                {runError}
              </span>
            )}
          </div>

          {canRestore && data.restoreAvailable ? (
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('admin.databaseBackups.restoreAvailablePrompt')}{' '}
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
          ) : (
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
              .{' '}
              {!canRestore
                ? t('admin.databaseBackups.restoreNotOwner')
                : t('admin.databaseBackups.restoreNotAvailable')}
            </p>
          )}

          {data.lastRun?.status === 'failed' && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {t('admin.databaseBackups.lastRunFailed', {
                date: new Date(data.lastRun.at).toLocaleString(i18n.language),
                message: data.lastRun.message,
              })}
            </p>
          )}

          {data.lastRestore && (
            <p
              role={data.lastRestore.status === 'failed' ? 'alert' : 'status'}
              className={
                data.lastRestore.status === 'failed'
                  ? 'text-sm text-[var(--color-danger)]'
                  : 'text-sm text-[var(--color-fg-muted)]'
              }
            >
              {data.lastRestore.status === 'ok'
                ? t('admin.databaseBackups.lastRestoreSucceeded', {
                    date: new Date(data.lastRestore.finishedAt).toLocaleString(i18n.language),
                    file: data.lastRestore.file,
                  })
                : t('admin.databaseBackups.lastRestoreFailed', {
                    date: new Date(data.lastRestore.finishedAt).toLocaleString(i18n.language),
                    file: data.lastRestore.file,
                    message: data.lastRestore.message,
                  })}
            </p>
          )}

          {data.directoryError && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {t('admin.databaseBackups.directoryError', { message: data.directoryError })}
            </p>
          )}

          {data.files.length > 0 && renderFileList(data.files)}

          {(canRestore || data.snapshots.length > 0) && (
            <div className="mt-2 border-t border-[var(--color-border)] pt-4">
              <h3 className="mb-1 text-sm font-semibold">
                {t('admin.databaseBackups.snapshotsTitle')}
              </h3>
              <p className="mb-3 text-sm text-[var(--color-fg-muted)]">
                {t('admin.databaseBackups.snapshotsDescription')}
              </p>
              {data.snapshots.length > 0 ? (
                renderFileList(data.snapshots)
              ) : (
                <p className="text-sm text-[var(--color-fg-muted)]">
                  {t('admin.databaseBackups.snapshotsEmpty')}
                </p>
              )}
            </div>
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

      {restoreTarget && (
        <RestoreDialog
          file={restoreTarget.file}
          createdAt={restoreTarget.createdAt}
          onClose={() => setRestoreTarget(undefined)}
          onRestoring={() => {
            setRestoreTarget(undefined)
            setRestoring(true)
          }}
        />
      )}
    </CollapsiblePanel>
  )
}
