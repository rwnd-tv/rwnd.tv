import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MetadataProviderSource, RegistrationMode } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { PROVIDER_LABELS } from '../../lib/provider-labels.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

/** Icons for the metadata-provider reorder buttons below — same "one small
 * icon component per file" precedent as ShowDetailPage.tsx/
 * MovieDetailPage.tsx's own icons, not shared/exported. */
function ChevronUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function InstanceSettingsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data } = usePublicSettings()

  const [instanceName, setInstanceName] = useState('')
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('closed')
  const [priorityOrder, setPriorityOrder] = useState<MetadataProviderSource[]>([])

  useEffect(() => {
    if (data) {
      setInstanceName(data.instanceName)
      setRegistrationMode(data.registrationMode)
      setPriorityOrder(data.metadataProviderPriority)
    }
  }, [data])

  const updateSettings = useMutation({
    mutationFn: () => api.settings.update({ instanceName, registrationMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'public'] }),
  })

  // Separate from the form's own save button above — a reorder click
  // applies immediately, the same way the rest of this app treats
  // single-purpose actions (e.g. the Watched button), rather than sitting
  // unsaved until an unrelated "Save changes" submit.
  const updatePriority = useMutation({
    mutationFn: (order: MetadataProviderSource[]) =>
      api.settings.update({ metadataProviderPriority: order }),
    onSuccess: (updated) => {
      setPriorityOrder(updated.metadataProviderPriority)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'public'] })
    },
  })

  function moveProvider(index: number, direction: -1 | 1) {
    const swapIndex = index + direction
    const next = [...priorityOrder]
    ;[next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!]
    setPriorityOrder(next)
    updatePriority.mutate(next)
  }

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

        {priorityOrder.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{t('settings.instance.metadataProviders')}</h3>
            <ol className="flex flex-col gap-0.5 text-sm">
              {priorityOrder.map((source, index) => (
                <li key={source} className="flex items-center gap-2">
                  <span className="w-4 text-[var(--color-fg-muted)]">{index + 1}.</span>
                  <span className="flex-1">{PROVIDER_LABELS[source]}</span>
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-1 py-1"
                    disabled={index === 0 || updatePriority.isPending}
                    title={t('settings.instance.metadataProviderMoveUp', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    aria-label={t('settings.instance.metadataProviderMoveUp', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    onClick={() => moveProvider(index, -1)}
                  >
                    <ChevronUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-1 py-1"
                    disabled={index === priorityOrder.length - 1 || updatePriority.isPending}
                    title={t('settings.instance.metadataProviderMoveDown', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    aria-label={t('settings.instance.metadataProviderMoveDown', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    onClick={() => moveProvider(index, 1)}
                  >
                    <ChevronDownIcon />
                  </Button>
                </li>
              ))}
            </ol>
            {priorityOrder.length === 1 && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t('settings.instance.metadataProvidersSingle')}
              </p>
            )}
            {updatePriority.isError && (
              <p className="text-xs text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
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
