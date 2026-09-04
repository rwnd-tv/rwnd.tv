import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AdminUserSummary } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { runBulkAction, type BulkResult } from '../../lib/bulk-action.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'

type ConfirmAction = 'delete' | 'promote' | 'demote'
type BulkActionKind = ConfirmAction | 'revokeSessions' | 'passwordReset'

const MAX_NAMES_LISTED = 10

/** `<li>` items only, same "caller supplies the `<ul>`" split as
 * ImportProgress.tsx's own `FailureItems` — this one has no other
 * consumer, so it stays local rather than becoming a shared export. */
function FailureItems({ failures }: { failures: BulkResult<AdminUserSummary>['failures'] }) {
  return (
    <>
      {failures.map((failure) => (
        <li key={failure.id}>
          <span className="font-medium text-[var(--color-fg)]">{failure.label}</span>
          {' — '}
          <span>{failure.reason}</span>
        </li>
      ))}
    </>
  )
}

function AffectedNames({ users }: { users: AdminUserSummary[] }) {
  const { t } = useTranslation()
  const shown = users.slice(0, MAX_NAMES_LISTED)
  const remaining = users.length - shown.length
  return (
    <ul className="mb-4 max-h-40 list-disc overflow-y-auto pl-5 text-sm text-[var(--color-fg-muted)]">
      {shown.map((u) => (
        <li key={u.id}>{u.displayName}</li>
      ))}
      {remaining > 0 && <li>{t('admin.bulk.affectedMore', { count: remaining })}</li>}
    </ul>
  )
}

/**
 * The action bar + confirm dialog + partial-failure report for bulk
 * select/actions on the admin Users list (M4, docs/TODO_ARCHIVE.md).
 * UsersPanel.tsx owns *what is ticked* (selection state, self-exclusion,
 * select-all); this owns *what happens to it* — split out because this
 * file alone needs 5 mutations, a confirm dialog and a report, and inlining
 * that into UsersPanel.tsx would double its size and bury the filter/sort
 * logic that file exists for (the same reason DeleteUserDialog.tsx already
 * owns its own mutation rather than AdminUserPage.tsx doing it inline).
 *
 * A client-side loop (`runBulkAction`, bulk-action.ts) over the existing
 * single-item admin routes, not a new bulk API route — the TODO this
 * closes explicitly sanctions that for a first pass, and those single-item
 * routes already carry every per-user refusal (owner immunity, last-admin,
 * no local credential) a batch needs to report individually.
 *
 * Rendered unconditionally by UsersPanel.tsx: the bar shows only once
 * something is selected, but the report has its own, separate lifetime —
 * copying HistoryPage.tsx's `{selectedKeys.size > 0 && <bar/>}` wrapper
 * around both would make a fully-successful report flash and disappear the
 * instant a successful action clears the selection.
 */
