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
 * Admin accounts can't delete themselves (James, 2026-08-25 — a
 * deliberately blunt first step while a more considered answer, e.g.
 * requiring another admin promoted first once that route exists, gets
 * thought through). Button disabled rather than the whole card hidden,
 * with an explanatory note — same "still visible, just not usable, with
 * a stated reason" shape as Clear database's own disabled state
 * (DatabasePanel.tsx, disabled until a category's checked) rather than a
 * silently vanished section. The server enforces this independently
 * either way (`DELETE /auth/me` 403s an admin regardless of what the
 * client sends) — this is only ever a UX convenience, never the real gate.
 */
export function DeleteAccountCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

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
      <h2 className="text-lg font-semibold text-[var(--color-danger)]">
        {t('account.deleteTitle')}
      </h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('account.deleteWarning')}</p>
      <Button
        type="button"
        variant="danger"
        disabled={isAdmin}
        onClick={() => setConfirmOpen(true)}
      >
        {t('account.deleteButton')}
      </Button>
      {isAdmin && (
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
          {t('account.deleteAdminBlocked')}
        </p>
      )}

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
    </Card>
  )
}
