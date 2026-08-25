import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useSetupStatus } from '../lib/use-setup-status.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { useAuth } from '../lib/auth-context.js'
import { Card } from '../components/ui/Card.js'
import { Field } from '../components/ui/Field.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isLoading: authLoading } = useAuth()
  const { data: setupStatus, isLoading: setupLoading } = useSetupStatus()
  const { data: settings } = usePublicSettings()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  if (setupLoading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  if (setupStatus?.required) return <Navigate to="/setup" replace />
  if (user) return <Navigate to="/dashboard" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      await api.auth.login({ email, password })
      // See Sidebar.tsx's handleLogout for why this is removeQueries on
      // everything else + a plain invalidate on auth/me, not clear().
      // Covers reaching /login without going through the logout button
      // too (e.g. a session that expired server-side).
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' })
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('login.title')}</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t('login.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Field
            label={t('login.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            error={error}
          />
          {settings?.emailConfigured && (
            <Link
              to="/forgot-password"
              className="self-start text-sm text-[var(--color-primary)] underline"
            >
              {t('login.forgotPasswordLink')}
            </Link>
          )}
          <Button type="submit" isLoading={submitting}>
            {t('login.submit')}
          </Button>
        </form>
        {settings && settings.registrationMode !== 'closed' && settings.emailConfigured && (
          <p className="mt-4 text-sm text-[var(--color-fg-muted)]">
            {t('login.registerPrompt')}{' '}
            <Link to="/register" className="text-[var(--color-primary)] underline">
              {t('login.registerLink')}
            </Link>
          </p>
        )}
      </Card>
    </div>
  )
}
