import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WebhookAccountLink, WebhookSource } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

// Not translated — a proper noun, same convention as PROVIDER_LABELS
// (apps/web/src/lib/provider-labels.ts). Only 'plex' exists today; M4
// adds Tautulli/Jellyfin/Emby/Kodi to this same enum.
const SOURCE_LABELS: Record<WebhookSource, string> = {
  plex: 'Plex',
}

/** Found missing 2026-09-02 (James, after running the link flow for
 * real): linking a webhook account only ever showed a one-time success
 * message (`LinkWebhookAccountPage.tsx`) with nothing persistent
 * afterward, and `Settings → API tokens → Detected accounts` (per-token,
 * `TokenWebhookLinks.tsx`) only helps the *token owner*, who the person
 * doing the linking usually isn't. This is the missing "what's linked
 * to me, and let me undo it myself" view, backed by
 * `GET/POST /webhook-links/mine...`
 * (`apps/api/src/routes/webhook-links.ts`) rather than the
 * token-owner-scoped routes `TokenWebhookLinks.tsx` uses. Unlinking here
 * mirrors that component's own "Unlink" behavior (clears attribution,
 * keeps the row and any watch history already recorded, re-linkable
 * afterward) and visually matches it too (danger/red) — James,
 * 2026-09-02, after an earlier plain-button version read as too easy to
 * miss for an action that stops future tracking.
 *
 * Absorbed the standalone "Claim a webhook account" panel
 * (`WebhookClaimPanel.tsx`, now deleted) 2026-09-02 (James: "there is a
 * lot of overlap [...] I think the claim mechanism could go into the
 * Linked accounts panel") — same "list plus a way to add one" shape
 * `TokensPanel.tsx` already uses one panel up, rather than two separate
 * panels for what's really one feature. Both panels briefly lived on
 * the Account page before moving to Settings, directly below
 * `TokensPanel`, the same day. Collapsed by default like every other
 * panel on this page except AboutPanel.tsx (2026-09-02) — see
 * account/AdvancedPreferencesCard.tsx's doc comment for why `<details>`
 * over a bespoke show/hide component. */
export function LinkedAccountsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsLinkedAccounts')
  const [error, setError] = useState<string>()
  const [code, setCode] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['webhookLinks', 'mine'],
    queryFn: () => api.webhookLinks.mine(),
  })

  function invalidateMine() {
    // Also invalidates every open TokenWebhookLinks instance
    // (['tokens', tokenId, 'webhook-links'], a query-key sibling under
    // this same ['tokens'] prefix) — found missing 2026-09-02 (James:
    // linking/unlinking from one panel left the other showing stale
    // state until a manual page refresh). React Query's partial-match
    // invalidation makes this one call do both rather than needing to
    // know which token(s) a given link actually belongs to.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['webhookLinks', 'mine'] }),
      queryClient.invalidateQueries({ queryKey: ['tokens'] }),
    ])
  }

  const unlink = useMutation({
    mutationFn: (linkId: string) => api.webhookLinks.unlink(linkId),
    onSuccess: () => void invalidateMine(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  const redeem = useMutation({
    mutationFn: () => api.webhookLinks.redeem({ code }),
    onSuccess: () => {
      setCode('')
      void invalidateMine()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleRedeem(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    redeem.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.linkedAccounts.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.linkedAccounts.description')}
        </p>
        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !data || data.links.length === 0 ? (
          <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
            {t('settings.linkedAccounts.empty')}
          </p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {data.links.map((link) => (
              <LinkedAccountRow
                key={link.id}
                link={link}
                isUnlinking={unlink.isPending && unlink.variables === link.id}
                onUnlink={() => {
                  setError(undefined)
                  unlink.mutate(link.id)
                }}
              />
            ))}
          </ul>
        )}

        <div className="mt-2 border-t border-[var(--color-border)] pt-4">
          <p className="mb-2 text-sm text-[var(--color-fg-muted)]">
            {t('settings.linkedAccounts.redeemDescription')}
          </p>
          <form onSubmit={handleRedeem} className="flex items-end gap-3">
            <Field
              label={t('settings.linkedAccounts.linkCode')}
              hideLabel
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('settings.linkedAccounts.linkCode')}
              required
              className="flex-1"
            />
            <Button type="submit" isLoading={redeem.isPending}>
              {t('settings.linkedAccounts.redeemSubmit')}
            </Button>
          </form>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </details>
    </Card>
  )
}

function LinkedAccountRow({
  link,
  isUnlinking,
  onUnlink,
}: {
  link: WebhookAccountLink
  isUnlinking: boolean
  onUnlink: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] p-2">
      <span className="truncate text-sm">
        {link.externalAccountName}
        <span className="ml-2 text-xs text-[var(--color-fg-muted)]">
          {SOURCE_LABELS[link.source]}
        </span>
      </span>
      <Button
        type="button"
        variant="danger"
        isLoading={isUnlinking}
        onClick={onUnlink}
        aria-label={`${t('settings.linkedAccounts.unlink')}: ${link.externalAccountName}`}
      >
        {t('settings.linkedAccounts.unlink')}
      </Button>
    </li>
  )
}
