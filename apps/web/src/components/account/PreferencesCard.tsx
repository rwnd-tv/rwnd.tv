import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SUPPORTED_LOCALES, type Theme } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'

/** Language + theme — see ProfileCard.tsx's doc comment on why this is a
 * separately-saved section rather than sharing ProfileCard's form. */
export function PreferencesCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [locale, setLocale] = useState(user?.locale ?? 'en-GB')
  const [theme, setTheme] = useState<Theme>(user?.theme ?? 'system')

  const updatePreferences = useMutation({
    mutationFn: () => api.auth.updateMe({ locale, theme }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updatePreferences.mutate()
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('account.preferencesTitle')}</h2>
      <div className="mt-1 mb-4 border-t border-[var(--color-border)]" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="locale-select" className="text-sm font-medium">
            {t('account.locale')}
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
          <legend className="text-sm font-medium">{t('account.theme')}</legend>
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
                {t(`account.theme${option[0]!.toUpperCase()}${option.slice(1)}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={updatePreferences.isPending}>
            {t('account.save')}
          </Button>
          {updatePreferences.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('account.saved')}</span>
          )}
        </div>
      </form>
    </Card>
  )
}
