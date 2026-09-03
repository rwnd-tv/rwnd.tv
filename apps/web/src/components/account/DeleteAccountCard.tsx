import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { resetAuthCache } from '../../lib/reset-auth-cache.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/**
 * Bottom of AccountPage.tsx, deliberately last — James, 2026-08-25: the
 * other remaining hole in account management alongside change-email
 * (done). Red title/button plus a warning paragraph, not just the button,
 * per James's ask. Typing the account's own email address is a
 * deliberate extra step against an accidental click (same pattern as
 * GitHub's "type the repo name to confirm") — the current password field
 * next to it is what actually authorizes the delete, same "re-prove you
 * know it" reasoning as ChangePasswordCard.tsx/EmailCard.tsx.
 *
 * Every table referencing the user cascades on delete (plays, ratings,
 * watchlist, dropped shows, sessions, API tokens, Trakt connection,
 * import jobs, ...) — see the FK comment on `DELETE /auth/me` in
 * apps/api/src/routes/auth.ts. No confirmation-of-what-gets-deleted list
 * here (unlike DatabasePanel.tsx's Clear database, which shows per-
 * category counts) — this deletes everything, so there's nothing to
 * itemize.
 *
 * An admin *can* delete their own account here (used to be a blanket
 * block — James, 2026-08-25 — "a deliberately blunt first step while a
 * more considered answer gets thought through"; M4's admin
 * user-management work, docs/TODO_ARCHIVE.md, is that answer), provided
 * at least one other admin exists to keep administering the instance. The
 * owner specifically can never delete themselves here at all — they'd
 * have to transfer ownership first (TransferOwnershipCard.tsx, further
 * down this page), which demotes them to a plain admin, at which point
 * this card's ordinary last-admin-aware delete applies. There's no
 * client-side precheck for either case (it would mean an extra API call
 * just to render this card) — both surface as a normal inline error on
 * the password field below, same as a wrong password or a mismatched
 * email, since the server (`DELETE /auth/me`, apps/api/src/routes/auth.ts)
 * enforces both invariants either way.
 *
 * Collapsed by default like every other card on this page as of
 * 2026-09-02 — see AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component. The red title color
 * sits on the `<summary>` itself, not just the text, so the chevron
 * icon picks it up too via `currentColor` (`icons.tsx`'s shared `Icon`
 * wrapper) — deliberate, not an oversight, matching this card's danger
 * theme even collapsed.
 */
export function DeleteAccountCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAccountDelete')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string>()

  const deleteAccount = useMutation({
    mutationFn: () => api.auth.deleteAccount({ email, currentPassword }),
    onSuccess: async () => {
      // Same query-cache handling as LogoutButton.tsx — the account (and
      // its session) no longer exists server-side either way, so this is
      // really just tidying up the client before the redirect.
      await resetAuthCache(queryClient)
      void navigate('/login')
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleClose() {
    setConfirmOpen(false)
    setEmail('')
    setCurrentPassword('')
    setError(undefined)
    deleteAccount.reset()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    deleteAccount.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold text-[var(--color-danger)] [&::-webkit-details-marker]:hidden">
          {t('account.deleteTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('account.deleteWarning')}</p>
        <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
          {t('account.deleteButton')}
        </Button>

        <Dialog open={confirmOpen} onClose={handleClose} title={t('account.deleteConfirmTitle')}>
          <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
            {t('account.deleteConfirmBody', { email: user?.email })}
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field
              label={t('account.deleteConfirmEmail')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Field
              label={t('account.deleteConfirmPassword')}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              error={error}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="danger" isLoading={deleteAccount.isPending}>
                {t('account.deleteButton')}
              </Button>
            </div>
          </form>
        </Dialog>
      </details>
    </Card>
  )
}
