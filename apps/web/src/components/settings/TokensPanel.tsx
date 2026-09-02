import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'
import { TokenWebhookLinks } from './TokenWebhookLinks.js'

// Written out once rather than inline at both the display and clipboard
// call sites below (previously duplicated verbatim). M4's other webhook
// sources will each need their own version of this, at which point this
// becomes the one place that grows a per-source list.
function plexWebhookUrl(token: string): string {
  return `${window.location.origin}/api/v1/webhooks/plex/${token}`
}

/** Collapsed by default like every other panel on this page except
 * AboutPanel.tsx (2026-09-02) — see account/AdvancedPreferencesCard.tsx's
 * doc comment for why `<details>` over a bespoke show/hide component. */
export function TokensPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelSettingsTokens')
  const [name, setName] = useState('')
  const [justCreated, setJustCreated] = useState<string>()
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.tokens.list(),
  })

  const createToken = useMutation({
    mutationFn: () => api.tokens.create({ name }),
    onSuccess: (created) => {
      setJustCreated(created.token)
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const revokeToken = useMutation({
    mutationFn: (id: string) => api.tokens.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setJustCreated(undefined)
    createToken.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('settings.tokens.title')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.tokens.description')}
        </p>

        {justCreated && (
          <div
            role="status"
            className="mb-4 rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-3"
          >
            <p className="mb-1 text-sm">{t('settings.tokens.createdOnce')}</p>
            <code className="block truncate text-sm">{justCreated}</code>

            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <p className="mb-1 text-sm font-medium">{t('settings.tokens.plex.title')}</p>
              <p className="mb-2 text-xs text-[var(--color-fg-muted)]">
                {t('settings.tokens.plex.description')}
              </p>
              <div className="flex items-center gap-2">
                <code className="block flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs">
                  {plexWebhookUrl(justCreated)}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(plexWebhookUrl(justCreated))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? t('settings.tokens.plex.copied') : t('settings.tokens.plex.copy')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-2">
          <Field
            label={t('settings.tokens.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1"
          />
          <Button type="submit" isLoading={createToken.isPending}>
            {t('settings.tokens.create')}
          </Button>
        </form>

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.tokens.map((token) => (
              <li key={token.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{token.name}</p>
                    <p className="text-sm text-[var(--color-fg-muted)]">
                      {token.lastUsedAt
                        ? t('settings.tokens.lastUsed', {
                            date: new Date(token.lastUsedAt).toLocaleString(i18n.language),
                          })
                        : t('settings.tokens.neverUsed')}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => revokeToken.mutate(token.id)}
                    aria-label={`${t('settings.tokens.revoke')}: ${token.name}`}
                  >
                    {t('settings.tokens.revoke')}
                  </Button>
                </div>
                <TokenWebhookLinks tokenId={token.id} />
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  )
}
