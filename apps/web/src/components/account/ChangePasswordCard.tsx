import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

/**
 * Only way to set a new password for a local account until now was
 * "Forgot password?" (ForgotPasswordPage.tsx/ResetPasswordPage.tsx) —
 * found missing while testing that flow live: someone who already knows
 * their current password shouldn't have to go through an email round
 * trip just to change it. Same `POST /auth/me/password` route keeps the
 * session making this request alive (`revokeOtherSessions`, not the
 * reset flow's `revokeAllSessions`) since the user just proved they know
 * both passwords, unlike a reset where nobody's logged in yet.
 */
export function ChangePasswordCard() {
  const { t } = useTranslation()
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
      <h2 className="text-lg font-semibold">{t('account.changePasswordTitle')}</h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
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
    </Card>
  )
}
