import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { useAuth } from '../lib/use-auth.js'
import { detectedLocale } from '../lib/detected-locale.js'
import { Card } from '../components/ui/Card.js'
import { Field } from '../components/ui/Field.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

export function RegisterPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isLoading: authLoading } = useAuth()
  const { data: settings, isLoading: settingsLoading } = usePublicSettings()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string>()

  const register = useMutation({
    mutationFn: () =>
      api.auth.register({
        displayName,
        email,
        password,
        inviteCode: inviteCode || undefined,
        locale: detectedLocale(i18n.language),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      void navigate('/dashboard')
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  if (authLoading || settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />

  if (settings?.registrationMode === 'closed') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <p>{t('register.closed')}</p>
          <Link to="/login" className="mt-4 inline-block text-[var(--color-primary)] underline">
            {t('register.loginLink')}
          </Link>
        </Card>
      </div>
    )
  }

  // Registration needs to send a verification email, so it can't actually
  // be used until SMTP is configured — independent of registrationMode.
  if (settings && !settings.emailConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <p className="font-semibold text-[var(--color-danger)]">
            {t('register.emailNotConfigured')}
          </p>
          <Link to="/login" className="mt-4 inline-block text-[var(--color-primary)] underline">
            {t('register.loginLink')}
          </Link>
        </Card>
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    register.mutate()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">{t('register.title')}</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t('register.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
          <Field
            label={t('register.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Field
            label={t('register.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
          {settings?.registrationMode === 'invite' && (
            <Field
              label={t('register.inviteCode')}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              error={error}
            />
          )}
          {settings?.registrationMode !== 'invite' && error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Button type="submit" isLoading={register.isPending}>
            {t('register.submit')}
          </Button>
        </form>
        <p className="mt-4 text-sm text-[var(--color-fg-muted)]">
          {t('register.loginPrompt')}{' '}
          <Link to="/login" className="text-[var(--color-primary)] underline">
            {t('register.loginLink')}
          </Link>
        </p>
      </Card>
    </div>
  )
}
