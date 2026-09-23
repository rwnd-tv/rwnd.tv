import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  InstanceSettings,
  LandingMode,
  MetadataProviderSource,
  RegistrationMode,
} from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { PROVIDER_LABELS } from '../../lib/provider-labels.js'
import { CollapsiblePanel } from '../ui/CollapsiblePanel.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

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

/** What Save actually submits — deliberately not the full `InstanceSettings`
 * response shape: that also carries `defaultLocale`/`appVersion`/
 * `traktConfigured`/etc, none of which this panel edits, and the PATCH
 * handler spreads its body straight into the DB row (apps/api/src/routes/
 * settings.ts), so an accidentally-included extra key would really get
 * written. `priorityOrder` and `error` are deliberately NOT part of this
 * type — see their own state declarations below for why. */
interface InstanceSettingsForm {
  instanceName: string
  registrationMode: RegistrationMode
  landingMode: LandingMode
  /** '' rather than null — an <input value> can't take null. Converted
   * back to null at submit time, the only place the API's own
   * string|null shape is reconstructed. */
  adminEmail: string
}

function formFromSettings(settings: InstanceSettings): InstanceSettingsForm {
  return {
    instanceName: settings.instanceName,
    registrationMode: settings.registrationMode,
    landingMode: settings.landingMode,
    adminEmail: settings.adminEmail ?? '',
  }
}

/**
 * Admin-only, but not self-gated on role — this panel relies entirely on
 * `/admin` itself being gated by `AdminRoute.tsx` (isAdminRole), same as
 * UsersPanel.tsx/DatabaseBackupsPanel.tsx on this page. The server still
 * enforces independently (`PATCH /settings` is `requireAdmin`). Moved here
 * from the Settings page 2026-09-11 (docs/TODO_ARCHIVE.md) as part of
 * consolidating every admin surface onto this page.
 *
 * Collapsed by default — UsersPanel.tsx is the one panel on this page
 * expanded by default, not this one. See account/AdvancedPreferencesCard.tsx's
 * doc comment for why `<details>` over a bespoke show/hide component.
 */
