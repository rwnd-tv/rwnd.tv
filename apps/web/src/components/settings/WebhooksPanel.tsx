import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  webhookSourceSchema,
  WEBHOOK_SOURCE_LABELS,
  type ApiToken,
  type WebhookSource,
} from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'
import { useCopyFeedback } from '../../lib/use-copy-feedback.js'
import { TAUTULLI_JSON_TEMPLATE } from './webhook-sources.js'
import { SourceIcon } from './SourceIcon.js'
import { WebhookCard } from './WebhookCard.js'

/**
 * Settings → Webhooks (renamed from "API tokens" — this token type has
 * never done anything but webhook ingestion, see
 * `docs/adr/0007-security-posture.md`'s 2026-09-14 update). Replaces the
 * old single flat list + one-time-reveal-of-every-source's-instructions
 * shape (`docs/TODO_ARCHIVE.md` has that history) with a create wizard
 * that shows only the picked server's own setup steps, and one
 * collapsible `WebhookCard.tsx` per existing webhook instead of a shared
 * `<ul>`.
 *
 * Collapsed by default like every other panel on this page except
 * AboutPanel.tsx (2026-09-02) — see account/AdvancedPreferencesCard.tsx's
 * doc comment for why `<details>` over a bespoke show/hide component.
 */
export function WebhooksPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsWebhooks')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedSource, setSelectedSource] = useState<WebhookSource>()
  const [name, setName] = useState('')
  const [justCreatedId, setJustCreatedId] = useState<string>()
  const { copied: templateCopied, copy: copyTemplate } = useCopyFeedback()

  const { data, isLoading } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.tokens.list(),
  })

  // Seeds the cache directly from the create response rather than
  // invalidating and refetching — GET /tokens can only ever redisplay a
  // token whose `tokenEncrypted` column is set (this instance has
  // `ENCRYPTION_KEY` configured), where POST /tokens always knows the
  // plaintext it just generated regardless. Invalidating here would work
  // fine when encryption is available, but silently drop the just-
  // created URL back to null the moment this instance doesn't have it
  // configured — exactly the "wait, where did it go" bug this whole
  // redesign exists to avoid.
  const createToken = useMutation({
    mutationFn: () =>
      api.tokens.create({ name: name.trim(), source: selectedSource as WebhookSource }),
    onSuccess: (created) => {
      queryClient.setQueryData<{ tokens: ApiToken[] }>(['tokens'], (old) => ({
        tokens: [created, ...(old?.tokens ?? [])],
      }))
      setJustCreatedId(created.id)
      setWizardOpen(false)
      setSelectedSource(undefined)
      setName('')
    },
  })

  function closeWizard() {
    setWizardOpen(false)
    setSelectedSource(undefined)
    setName('')
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!selectedSource || !name.trim()) return
    createToken.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.webhooks.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-1 text-sm text-[var(--color-fg-muted)]">
          {t('settings.webhooks.description')}
        </p>
        <p className="mb-4 text-xs text-[var(--color-fg-muted)]">
          {t('settings.webhooks.disclaimer')}
        </p>

        {!wizardOpen ? (
          <Button type="button" onClick={() => setWizardOpen(true)} className="mb-6">
            {t('settings.webhooks.add')}
          </Button>
        ) : (
          <div className="mb-6 rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-4">
            {!selectedSource ? (
              <>
                <p className="mb-3 text-xs font-semibold tracking-wide text-[var(--color-primary)] uppercase">
                  {t('settings.webhooks.sourcePicker.stepLabel')}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {webhookSourceSchema.options.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setSelectedSource(source)}
                      className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-primary)]"
                    >
                      <SourceIcon source={source} className="h-10 w-10" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {WEBHOOK_SOURCE_LABELS[source]}
                        </span>
                        <span className="block text-xs text-[var(--color-fg-muted)]">
                          {t(`settings.webhooks.sourcePicker.blurb.${source}`)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <Button type="button" variant="ghost" className="mt-3" onClick={closeWizard}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <form onSubmit={handleCreate} className="flex flex-col gap-3">
                <p className="text-xs font-semibold tracking-wide text-[var(--color-primary)] uppercase">
                  {t('settings.webhooks.setup.stepLabel', {
                    source: WEBHOOK_SOURCE_LABELS[selectedSource],
                  })}
                </p>
                <Field
                  label={t('settings.webhooks.setup.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('settings.webhooks.setup.namePlaceholder', {
                    source: WEBHOOK_SOURCE_LABELS[selectedSource],
                  })}
                  required
                />
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <p className="text-sm">
                    {t(`settings.webhooks.setup.instructions.${selectedSource}`)}
                  </p>
                  {selectedSource === 'tautulli' && (
                    <div className="mt-2 flex items-start gap-2">
                      <pre className="block flex-1 overflow-x-auto rounded-md bg-[var(--color-bg)] px-2 py-1 text-xs">
                        {TAUTULLI_JSON_TEMPLATE}
                      </pre>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => copyTemplate(TAUTULLI_JSON_TEMPLATE)}
                      >
                        {templateCopied
                          ? t('settings.webhooks.card.copied')
                          : t('settings.webhooks.card.copy')}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSelectedSource(undefined)}
                  >
                    {t('settings.webhooks.setup.back')}
                  </Button>
                  <Button type="submit" isLoading={createToken.isPending}>
                    {t('settings.webhooks.setup.create')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <div className="flex flex-col gap-3">
            {data?.tokens.map((token) => (
              <WebhookCard key={token.id} token={token} defaultOpen={token.id === justCreatedId} />
            ))}
          </div>
        )}
      </details>
    </Card>
  )
}
