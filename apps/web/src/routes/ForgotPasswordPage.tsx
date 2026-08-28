import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/use-auth.js'
import { Card } from '../components/ui/Card.js'
import { Field } from '../components/ui/Field.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

/**
 * `POST /auth/forgot-password` always responds 204 regardless of whether
 * the email matched an account (anti-enumeration — see that route's own
 * doc comment), so this page shows the same success message every time
 * rather than branching on the response.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { user, isLoading: authLoading } = useAuth()

  const [email, setEmail] = useState('')
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      await api.auth.forgotPassword({ email })
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
        <h1 className="mb-6 text-xl font-semibold">{t('forgotPassword.title')}</h1>
        {submitted ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('forgotPassword.success')}</p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <Field
              label={t('forgotPassword.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              error={error}
            />
            <Button type="submit" isLoading={submitting}>
              {t('forgotPassword.submit')}
            </Button>
          </form>
        )}
        <p className="mt-4 text-sm text-[var(--color-fg-muted)]">
          <Link to="/login" className="text-[var(--color-primary)] underline">
            {t('forgotPassword.loginLink')}
          </Link>
        </p>
      </Card>
    </div>
  )
}
