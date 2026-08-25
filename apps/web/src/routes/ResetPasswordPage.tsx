import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useSearchParams } from 'react-router'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/auth-context.js'
import { Card } from '../components/ui/Card.js'
import { Field } from '../components/ui/Field.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { user, isLoading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />

  // No token in the URL at all — a link with a missing/stripped query
  // string, not one the API will bother rejecting for us. Same "invalid
  // link" copy either way, since there's nothing more specific to say.
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <p className="text-sm text-[var(--color-fg-muted)]">{t('resetPassword.invalidLink')}</p>
          <Link
            to="/forgot-password"
            className="mt-4 inline-block text-[var(--color-primary)] underline"
          >
            {t('resetPassword.requestNewLink')}
          </Link>
        </Card>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      await api.auth.resetPassword({ token: token!, password })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('resetPassword.title')}</h1>
        {submitted ? (
          <>
            <p className="text-sm text-[var(--color-fg-muted)]">{t('resetPassword.success')}</p>
            <Link to="/login" className="mt-4 inline-block text-[var(--color-primary)] underline">
              {t('resetPassword.loginLink')}
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field
              label={t('resetPassword.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              error={error}
            />
            <Button type="submit" isLoading={submitting}>
              {t('resetPassword.submit')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
