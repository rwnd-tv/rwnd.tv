import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InviteStatus } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'
import { Field } from '../ui/Field.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

const STATUS_KEY: Record<InviteStatus, 'statusPending' | 'statusUsed' | 'statusExpired'> = {
  pending: 'statusPending',
  used: 'statusUsed',
  expired: 'statusExpired',
}

/**
 * `registration_mode: 'invite'` was functionally unreachable before this
 * (F-22, M3 security review follow-up, docs/TODO.md) — nothing anywhere
 * let an admin actually create a code. Moved here from the Settings page
 * 2026-09-11 (docs/TODO_ARCHIVE.md); the card always renders now rather
 * than hiding itself entirely outside invite-only mode, because the
 * control that unlocks invite mode (Instance settings) lives on this same
 * page — hiding the panel below the very control that enables it would be
 * confusing, not tidy. When not invite-only it explains why inline instead
 * (`notInviteOnly`), same "stay visible and explain" convention as
 * DatabaseBackupsPanel.tsx when DATABASE_BACKUP_DIR isn't set. The invites
 * list query itself still stays disabled outside invite-only mode — no
 * reason to hit an admin-only endpoint on every Admin page load otherwise.
 * Collapsed by default — UsersPanel.tsx is the one panel on this page
 * expanded by default, not this one. See
 * account/AdvancedPreferencesCard.tsx's doc comment for why `<details>`
 * over a bespoke show/hide component.
 */
export function InvitesPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAdminInvites')
  const { data: publicSettings } = usePublicSettings()
  const [justCreated, setJustCreated] = useState<string>()
  const [justCreatedEmailSent, setJustCreatedEmailSent] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [copied, setCopied] = useState(false)

  const inviteOnly = publicSettings?.registrationMode === 'invite'

  const { data, isLoading } = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.invites.list(),
    enabled: inviteOnly,
  })

  const createInvite = useMutation({
    mutationFn: () => api.invites.create(inviteEmail ? { email: inviteEmail } : {}),
    onSuccess: (created) => {
      setJustCreated(created.code)
      setJustCreatedEmailSent(created.emailSent)
      setCopied(false)
      void queryClient.invalidateQueries({ queryKey: ['invites'] })
    },
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    createInvite.mutate()
  }

  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.invites.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  })

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('admin.invites.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        {!inviteOnly ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.invites.notInviteOnly')}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
              {t('admin.invites.description')}
            </p>

            {justCreated && (
              <div
                role="status"
                className="mb-4 rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-3"
              >
                <p className="mb-1 text-sm">{t('admin.invites.createdOnce')}</p>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-sm">
                    {justCreated}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(justCreated)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied ? t('admin.invites.copied') : t('admin.invites.copy')}
                  </Button>
                </div>
                {justCreatedEmailSent && (
                  <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
                    {t('admin.invites.emailed', { email: inviteEmail })}
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-end gap-2">
              {publicSettings?.emailConfigured && (
                <Field
                  label={t('admin.invites.email')}
                  hideLabel
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('admin.invites.email')}
                  className="flex-1"
                />
              )}
              <Button type="submit" isLoading={createInvite.isPending}>
                {t('admin.invites.create')}
              </Button>
            </form>

            {isLoading ? (
              <Spinner label={t('common.loading')} />
            ) : data?.invites.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.invites.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data?.invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="rounded-md border border-[var(--color-border)] p-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {t(`admin.invites.${STATUS_KEY[invite.status]}`)}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--color-fg-muted)]">
                          {t('admin.invites.created', {
                            date: new Date(invite.createdAt).toLocaleString(i18n.language),
                          })}
                          {' — '}
                          {t('admin.invites.expires', {
                            date: new Date(invite.expiresAt).toLocaleString(i18n.language),
                          })}
                        </p>
                      </div>
                      {invite.status === 'pending' && (
                        <Button variant="danger" onClick={() => revokeInvite.mutate(invite.id)}>
                          {t('admin.invites.revoke')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </details>
    </Card>
  )
}
