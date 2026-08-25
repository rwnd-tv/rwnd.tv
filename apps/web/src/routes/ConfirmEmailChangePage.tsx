import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { Card } from '../components/ui/Card.js'
import { Spinner } from '../components/ui/Spinner.js'

/**
 * Same `useQuery`-on-mount shape as VerifyEmailPage.tsx, for the same
 * StrictMode-double-mount reason — see that page's doc comment. This one
 * actually changes `users.email` on redemption (EmailCard.tsx's "Change
 * email" form only ever kicked off the request), so a successful visit
 * here is the moment the account's address really updates.
 */
export function ConfirmEmailChangePage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const queryClient = useQueryClient()

  const { isLoading, isError, error } = useQuery({
    queryKey: ['auth', 'confirm-email-change', token],
    queryFn: async () => {
      await api.auth.confirmEmailChange({ token: token! })
      // Same reasoning as VerifyEmailPage.tsx — no-op if not currently
      // logged in as the account whose email just changed.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      return true
    },
    enabled: Boolean(token),
    retry: false,
  })

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-6 text-xl font-semibold">{t('confirmEmailChange.title')}</h1>
        {!token ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t('confirmEmailChange.invalidLink')}
          </p>
        ) : isLoading ? (
          <Spinner label={t('confirmEmailChange.verifying')} />
        ) : isError ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {error instanceof ApiError ? error.message : t('confirmEmailChange.invalidLink')}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('confirmEmailChange.success')}</p>
        )}
        <Link to="/dashboard" className="mt-4 inline-block text-[var(--color-primary)] underline">
          {t('confirmEmailChange.continue')}
        </Link>
      </Card>
    </div>
  )
}
