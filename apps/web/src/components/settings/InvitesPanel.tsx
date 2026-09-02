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
 * let an admin actually create a code. Self-gates on the instance's
 * current registration mode, same shape as DatabasePanel.tsx self-gating
 * on `backupsConfigured`, except this hides the whole card rather than
 * just a section of it — there's nothing else useful to show here
 * otherwise. Collapsed by default like every other panel on this page
 * except AboutPanel.tsx (2026-09-02) — see
 * account/AdvancedPreferencesCard.tsx's doc comment for why `<details>`
 * over a bespoke show/hide component.
 */
export function InvitesPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsInvites')
  const { data: publicSettings } = usePublicSettings()
  const [justCreated, setJustCreated] = useState<string>()
  const [justCreatedEmailSent, setJustCreatedEmailSent] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.invites.list(),
    enabled: publicSettings?.registrationMode === 'invite',
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

  if (publicSettings?.registrationMode !== 'invite') return null

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.invites.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.invites.description')}
        </p>

        {justCreated && (
          <div
            role="status"
            className="mb-4 rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-3"
          >
            <p className="mb-1 text-sm">{t('settings.invites.createdOnce')}</p>
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
                {copied ? t('settings.invites.copied') : t('settings.invites.copy')}
              </Button>
            </div>
            {justCreatedEmailSent && (
              <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
                {t('settings.invites.emailed', { email: inviteEmail })}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleCreate} className="mb-6 flex flex-wrap items-end gap-2">
          {publicSettings?.emailConfigured && (
            <Field
              label={t('settings.invites.email')}
              hideLabel
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('settings.invites.email')}
              className="flex-1"
            />
          )}
          <Button type="submit" isLoading={createInvite.isPending}>
            {t('settings.invites.create')}
          </Button>
        </form>

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : data?.invites.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('settings.invites.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.invites.map((invite) => (
              <li key={invite.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {t(`settings.invites.${STATUS_KEY[invite.status]}`)}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      {t('settings.invites.created', {
                        date: new Date(invite.createdAt).toLocaleString(i18n.language),
                      })}
                      {' — '}
                      {t('settings.invites.expires', {
                        date: new Date(invite.expiresAt).toLocaleString(i18n.language),
                      })}
                    </p>
                  </div>
                  {invite.status === 'pending' && (
                    <Button variant="danger" onClick={() => revokeInvite.mutate(invite.id)}>
                      {t('settings.invites.revoke')}
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
