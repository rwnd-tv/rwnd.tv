import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useSetupStatus } from '../lib/use-setup-status.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { detectedLocale } from '../lib/detected-locale.js'
import { Card } from '../components/ui/Card.js'
import { Field } from '../components/ui/Field.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'

export function SetupPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useSetupStatus()
  const { data: settings, isLoading: settingsLoading } = usePublicSettings()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()

  const setup = useMutation({
    mutationFn: () =>
      api.setup.create({
        displayName,
        email,
        password,
        locale: detectedLocale(i18n.language),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      void navigate('/dashboard')
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  if (isLoading || settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }

  // Setup has already run — don't let it be repeated.
  if (data && !data.required) {
    return <Navigate to="/login" replace />
  }

  // The first admin's email has to be handled by the same machinery as
  // everyone else's, so setup can't proceed until SMTP is configured —
  // there's nothing useful to offer here yet (no admin exists to log in
  // as, and creating one would leave its address unconfirmable), so this
  // replaces the form entirely rather than just disabling submit.
  if (settings && !settings.emailConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <h1 className="mb-1 text-xl font-semibold text-[var(--color-danger)]">
            {t('setup.emailRequiredTitle')}
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)]">{t('setup.emailRequiredBody')}</p>
        </Card>
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setup.mutate()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">{t('setup.title')}</h1>
        <p className="mb-6 text-sm text-[var(--color-fg-muted)]">{t('setup.description')}</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t('setup.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
          <Field
            label={t('setup.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Field
            label={t('setup.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
            error={error}
          />
          <Button type="submit" isLoading={setup.isPending}>
            {t('setup.submit')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
