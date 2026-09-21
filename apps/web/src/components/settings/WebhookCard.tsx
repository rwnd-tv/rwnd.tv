import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  WEBHOOK_SOURCE_LABELS,
  webhookSourceSchema,
  type ApiToken,
  type WebhookSource,
} from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { ChevronDownIcon } from '../icons.js'
import { TAUTULLI_JSON_TEMPLATE, webhookUrl } from './webhook-sources.js'
import { useCopyFeedback } from '../../lib/use-copy-feedback.js'
import { SourceIcon } from './SourceIcon.js'
import { TokenWebhookLinks } from './TokenWebhookLinks.js'

function setTokenInCache(queryClient: ReturnType<typeof useQueryClient>, updated: ApiToken) {
  queryClient.setQueryData<{ tokens: ApiToken[] }>(['tokens'], (old) => ({
    tokens: (old?.tokens ?? []).map((t) => (t.id === updated.id ? updated : t)),
  }))
}

/**
 * One webhook, as its own collapsible panel — collapsed by default,
 * except the one `WebhooksPanel.tsx` just created for this render
 * (`defaultOpen`), so its URL is right there without an extra click.
 * Only a starting point: `open` is plain local state after that, not
 * re-synced from `defaultOpen` on every render, so collapsing it back
 * down (or a sibling being created afterward) doesn't fight the user.
 *
 * The URL row and Regenerate below deliberately mirror
 * `CalendarFeedsPanel.tsx`'s `FeedRow` — always-visible URL, Regenerate
 * as the rotation mechanism — now that a webhook token can be durably
 * recoverable too (`token` non-null); see that file's own doc comment
 * and `docs/adr/0007-security-posture.md`'s 2026-09-14 update for why
 * this one *also* falls back to "URL unavailable" when `token` is null
 * (no `ENCRYPTION_KEY` configured, or a pre-migration row never
 * backfilled) — webhook ingestion is core functionality, so that
 * fallback exists instead of gating the whole panel the way Calendar
 * feeds gates itself on `calendarFeedsAvailable`.
 */
export function WebhookCard({ token, defaultOpen }: { token: ApiToken; defaultOpen: boolean }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(defaultOpen)
  const { copied, copy } = useCopyFeedback<'url' | 'template'>()
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [sourceError, setSourceError] = useState<string>()

  const regenerate = useMutation({
    mutationFn: () => api.tokens.regenerate(token.id),
    onSuccess: (updated) => {
      setTokenInCache(queryClient, updated)
      setConfirmRegenerate(false)
    },
  })

  const revoke = useMutation({
    mutationFn: () => api.tokens.delete(token.id),
    onSuccess: () => {
      queryClient.setQueryData<{ tokens: ApiToken[] }>(['tokens'], (old) => ({
        tokens: (old?.tokens ?? []).filter((t) => t.id !== token.id),
      }))
    },
  })

  const setSource = useMutation({
    mutationFn: (source: WebhookSource) => api.tokens.update(token.id, { source }),
    onSuccess: (updated) => {
      setTokenInCache(queryClient, updated)
      setSourceError(undefined)
    },
    onError: (err) => {
      setSourceError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
      // A 409 here means two source buttons were clicked in quick
      // succession (or another session raced this one) and the server-side
      // state already moved on — refetch so the stale "pick a source"
      // picker naturally disappears in favor of the real URL row, rather
      // than staying stuck showing buttons for a token that already has one.
      if (err instanceof ApiError && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['tokens'] })
      }
    },
  })

  const source = token.source

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <SourceIcon source={source} className="h-9 w-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{token.name}</span>
            <span className="block text-xs text-[var(--color-fg-muted)]">
              {token.lastUsedAt
                ? t('settings.webhooks.card.lastUsed', {
                    date: new Date(token.lastUsedAt).toLocaleString(i18n.language),
                  })
                : t('settings.webhooks.card.neverUsed')}
            </span>
          </span>
        </span>
        <ChevronDownIcon
          className={`h-5 w-5 flex-shrink-0 text-[var(--color-fg-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
          {!source && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{t('settings.webhooks.card.pickSource')}</p>
              <div className="flex flex-wrap gap-2">
                {webhookSourceSchema.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="secondary"
                    disabled={setSource.isPending}
                    isLoading={setSource.isPending && setSource.variables === option}
                    onClick={() => setSource.mutate(option)}
                  >
                    {WEBHOOK_SOURCE_LABELS[option]}
                  </Button>
                ))}
              </div>
              {sourceError && (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {sourceError}
                </p>
              )}
            </div>
          )}

          {source && (
            <>
              {token.token ? (
                <div className="flex items-center gap-2">
                  <code className="block flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs">
                    {webhookUrl(source, token.token)}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => token.token && copy(webhookUrl(source, token.token), 'url')}
                  >
                    {copied === 'url'
                      ? t('settings.webhooks.card.copied')
                      : t('settings.webhooks.card.copy')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-fg-muted)]">
                  {t('settings.webhooks.card.urlUnavailable')}
                </p>
              )}

              <details>
                <summary className="cursor-pointer text-xs font-medium text-[var(--color-fg-muted)]">
                  {t('settings.webhooks.card.setupInstructions')}
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-xs text-[var(--color-fg-muted)]">
                    {t(`settings.webhooks.setup.instructions.${source}`)}
                  </p>
                  {source === 'tautulli' && (
                    <div className="flex items-start gap-2">
                      <pre className="block flex-1 overflow-x-auto rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs">
                        {TAUTULLI_JSON_TEMPLATE}
                      </pre>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => copy(TAUTULLI_JSON_TEMPLATE, 'template')}
                      >
                        {copied === 'template'
                          ? t('settings.webhooks.card.copied')
                          : t('settings.webhooks.card.copy')}
                      </Button>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}

          <TokenWebhookLinks tokenId={token.id} />

          <div className="flex gap-2 border-t border-[var(--color-border)] pt-3">
            <Button type="button" variant="secondary" onClick={() => setConfirmRegenerate(true)}>
              {t('settings.webhooks.card.regenerate')}
            </Button>
            <Button type="button" variant="danger" onClick={() => setConfirmRevoke(true)}>
              {t('settings.webhooks.card.revoke')}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        title={t('settings.webhooks.card.regenerateConfirmTitle')}
      >
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('settings.webhooks.card.regenerateConfirmBody', {
            source: source ? WEBHOOK_SOURCE_LABELS[source] : token.name,
          })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmRegenerate(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={regenerate.isPending}
            onClick={() => regenerate.mutate()}
          >
            {t('settings.webhooks.card.regenerate')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title={t('settings.webhooks.card.revokeConfirmTitle')}
      >
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t('settings.webhooks.card.revokeConfirmBody', { name: token.name })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmRevoke(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {t('settings.webhooks.card.revoke')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
