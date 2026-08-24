import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SUPPORTED_LOCALES, type Theme } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/auth-context.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

export function ProfileForm() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [locale, setLocale] = useState(user?.locale ?? 'en-GB')
  const [theme, setTheme] = useState<Theme>(user?.theme ?? 'system')
  const [spoilerProtectionEnabled, setSpoilerProtectionEnabled] = useState(
    user?.spoilerProtectionEnabled ?? true,
  )
  const [onDeckFillGaps, setOnDeckFillGaps] = useState(user?.onDeckFillGaps ?? false)

  const updateProfile = useMutation({
    mutationFn: () =>
      api.auth.updateMe({ displayName, locale, theme, spoilerProtectionEnabled, onDeckFillGaps }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateProfile.mutate()
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('settings.profile.title')}</h2>
      <div className="mb-4 mt-1 border-t border-[var(--color-border)]" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('settings.profile.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="locale-select" className="text-sm font-medium">
            {t('settings.profile.locale')}
          </label>
          <select
            id="locale-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('settings.profile.theme')}</legend>
          <div className="flex gap-4">
            {(['system', 'light', 'dark'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="theme"
                  value={option}
                  checked={theme === option}
                  onChange={() => setTheme(option)}
                />
                {t(`settings.profile.theme${option[0]!.toUpperCase()}${option.slice(1)}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={spoilerProtectionEnabled}
              onChange={(e) => setSpoilerProtectionEnabled(e.target.checked)}
            />
            {t('settings.profile.spoilerProtection')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('settings.profile.spoilerProtectionDescription')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={onDeckFillGaps}
              onChange={(e) => setOnDeckFillGaps(e.target.checked)}
            />
            {t('settings.profile.onDeckFillGaps')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('settings.profile.onDeckFillGapsDescription')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={updateProfile.isPending}>
            {t('settings.profile.save')}
          </Button>
          {updateProfile.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">
              {t('settings.profile.saved')}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}
