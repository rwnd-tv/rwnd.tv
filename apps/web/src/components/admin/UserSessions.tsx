import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

/**
 * A user's active sessions, filling the Sessions panel on
 * AdminUserPage.tsx (originally their expanded row on UsersPanel.tsx,
 * before that list became summary-only). Near-identical markup to
 * apps/web/src/components/account/SessionsCard.tsx (that component's own
 * list, just pointed at someone else's account instead of the caller's)
 * — deliberately not factored into one shared component, since the two
 * fetch different endpoints and the account-page version's "This device"
 * badge only ever makes sense for the caller's own list.
 */
export function UserSessions({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'sessions'],
    queryFn: () => api.admin.listUserSessions(userId),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'sessions'] })
    // sessionCount on the row/list changed too.
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => api.admin.revokeUserSession(userId, sessionId),
    onSuccess: invalidate,
  })
  const revokeAll = useMutation({
    mutationFn: () => api.admin.revokeAllUserSessions(userId),
    onSuccess: invalidate,
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  const sessions = data?.sessions ?? []
  if (sessions.length === 0) {
    return <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.sessionsEmpty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {/* No heading of its own: the Sessions panel this renders inside
          (AdminUserPage.tsx) already carries that title, and having both
          read "Sessions" one above the other was just noise (James,
          2026-09-03). "Revoke all" keeps the row, right-aligned where it
          already sat. */}
      {sessions.length > 1 && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => revokeAll.mutate()}
            isLoading={revokeAll.isPending}
          >
            {t('admin.sessionsRevokeAll')}
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.id} className="rounded-md border border-[var(--color-border)] p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 truncate font-medium">
                    {session.userAgent ?? t('admin.sessionsUnknownDevice')}
                  </p>
                  {session.current && (
                    <span className="shrink-0 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-xs font-normal text-[var(--color-fg-muted)]">
                      {t('account.sessionsThisDevice')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-fg-muted)]">
                  {session.ipAddress ? `${session.ipAddress} — ` : ''}
                  {session.lastUsedAt
                    ? t('admin.sessionsLastUsed', {
                        date: new Date(session.lastUsedAt).toLocaleString(i18n.language),
                      })
                    : t('admin.sessionsNeverUsed')}
                </p>
                <p className="text-xs text-[var(--color-fg-muted)]">
                  {t('admin.sessionsCreated', {
                    date: new Date(session.createdAt).toLocaleString(i18n.language),
                  })}
                </p>
              </div>
              {!session.current && (
                <Button
                  variant="danger"
                  onClick={() => revokeSession.mutate(session.id)}
                  aria-label={`${t('admin.sessionsRevoke')}: ${session.userAgent ?? t('admin.sessionsUnknownDevice')}`}
                >
                  {t('admin.sessionsRevoke')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
