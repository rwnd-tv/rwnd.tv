import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { InstanceSettings, MetadataProviderSource, RegistrationMode } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { PROVIDER_LABELS } from '../../lib/provider-labels.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { ChevronDownIcon as CollapseChevronIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/** Icons for the metadata-provider reorder buttons below — same "one small
 * icon component per file" precedent as ShowDetailPage.tsx/
 * MovieDetailPage.tsx's own icons, not shared/exported. Aliased on import
 * where the shared `ChevronDownIcon` (icons.tsx) is also used below, for
 * the collapsible panel's own chevron — same name, different icon, so
 * the shared one is imported as `CollapseChevronIcon` to avoid shadowing
 * this file's own. */
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

/** Collapsed by default like every other panel on this page except
 * AboutPanel.tsx (2026-09-02) — see account/AdvancedPreferencesCard.tsx's
 * doc comment for why `<details>` over a bespoke show/hide component. */
export function InstanceSettingsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsInstance')
  const { data } = usePublicSettings()

  const [instanceName, setInstanceName] = useState('')
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('closed')
  const [adminEmail, setAdminEmail] = useState('')
  const [priorityOrder, setPriorityOrder] = useState<MetadataProviderSource[]>([])
  const [error, setError] = useState<string>()

  // Seeds the editable local state from the query once it loads (and again
  // if it changes identity, e.g. after a refetch) — computed during render
  // rather than in an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  // Deliberately starts at `undefined`, not `useState(data)`: if `data` is
  // already cached and fresh at mount (e.g. revisiting Settings within the
  // query's staleTime), `useState(data)` would seed `loadedSettings` to
  // that same object on its very first render, making `data !== loadedSettings`
  // false immediately and skipping the sync below entirely — leaving every
  // field stuck at its hardcoded useState default (e.g. registrationMode
  // showing "closed" while the server, and anything reading `data`
  // directly, is really "invite"). Starting at `undefined` guarantees the
  // first real `data` always differs from it, so the sync always runs once.
  const [loadedSettings, setLoadedSettings] = useState<InstanceSettings>()
  if (data && data !== loadedSettings) {
    setLoadedSettings(data)
    setInstanceName(data.instanceName)
    setRegistrationMode(data.registrationMode)
    setAdminEmail(data.adminEmail ?? '')
    setPriorityOrder(data.metadataProviderPriority)
  }

  const updateSettings = useMutation({
    mutationFn: () =>
      api.settings.update({
        instanceName,
        registrationMode,
        adminEmail: adminEmail.trim() === '' ? null : adminEmail.trim(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'public'] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
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
    setError(undefined)
    updateSettings.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.instance.title')}
          <CollapseChevronIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label={t('settings.instance.instanceName')}
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            required
          />

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">
              {t('settings.instance.registrationMode')}
            </legend>
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

          <div className="flex flex-col gap-1">
            <Field
              label={t('settings.instance.adminEmail')}
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder={t('settings.instance.adminEmailPlaceholder')}
              error={error}
            />
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t('settings.instance.adminEmailHint')}
            </p>
          </div>

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
                <p className="text-xs text-[var(--color-danger)]">
                  {t('common.somethingWentWrong')}
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
      </details>
    </Card>
  )
}
