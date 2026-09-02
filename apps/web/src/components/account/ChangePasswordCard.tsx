import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/**
 * Only way to set a new password for a local account until now was
 * "Forgot password?" (ForgotPasswordPage.tsx/ResetPasswordPage.tsx) —
 * found missing while testing that flow live: someone who already knows
 * their current password shouldn't have to go through an email round
 * trip just to change it. Same `POST /auth/me/password` route keeps the
 * session making this request alive (`revokeOtherSessions`, not the
 * reset flow's `revokeAllSessions`) since the user just proved they know
 * both passwords, unlike a reset where nobody's logged in yet.
 *
 * Title reads "Password", not "Change password" (James, 2026-09-02) —
 * this card *is* the account's password section; the action inside it
 * is already labelled "Change password" on its own submit button.
 * Collapsed by default like every other card on this page as of the
 * same day — see AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component.
 */
export function ChangePasswordCard() {
  const { t } = useTranslation()
  const [open, setOpen] = usePanelOpen('panelAccountPassword')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string>()

  const changePassword = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    changePassword.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('account.passwordTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t('account.changePasswordCurrent')}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            error={error}
          />
          <Field
            label={t('account.changePasswordNew')}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" isLoading={changePassword.isPending}>
              {t('account.changePasswordSubmit')}
            </Button>
            {changePassword.isSuccess && (
              <span className="text-sm text-[var(--color-fg-muted)]">
                {t('account.changePasswordSuccess')}
              </span>
            )}
          </div>
        </form>
      </details>
    </Card>
  )
}
