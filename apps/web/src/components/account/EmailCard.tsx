import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

/**
 * The verified/unverified badge only shows once the address has ever had a
 * chance to be verified — a pre-2026-08-25 account is always
 * `emailVerifiedAt`-set (backfilled by migration 0017), and a fresh
 * registration only gets a badge at all once this instance actually has
 * email configured to check it against.
 *
 * Changing the address (2026-08-25) needs SMTP for the same reason
 * registering/resending does — the new address has to be confirmable —
 * so the whole "Change email" affordance is gated on `emailConfigured`
 * too, not just shown-then-broken. The account's email only actually
 * changes once that confirmation link is clicked
 * (`POST /auth/confirm-email-change`, ConfirmEmailChangePage.tsx) — this
 * form just kicks that off, current password required first (same
 * "re-prove you know the password before a sensitive account change"
 * reasoning as ChangePasswordCard.tsx).
 *
 * Sits at the top of AccountPage.tsx with no section heading of its own —
 * "Account" is the page's own title, not a separate section (James,
 * 2026-08-25).
 */
export function EmailCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: settings } = usePublicSettings()

  const resendVerification = useMutation({
    mutationFn: () => api.auth.resendVerification(),
  })

  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string>()

  const changeEmail = useMutation({
    mutationFn: () => api.auth.changeEmail({ newEmail, currentPassword }),
    onSuccess: () => setCurrentPassword(''),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    changeEmail.mutate()
  }

  function handleToggle() {
    setShowChangeEmail((current) => !current)
    setError(undefined)
    changeEmail.reset()
    setNewEmail('')
    setCurrentPassword('')
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('account.email')}</h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{user?.email}</span>
        {user?.emailVerifiedAt ? (
          <span className="text-xs text-[var(--color-success)]">{t('account.emailVerified')}</span>
        ) : (
          settings?.emailConfigured && (
            <>
              <span className="text-xs text-[var(--color-danger)]">
                {t('account.emailUnverified')}
              </span>
              <Button
                type="button"
                variant="ghost"
                isLoading={resendVerification.isPending}
                onClick={() => resendVerification.mutate()}
              >
                {t('account.resendVerification')}
              </Button>
              {resendVerification.isSuccess && (
                <span className="text-xs text-[var(--color-fg-muted)]">
                  {t('account.resendVerificationSent')}
                </span>
              )}
            </>
          )
        )}
      </div>

      {settings?.emailConfigured && (
        <div className="mt-4">
          <Button type="button" onClick={handleToggle}>
            {t('account.changeEmailButton')}
          </Button>

          {showChangeEmail &&
            (changeEmail.isSuccess ? (
              <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
                {t('account.changeEmailSuccess', { email: newEmail })}
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                <Field
                  label={t('account.changeEmailNew')}
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <Field
                  label={t('account.changeEmailPassword')}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  error={error}
                />
                <div className="flex items-center gap-3">
                  <Button type="submit" isLoading={changeEmail.isPending}>
                    {t('account.changeEmailSubmit')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleToggle}>
                    {t('account.changeEmailCancel')}
                  </Button>
                </div>
              </form>
            ))}
        </div>
      )}
    </Card>
  )
}