export function InstanceSettingsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAdminInstance')
  const { data } = usePublicSettings()

  const [form, setForm] = useState<InstanceSettingsForm>({
    instanceName: '',
    registrationMode: 'closed',
    landingMode: 'marketing',
    adminEmail: '',
  })
  // Kept separate from `form` above: a reorder click applies immediately
  // and is overwritten by the *server's* response (see updatePriority
  // below), neither of which is true of `form` — folding it in would make
  // `api.settings.update(form)` the obvious-looking call, which would PATCH
  // metadataProviderPriority on every Save and race a concurrent admin's
  // own reorder.
  const [priorityOrder, setPriorityOrder] = useState<MetadataProviderSource[]>([])
  // Also kept separate: this is mutation state, not form state — folding
  // it into `form` would mean a re-seed either clears it or inconsistently
  // doesn't.
  const [error, setError] = useState<string>()

  // Seeds the editable local state from the query once it loads (and again
  // if it changes identity, e.g. after a refetch) — computed during render
  // rather than in an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  // Deliberately starts at `undefined`, not `useState(data)`: if `data` is
  // already cached and fresh at mount (e.g. revisiting the Admin page within
  // the query's staleTime), `useState(data)` would seed `loadedSettings` to
  // that same object on its very first render, making `data !== loadedSettings`
  // false immediately and skipping the sync below entirely — leaving every
  // field stuck at its hardcoded useState default (e.g. registrationMode
  // showing "closed" while the server, and anything reading `data`
  // directly, is really "invite"). Starting at `undefined` guarantees the
  // first real `data` always differs from it, so the sync always runs once.
  const [loadedSettings, setLoadedSettings] = useState<InstanceSettings>()
  if (data && data !== loadedSettings) {
    // Re-seeds per field against what THAT field last read from the
    // server, not against the form's current value — so a refetch that
    // brings back the same value this field was already seeded with
    // (e.g. the immediate-apply provider reorder further down invalidates
    // this same query purely to refresh metadataProviderPriority) leaves
    // an in-progress edit alone, while a refetch that brings back a
    // genuinely different value (someone changed it elsewhere) still
    // wins and overwrites the edit. Found 2026-09-16, docs/TODO.md: the
    // previous version re-seeded the whole form from every refetch
    // regardless of which field, if any, had actually changed.
    const prev = loadedSettings
    setLoadedSettings(data)
    setForm((f) =>
      !prev
        ? formFromSettings(data)
        : {
            instanceName:
              data.instanceName === prev.instanceName ? f.instanceName : data.instanceName,
            registrationMode:
              data.registrationMode === prev.registrationMode
                ? f.registrationMode
                : data.registrationMode,
            landingMode: data.landingMode === prev.landingMode ? f.landingMode : data.landingMode,
            adminEmail:
              data.adminEmail === prev.adminEmail ? f.adminEmail : (data.adminEmail ?? ''),
          },
    )
    setPriorityOrder(data.metadataProviderPriority)
  }

  const updateSettings = useMutation({
    mutationFn: () =>
      api.settings.update({
        instanceName: form.instanceName,
        registrationMode: form.registrationMode,
        landingMode: form.landingMode,
        adminEmail: form.adminEmail.trim() === '' ? null : form.adminEmail.trim(),
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
    <CollapsiblePanel title={t('admin.instance.title')} open={open} onOpenChange={setOpen}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('admin.instance.instanceName')}
          value={form.instanceName}
          onChange={(e) => setForm((f) => ({ ...f, instanceName: e.target.value }))}
          required
        />

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('admin.instance.registrationMode')}</legend>
          <div className="flex flex-col gap-2">
            {(['open', 'invite', 'closed'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="registrationMode"
                  value={mode}
                  checked={form.registrationMode === mode}
                  onChange={() => setForm((f) => ({ ...f, registrationMode: mode }))}
                />
                {t(`admin.instance.registration${mode[0]!.toUpperCase()}${mode.slice(1)}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('admin.instance.landingMode')}</legend>
          <div className="flex flex-col gap-2">
            {(['marketing', 'login'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="landingMode"
                  value={mode}
                  checked={form.landingMode === mode}
                  onChange={() => setForm((f) => ({ ...f, landingMode: mode }))}
                />
                {t(`admin.instance.landingMode${mode[0]!.toUpperCase()}${mode.slice(1)}`)}
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('admin.instance.landingModeHint')}
          </p>
        </fieldset>

        <div className="flex flex-col gap-1">
          <Field
            label={t('admin.instance.adminEmail')}
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
            placeholder={t('admin.instance.adminEmailPlaceholder')}
            error={error}
          />
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('admin.instance.adminEmailHint')}
          </p>
        </div>

        {priorityOrder.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{t('admin.instance.metadataProviders')}</h3>
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
                    title={t('admin.instance.metadataProviderMoveUp', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    aria-label={t('admin.instance.metadataProviderMoveUp', {
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
                    title={t('admin.instance.metadataProviderMoveDown', {
                      provider: PROVIDER_LABELS[source],
                    })}
                    aria-label={t('admin.instance.metadataProviderMoveDown', {
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
                {t('admin.instance.metadataProvidersSingle')}
              </p>
            )}
            {updatePriority.isError && (
              <p className="text-xs text-[var(--color-danger)]">{t('common.somethingWentWrong')}</p>
            )}
          </div>
        )}

        <div>
          <Button type="submit" isLoading={updateSettings.isPending}>
            {t('admin.instance.save')}
          </Button>
        </div>
      </form>
      {data?.environmentLabel && (
        <p className="mt-4 text-sm text-[var(--color-fg-muted)]">
          {t('admin.instance.environmentLabel', { label: data.environmentLabel })}
        </p>
      )}
    </CollapsiblePanel>
  )
}
