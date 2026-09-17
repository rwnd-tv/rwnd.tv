import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BackupSummary } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { CollapsiblePanel } from '../ui/CollapsiblePanel.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { Field } from '../ui/Field.js'
import { Spinner } from '../ui/Spinner.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

// Same path data as ActivityTile.tsx's KIND_ICONS (the History page's own
// per-kind markers) — kept as its own small copy rather than a shared
// import, matching this codebase's existing one-icon-per-file precedent
// (see e.g. the CheckIcon duplicated across MovieDetailPage.tsx and
// friends) for a icon this specific to one feature's own list.
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M12 2l2.9 6.6 7.1.6-5.4 4.8 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.8 7.1-.6L12 2Z" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  )
}

function DroppedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  )
}

type Category = 'watchHistory' | 'ratings' | 'watchlist' | 'droppedShows'

const CATEGORY_ICONS: Record<Category, () => React.JSX.Element> = {
  watchHistory: EyeIcon,
  ratings: StarIcon,
  watchlist: BookmarkIcon,
  droppedShows: DroppedIcon,
}

const EMPTY_SELECTION: Record<Category, boolean> = {
  watchHistory: false,
  ratings: false,
  watchlist: false,
  droppedShows: false,
}

/**
 * Bulk-delete the current user's own tracked data, and back up/restore it
 * to/from a file (apps/api/src/routes/backups.ts). Both scoped to the
 * signed-in user only — same tier as ProfileForm/WebhooksPanel in
 * SettingsPage.tsx, not gated behind `user?.role === 'admin'` the way
 * the Admin page's panels are (route-level, AdminRoute.tsx). Collapsed by
 * default like every other panel on this page except AboutPanel.tsx
 * (2026-09-02) — see
 * account/AdvancedPreferencesCard.tsx's doc comment for why `<details>`
 * over a bespoke show/hide component.
 */
