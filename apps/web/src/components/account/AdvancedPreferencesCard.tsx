import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { CollapsiblePanel } from '../ui/CollapsiblePanel.js'
import { Button } from '../ui/Button.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/**
 * Hide spoilers / fill gaps — collapsed by default, expandable (James,
 * 2026-08-25: these are settings someone sets once and rarely revisits,
 * unlike Profile/Preferences above). A native `<details>` rather than a
 * bespoke show/hide-state component: free keyboard support and no extra
 * ARIA wiring, and `open` defaulting to false is exactly "hidden by
 * default" with zero extra state. See ProfileCard.tsx's doc comment on
 * why this saves independently of the other two cards.
 */
export function AdvancedPreferencesCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAccountAdvancedPreferences')
  const [spoilerProtectionEnabled, setSpoilerProtectionEnabled] = useState(
    user?.spoilerProtectionEnabled ?? true,
  )
  const [onDeckFillGaps, setOnDeckFillGaps] = useState(user?.onDeckFillGaps ?? false)

  const updateAdvancedPreferences = useMutation({
    mutationFn: () => api.auth.updateMe({ spoilerProtectionEnabled, onDeckFillGaps }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateAdvancedPreferences.mutate()
  }

  return (
    <CollapsiblePanel
      title={t('account.advancedPreferencesTitle')}
      open={open}
      onOpenChange={setOpen}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={spoilerProtectionEnabled}
              onChange={(e) => setSpoilerProtectionEnabled(e.target.checked)}
            />
            {t('account.spoilerProtection')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('account.spoilerProtectionDescription')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={onDeckFillGaps}
              onChange={(e) => setOnDeckFillGaps(e.target.checked)}
            />
            {t('account.onDeckFillGaps')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('account.onDeckFillGapsDescription')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={updateAdvancedPreferences.isPending}>
            {t('account.save')}
          </Button>
          {updateAdvancedPreferences.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('account.saved')}</span>
          )}
        </div>
      </form>
    </CollapsiblePanel>
  )
}
