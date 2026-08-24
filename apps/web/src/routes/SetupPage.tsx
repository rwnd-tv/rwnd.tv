import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useSetupStatus } from '../lib/use-setup-status.js'
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
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  if (isLoading) {
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      await api.setup.create({
        displayName,
        email,
        password,
        locale: detectedLocale(i18n.language),
      })
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
          <Button type="submit" isLoading={submitting}>
            {t('setup.submit')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
