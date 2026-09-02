import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/**
 * M3 security review follow-up (F-24, ASVS V3.3.2) — there was previously
 * no way to see or revoke another active session short of "log out
 * everywhere" (which the password-reset flow does implicitly). The API
 * itself allows revoking the *current* session too (no special-casing —
 * see routes/auth.ts's doc comment), but the UI deliberately doesn't offer
 * that here: LogoutButton on this same page already covers "end my current
 * session" with clearer wording, so this list only offers Revoke on the
 * other rows.
 *
 * Collapsed by default like every other card on this page as of
 * 2026-09-02 — see AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component. The session list still
 * fetches eagerly on mount either way, collapsed or not — this is a
 * cheap query, and gating it behind `open` would mean waiting on a
 * request the moment someone expands the card instead of it already
 * being ready.
 */
export function SessionsCard() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAccountSessions')

  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.auth.listSessions(),
  })

  const revokeSession = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('account.sessionsTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('account.sessionsDescription')}
        </p>

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.sessions.map((session) => (
              <li key={session.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 truncate font-medium">
                        {session.userAgent ?? t('account.sessionsUnknownDevice')}
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
                        ? t('account.sessionsLastUsed', {
                            date: new Date(session.lastUsedAt).toLocaleString(i18n.language),
                          })
                        : t('account.sessionsNeverUsed')}
                    </p>
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      {t('account.sessionsCreated', {
                        date: new Date(session.createdAt).toLocaleString(i18n.language),
                      })}
                    </p>
                  </div>
                  {!session.current && (
                    <Button
                      variant="danger"
                      onClick={() => revokeSession.mutate(session.id)}
                      aria-label={`${t('account.sessionsRevoke')}: ${session.userAgent ?? t('account.sessionsUnknownDevice')}`}
                    >
                      {t('account.sessionsRevoke')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  )
}
