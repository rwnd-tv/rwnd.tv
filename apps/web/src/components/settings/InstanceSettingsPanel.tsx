import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { RegistrationMode } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { PROVIDER_LABELS } from '../../lib/provider-labels.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

export function InstanceSettingsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data } = usePublicSettings()

  const [instanceName, setInstanceName] = useState('')
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('closed')

  useEffect(() => {
    if (data) {
      setInstanceName(data.instanceName)
      setRegistrationMode(data.registrationMode)
    }
  }, [data])

  const updateSettings = useMutation({
    mutationFn: () => api.settings.update({ instanceName, registrationMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'public'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateSettings.mutate()
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('settings.instance.title')}</h2>
      <div className="mb-4 mt-1 border-t border-[var(--color-border)]" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('settings.instance.instanceName')}
          value={instanceName}
          onChange={(e) => setInstanceName(e.target.value)}
          required
        />

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('settings.instance.registrationMode')}</legend>
          <div className="flex flex-col gap-2">
            {(['open', 'invite', 'closed'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="registrationMode"
                  value={mode}
                  checked={registrationMode === mode}
                  onChange={() => setRegistrationMode(mode)}
                />
                {t(`settings.instance.registration${mode[0]!.toUpperCase()}${mode.slice(1)}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {data && data.metadataProviderPriority.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{t('settings.instance.metadataProviders')}</h3>
            <ol className="flex flex-col gap-0.5 text-sm text-[var(--color-fg-muted)]">
              {data.metadataProviderPriority.map((source, index) => (
                <li key={source}>
                  {index + 1}. {PROVIDER_LABELS[source]}
                </li>
              ))}
            </ol>
            {/* Read-only for now: with only one provider ever configured,
                there's nothing to reorder, and reorder controls (up/down
                buttons) can't be meaningfully exercised or tested until a
                second provider actually exists — see docs/adr/0006. The
                API already supports patching this as a full ordered list. */}
            {data.metadataProviderPriority.length === 1 && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('settings.instance.metadataProvidersSingle')}
              </p>
            )}
          </div>
        )}

        <div>
          <Button type="submit" isLoading={updateSettings.isPending}>
            {t('settings.instance.save')}
          </Button>
        </div>
      </form>
      {data?.environmentLabel && (
        <p className="mt-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.instance.environmentLabel', { label: data.environmentLabel })}
        </p>
      )}
    </Card>
  )
}
