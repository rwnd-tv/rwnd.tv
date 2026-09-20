import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SUPPORTED_LOCALES, type Theme } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { CollapsiblePanel } from '../ui/CollapsiblePanel.js'
import { Button } from '../ui/Button.js'
import { Select } from '../ui/Select.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/** Language + theme — see ProfileCard.tsx's doc comment on why this is a
 * separately-saved section rather than sharing ProfileCard's form.
 * Collapsed by default like every other card on this page as of
 * 2026-09-02 — see AdvancedPreferencesCard.tsx's doc comment for why
 * `<details>` over a bespoke show/hide component. */
export function PreferencesCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAccountPreferences')
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
    <CollapsiblePanel title={t('account.preferencesTitle')} open={open} onOpenChange={setOpen}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Select
          id="locale-select"
          label={t('account.locale')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>

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
    </CollapsiblePanel>
  )
}
