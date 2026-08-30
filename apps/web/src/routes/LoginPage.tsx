import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useSetupStatus } from '../lib/use-setup-status.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { useAuth } from '../lib/use-auth.js'
import { resetAuthCache } from '../lib/reset-auth-cache.js'
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
  // Set once POST /auth/login reports mfaRequired — switches the form to
  // the second step (a code, not email/password again) rather than
  // routing to a separate page, since the two steps share this same
  // "logging in" moment.
  const [challengeToken, setChallengeToken] = useState<string>()
  const [code, setCode] = useState('')

  async function onLoggedIn() {
    // See LogoutButton.tsx's handleLogout for why this is removeQueries on
    // everything else + a plain invalidate on auth/me, not clear().
    // Covers reaching /login without going through the logout button
    // too (e.g. a session that expired server-side).
    await resetAuthCache(queryClient)
    void navigate('/dashboard')
  }

  const login = useMutation({
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: async (result) => {
      if ('mfaRequired' in result) {
        setChallengeToken(result.challengeToken)
        setError(undefined)
        return
      }
      await onLoggedIn()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  const loginMfa = useMutation({
    mutationFn: () => api.auth.loginMfa({ challengeToken: challengeToken!, code }),
    onSuccess: onLoggedIn,
    onError: (err) =>
      setError(err instanceof ApiError ? t('login.mfaError') : t('common.somethingWentWrong')),
  })

  if (setupLoading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  if (setupStatus?.required) return <Navigate to="/setup" replace />
  if (user) return <Navigate to="/dashboard" replace />

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    login.mutate()
  }

  function handleMfaSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    loginMfa.mutate()
  }

  if (challengeToken) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-xl font-semibold">{t('login.mfaTitle')}</h1>
          <p className="mb-6 text-sm text-[var(--color-fg-muted)]">{t('login.mfaDescription')}</p>
          <form onSubmit={handleMfaSubmit} className="flex flex-col gap-4">
            <Field
              label={t('login.mfaCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              error={error}
            />
            <Button type="submit" isLoading={loginMfa.isPending}>
              {t('login.mfaSubmit')}
            </Button>
            <button
              type="button"
              className="self-start text-sm text-[var(--color-primary)] underline"
              onClick={() => {
                setChallengeToken(undefined)
                setCode('')
                setError(undefined)
              }}
            >
              {t('login.mfaBack')}
            </button>
          </form>
        </Card>
      </div>
    )
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
          <Button type="submit" isLoading={login.isPending}>
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