export function UserBulkActions({
  selectedUsers,
  hiddenSelectedCount,
  onSelectionSettled,
  onClearSelection,
  onBusyChange,
}: {
  selectedUsers: AdminUserSummary[]
  hiddenSelectedCount: number
  /** Called after any bulk action settles, with the ids that should stay
   * selected — refusals stay ticked (so they're readable against their row
   * and easy to retry), successes drop out. Deliberately unlike
   * HistoryPage.tsx's unconditional clear-on-success: a partial failure is
   * the case this whole feature exists for. */
  onSelectionSettled: (remainingIds: string[]) => void
  onClearSelection: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: publicSettings } = usePublicSettings()
  const emailConfigured = publicSettings?.emailConfigured ?? false

  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [report, setReport] = useState<{
    action: BulkActionKind
    total: number
    result: BulkResult<AdminUserSummary>
  } | null>(null)

  function finish(
    action: BulkActionKind,
    result: BulkResult<AdminUserSummary>,
    targets: AdminUserSummary[],
  ) {
    // One invalidate covers everything: TanStack Query matches by prefix, so
    // this also invalidates every ['admin','users',id] detail query and
    // ['admin','users',id,'sessions'] query — refreshing sessionCount and
    // role badges after a bulk revoke/role-change in one call. No
    // ['auth','me'] invalidation is needed here, unlike AdminUserPage.tsx's
    // own role-change mutation: self is excluded from selection entirely
    // (UsersPanel.tsx), so no bulk action can ever touch the acting admin's
    // own role or sessions. That's the first thing to revisit if
    // self-exclusion is ever relaxed.
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    setReport({ action, total: targets.length, result })
    setPendingAction(null)
    onSelectionSettled(result.failures.map((f) => f.id))
  }

  const deleteUsers = useMutation({
    mutationFn: (targets: AdminUserSummary[]) =>
      runBulkAction(
        targets,
        (u) => api.admin.deleteUser(u.id),
        (u) => u.displayName,
        t('common.somethingWentWrong'),
      ),
    onSuccess: (result, targets) => finish('delete', result, targets),
  })

  const promoteUsers = useMutation({
    mutationFn: (targets: AdminUserSummary[]) =>
      runBulkAction(
        targets,
        (u) => api.admin.updateUserRole(u.id, 'admin'),
        (u) => u.displayName,
        t('common.somethingWentWrong'),
      ),
    onSuccess: (result, targets) => finish('promote', result, targets),
  })

  const demoteUsers = useMutation({
    mutationFn: (targets: AdminUserSummary[]) =>
      runBulkAction(
        targets,
        (u) => api.admin.updateUserRole(u.id, 'user'),
        (u) => u.displayName,
        t('common.somethingWentWrong'),
      ),
    onSuccess: (result, targets) => finish('demote', result, targets),
  })

  const revokeSessions = useMutation({
    mutationFn: (targets: AdminUserSummary[]) =>
      runBulkAction(
        targets,
        (u) => api.admin.revokeAllUserSessions(u.id),
        (u) => u.displayName,
        t('common.somethingWentWrong'),
      ),
    onSuccess: (result, targets) => finish('revokeSessions', result, targets),
  })

  const sendPasswordResets = useMutation({
    mutationFn: (targets: AdminUserSummary[]) =>
      runBulkAction(
        targets,
        (u) => api.admin.sendPasswordReset(u.id),
        (u) => u.displayName,
        t('common.somethingWentWrong'),
      ),
    onSuccess: (result, targets) => finish('passwordReset', result, targets),
  })

  const isBusy =
    deleteUsers.isPending ||
    promoteUsers.isPending ||
    demoteUsers.isPending ||
    revokeSessions.isPending ||
    sendPasswordResets.isPending

  // onBusyChange is UsersPanel.tsx's setIsBulkBusy (a setState function, so
  // stable across renders) — freezing every row checkbox and select-all
  // while a batch runs, which is also what stops two bulk actions racing:
  // every trigger below is disabled={isBusy}, so a second click while one
  // is in flight lands on a disabled button rather than starting a second
  // overlapping Promise.allSettled loop.
  useEffect(() => onBusyChange(isBusy), [isBusy, onBusyChange])

  const confirmMutation =
    pendingAction === 'delete'
      ? deleteUsers
      : pendingAction === 'promote'
        ? promoteUsers
        : demoteUsers

  if (selectedUsers.length === 0 && !report) return null

  return (
    <div className="flex flex-col gap-3">
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] p-3">
          <span className="text-sm">{t('admin.bulk.count', { count: selectedUsers.length })}</span>
          {hiddenSelectedCount > 0 && (
            <span className="text-sm text-[var(--color-fg-muted)]">
              {t('admin.bulk.hidden', { count: hiddenSelectedCount })}
            </span>
          )}
          {emailConfigured ? (
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              isLoading={sendPasswordResets.isPending}
              onClick={() => sendPasswordResets.mutate(selectedUsers)}
            >
              {t('admin.bulk.sendPasswordReset')}
            </Button>
          ) : (
            <span
              className="text-sm text-[var(--color-fg-muted)]"
              title={t('admin.passwordResetUnavailable')}
            >
              {t('admin.bulk.passwordResetUnavailableShort')}
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            isLoading={revokeSessions.isPending}
            onClick={() => revokeSessions.mutate(selectedUsers)}
          >
            {t('admin.bulk.revokeSessions')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => setPendingAction('promote')}
          >
            {t('admin.bulk.promote')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isBusy}
            onClick={() => setPendingAction('demote')}
          >
            {t('admin.bulk.demote')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isBusy}
            onClick={() => setPendingAction('delete')}
          >
            {t('admin.bulk.delete')}
          </Button>
          <Button type="button" variant="ghost" disabled={isBusy} onClick={onClearSelection}>
            {t('admin.bulk.clear')}
          </Button>
        </div>
      )}

      {report && (
        <div role="status" className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
          <p>
            {t(`admin.bulk.result.${report.action}`, {
              succeeded: report.result.succeeded.length,
              count: report.total,
            })}
          </p>
          {report.result.failures.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">
                {t('admin.bulk.refusedSummary', { count: report.result.failures.length })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-[var(--color-fg-muted)]">
                <FailureItems failures={report.result.failures} />
              </ul>
            </details>
          )}
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setReport(null)}>
            {t('common.close')}
          </Button>
        </div>
      )}

      <Dialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title={
          pendingAction === 'delete'
            ? t('admin.bulk.deleteConfirmTitle', { count: selectedUsers.length })
            : pendingAction === 'promote'
              ? t('admin.bulk.promoteConfirmTitle', { count: selectedUsers.length })
              : t('admin.bulk.demoteConfirmTitle', { count: selectedUsers.length })
        }
      >
        <p className="mb-2 text-sm text-[var(--color-fg-muted)]">
          {pendingAction === 'delete'
            ? t('admin.bulk.deleteConfirmBody')
            : pendingAction === 'promote'
              ? t('admin.bulk.promoteConfirmBody')
              : t('admin.bulk.demoteConfirmBody')}
        </p>
        <AffectedNames users={selectedUsers} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPendingAction(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={pendingAction === 'promote' ? 'primary' : 'danger'}
            isLoading={confirmMutation.isPending}
            onClick={() => pendingAction && confirmMutation.mutate(selectedUsers)}
          >
            {pendingAction === 'delete'
              ? t('admin.bulk.confirmDelete')
              : pendingAction === 'promote'
                ? t('admin.bulk.confirmPromote')
                : t('admin.bulk.confirmDemote')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