export function DatabasePanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsDatabase')
  const [selected, setSelected] = useState(EMPTY_SELECTION)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data: publicSettings } = usePublicSettings()
  const [backupDescription, setBackupDescription] = useState('')
  const [createBackupOpen, setCreateBackupOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<BackupSummary>()
  const [deleteTarget, setDeleteTarget] = useState<BackupSummary>()
  const [diffTarget, setDiffTarget] = useState<BackupSummary>()

  // Row counts next to each checkbox — undefined (nothing shown yet)
  // until loaded. Covered by the mutation's full-cache invalidation
  // below, so a clear immediately refreshes these back down too.
  const { data: counts } = useQuery({
    queryKey: ['account', 'dataCounts'],
    queryFn: () => api.account.dataCounts(),
  })

  const categories: { key: Category; label: string }[] = [
    { key: 'watchHistory', label: t('settings.database.watchHistory') },
    { key: 'ratings', label: t('settings.database.ratings') },
    { key: 'watchlist', label: t('settings.database.watchlists') },
    { key: 'droppedShows', label: t('settings.database.droppedShows') },
  ]
  const anySelected = categories.some(({ key }) => selected[key])

  function countLabel(key: Category): string {
    const count = counts?.[key]
    return count === undefined ? '' : ` (${count})`
  }

  const clearData = useMutation({
    mutationFn: () => api.account.clearData(selected),
    onSuccess: () => {
      setConfirmOpen(false)
      setSelected(EMPTY_SELECTION)
      // Deliberately a full cache wipe rather than enumerating every
      // affected query key — this is a rare, user-initiated, sweeping
      // action, not a hot path worth optimising.
      void queryClient.invalidateQueries()
    },
  })

  // Backups section only renders once the instance actually has somewhere
  // to write one — see instanceSettingsSchema's backupsConfigured doc
  // comment (packages/shared/src/schemas/settings.ts).
  const backupsConfigured = publicSettings?.backupsConfigured ?? false

  const {
    data: backupsData,
    isLoading: backupsLoading,
    isError: backupsError,
  } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.backups.list(),
    enabled: backupsConfigured,
  })

  const createBackup = useMutation({
    mutationFn: () => api.backups.create({ description: backupDescription }),
    onSuccess: () => {
      setCreateBackupOpen(false)
      setBackupDescription('')
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
  })

  const restoreBackup = useMutation({
    mutationFn: (id: string) => api.backups.restore(id),
    onSuccess: () => {
      setRestoreTarget(undefined)
      // A restore rewrites the same four categories Clear database does —
      // same full cache wipe as that mutation above, same reasoning.
      void queryClient.invalidateQueries()
    },
  })

  const deleteBackup = useMutation({
    mutationFn: (id: string) => api.backups.delete(id),
    onSuccess: () => {
      setDeleteTarget(undefined)
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
  })

  // Fetched on demand, per backup, only while its diff dialog is open —
  // not upfront for the whole list, since it costs the API a full
  // rebuild-and-compare of the user's current data (see
  // apps/api/src/backup/diff.ts) rather than a cheap file read.
  const {
    data: diffData,
    isLoading: diffLoading,
    isError: diffError,
  } = useQuery({
    queryKey: ['backups', diffTarget?.id, 'diff'],
    queryFn: () => api.backups.diff(diffTarget!.id),
    enabled: Boolean(diffTarget),
  })

  return (
    <CollapsiblePanel title={t('settings.database.title')} open={open} onOpenChange={setOpen}>
      {backupsConfigured && (
        <div>
          <h3 className="mb-1 text-base font-semibold">{t('settings.database.backup.title')}</h3>
          <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
            {t('settings.database.backup.description')}
          </p>

          <div className="mb-4">
            <Button type="button" onClick={() => setCreateBackupOpen(true)}>
              {t('settings.database.backup.createButton')}
            </Button>
          </div>

          {backupsLoading ? (
            <Spinner label={t('common.loading')} />
          ) : backupsError ? (
            <p className="text-sm text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
          ) : backupsData && backupsData.backups.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('settings.database.backup.empty')}
            </p>
          ) : (
            <ul className="@container flex flex-col gap-2">
              {backupsData?.backups.map((backup) => (
                <li
                  key={backup.id}
                  className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{backup.description}</p>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      {new Date(backup.createdAt).toLocaleString(i18n.language)}
                    </p>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      {t('settings.database.backup.counts', backup.counts)}
                    </p>
                    {backup.skipped > 0 && (
                      <p className="text-sm text-[var(--color-fg-muted)]">
                        {t('settings.database.backup.skipped', { count: backup.skipped })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 @lg:shrink-0">
                    <Button type="button" variant="secondary" onClick={() => setDiffTarget(backup)}>
                      {t('settings.database.backup.diff')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRestoreTarget(backup)}
                    >
                      {t('settings.database.backup.restore')}
                    </Button>
                    <Button type="button" variant="danger" onClick={() => setDeleteTarget(backup)}>
                      {t('settings.database.backup.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={backupsConfigured ? 'mt-8 border-t border-[var(--color-border)] pt-6' : ''}>
        <h3 className="mb-1 text-base font-semibold">{t('settings.database.export.title')}</h3>
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.database.export.description')}{' '}
          <Link to="/import" className="underline hover:no-underline">
            {t('settings.database.export.importLink')}
          </Link>
        </p>
        {/* A plain download link, not a Button — no request/response to
            await, the browser just navigates and the server's
            Content-Disposition triggers a save. Styled to match Button's
            own primary-variant classes since there's no anchor variant of
            that component. */}
        <a
          href={api.account.exportUrl}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-fg)] transition-colors hover:opacity-90"
        >
          {t('settings.database.export.button')}
        </a>
      </div>

      <div className="mt-8 border-t border-[var(--color-border)] pt-6">
        <h3 className="mb-1 text-base font-semibold">{t('settings.database.clearTitle')}</h3>
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.database.description')}
        </p>

        <div className="flex flex-col gap-3">
          {categories.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected[key]}
                onChange={(e) => setSelected((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {label}
              <span className="text-[var(--color-fg-muted)]">{countLabel(key)}</span>
            </label>
          ))}
          <div>
            <Button
              type="button"
              variant="danger"
              disabled={!anySelected}
              onClick={() => setConfirmOpen(true)}
            >
              {t('settings.database.clearButton')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('settings.database.confirmTitle')}
      >
        {/* Only the categories actually checked — mirrors
            UnwatchConfirmDialog only listing the watches actually being
            removed, not a static list of everything that could be. */}
        <ul className="flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
          {categories
            .filter(({ key }) => selected[key])
            .map(({ key, label }) => (
              <li key={key}>
                {label}
                {countLabel(key)}
              </li>
            ))}
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={clearData.isPending}
            onClick={() => clearData.mutate()}
          >
            {t('settings.database.clearButton')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={createBackupOpen}
        onClose={() => setCreateBackupOpen(false)}
        title={t('settings.database.backup.createButton')}
      >
        <Field
          label={t('settings.database.backup.descriptionLabel')}
          value={backupDescription}
          onChange={(e) => setBackupDescription(e.target.value)}
          required
        />
        {createBackup.isError && (
          <p className="mt-2 text-sm text-[var(--color-danger)]">
            {t('common.somethingWentWrong')}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setCreateBackupOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={backupDescription.trim().length === 0}
            isLoading={createBackup.isPending}
            onClick={() => createBackup.mutate()}
          >
            {t('settings.database.backup.createButton')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(undefined)}
        title={t('settings.database.backup.confirmRestoreTitle')}
      >
        {restoreTarget && (
          <>
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('settings.database.backup.confirmRestoreBody', {
                description: restoreTarget.description,
                date: new Date(restoreTarget.createdAt).toLocaleString(i18n.language),
              })}
            </p>
            {restoreBackup.isError && (
              <p className="mt-2 text-sm text-[var(--color-danger)]">
                {t('common.somethingWentWrong')}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRestoreTarget(undefined)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={restoreBackup.isPending}
                onClick={() => restoreBackup.mutate(restoreTarget.id)}
              >
                {t('settings.database.backup.restore')}
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(undefined)}
        title={t('settings.database.backup.confirmDeleteTitle')}
      >
        {deleteTarget && (
          <>
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('settings.database.backup.confirmDeleteBody', {
                description: deleteTarget.description,
                date: new Date(deleteTarget.createdAt).toLocaleString(i18n.language),
              })}
            </p>
            {deleteBackup.isError && (
              <p className="mt-2 text-sm text-[var(--color-danger)]">
                {t('common.somethingWentWrong')}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteTarget(undefined)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={deleteBackup.isPending}
                onClick={() => deleteBackup.mutate(deleteTarget.id)}
              >
                {t('settings.database.backup.delete')}
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={Boolean(diffTarget)}
        onClose={() => setDiffTarget(undefined)}
        title={t('settings.database.backup.diffTitle', { description: diffTarget?.description })}
      >
        {diffLoading ? (
          <Spinner label={t('common.loading')} />
        ) : diffError ? (
          <p className="text-sm text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
        ) : diffData ? (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {categories.map(({ key, label }) => (
                <li key={key} className="flex items-center justify-between gap-4">
                  <span>{label}</span>
                  <span className="text-[var(--color-fg-muted)]">
                    {t('settings.database.backup.diffLine', {
                      added: diffData.diff[key].added,
                      removed: diffData.diff[key].removed,
                    })}
                  </span>
                </li>
              ))}
            </ul>

            {categories.some(
              ({ key }) => diffData.diff[key].added > 0 || diffData.diff[key].removed > 0,
            ) && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t('settings.database.backup.diffDetailsSummary')}
                </summary>
                <div className="mt-2 flex flex-col gap-3 text-sm text-[var(--color-fg-muted)]">
                  {categories.map(({ key, label }) => {
                    const { addedTitles, removedTitles } = diffData.diff[key]
                    if (addedTitles.length === 0 && removedTitles.length === 0) return null
                    const Icon = CATEGORY_ICONS[key]
                    return (
                      <div key={key}>
                        <p className="font-medium text-[var(--color-fg)]">{label}</p>
                        {addedTitles.length > 0 && (
                          <div className="mt-1">
                            <p className="text-xs uppercase">
                              {t('settings.database.backup.diffAdded')}
                            </p>
                            <ul className="flex flex-col gap-1">
                              {addedTitles.map((title, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <Icon />
                                  <span>{title}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {removedTitles.length > 0 && (
                          <div className="mt-1">
                            <p className="text-xs uppercase">
                              {t('settings.database.backup.diffRemoved')}
                            </p>
                            <ul className="flex flex-col gap-1">
                              {removedTitles.map((title, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <Icon />
                                  <span>{title}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </>
        ) : null}

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setDiffTarget(undefined)}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    </CollapsiblePanel>
  )
}
