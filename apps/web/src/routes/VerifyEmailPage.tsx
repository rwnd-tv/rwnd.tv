import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { Card } from '../components/ui/Card.js'
import { Spinner } from '../components/ui/Spinner.js'

/**
 * `POST /auth/verify-email` is a mutation (the token is single-use, deleted
 * on redemption), but this fires it via `useQuery` on mount rather than an
 * imperative `useMutation` call in an effect — React Query dedupes an
 * identical in-flight query across a StrictMode double-mount, so the
 * verify call only ever actually reaches the server once. An equivalent
 * `useEffect` + `useMutation` would send it twice in dev, and the second
 * attempt would come back "invalid" since the first already consumed the
 * token.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const queryClient = useQueryClient()

  const { isLoading, isError, error } = useQuery({
    queryKey: ['auth', 'verify-email', token],
    queryFn: async () => {
      await api.auth.verifyEmail({ token: token! })
      // No-op if not currently logged in as the verified account (or not
      // logged in at all) — invalidating a query nobody's subscribed to
      // is harmless. Refreshes AccountPage's verified/unverified status
      // immediately when it does apply.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      return true
    },
    enabled: Boolean(token),
    retry: false,
  })

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-6 text-xl font-semibold">{t('verifyEmail.title')}</h1>
        {!token ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('verifyEmail.invalidLink')}</p>
        ) : isLoading ? (
          <Spinner label={t('verifyEmail.verifying')} />
        ) : isError ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {error instanceof ApiError ? error.message : t('verifyEmail.invalidLink')}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('verifyEmail.success')}</p>
        )}
        <Link to="/dashboard" className="mt-4 inline-block text-[var(--color-primary)] underline">
          {t('verifyEmail.continue')}
        </Link>
      </Card>
    </div>
  )
}
