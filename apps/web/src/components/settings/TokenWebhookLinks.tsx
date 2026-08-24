import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Button } from '../ui/Button.js'

/**
 * A webhook token doesn't map to exactly one rwnd.tv user — the media
 * server it's registered against (e.g. a Plex server with more than one
 * user on it) can have several of its own, discovered one at a time as
 * events actually arrive (see `packages/db/src/schema.ts`'s
 * `webhookAccountLinks` doc comment). Renders nothing until at least one
 * external account has been seen for this token — most tokens, and every
 * non-webhook token, show nothing extra here.
 */
export function TokenWebhookLinks({ tokenId }: { tokenId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['tokens', tokenId, 'webhook-links']

  const { data } = useQuery({
    queryKey,
    queryFn: () => api.tokens.webhookLinks(tokenId),
  })

  const assign = useMutation({
    mutationFn: ({ linkId, userId }: { linkId: string; userId: string | null }) =>
      api.tokens.updateWebhookLink(tokenId, linkId, { userId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const remove = useMutation({
    mutationFn: (linkId: string) => api.tokens.deleteWebhookLink(tokenId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  if (!data || data.links.length === 0) return null

  return (
    <div className="mt-2 border-t border-[var(--color-border)] pt-2">
      <p className="mb-1 text-xs font-medium text-[var(--color-fg-muted)]">
        {t('settings.tokens.linkedAccounts.title')}
      </p>
      <ul className="flex flex-col gap-1">
        {data.links.map((link) => (
          <li key={link.id} className="flex items-center justify-between gap-2">
            <span className="truncate text-sm">
              {link.externalAccountName}
              {!link.userId && (
                <span className="ml-2 text-xs text-[var(--color-fg-muted)]">
                  {t('settings.tokens.linkedAccounts.unclaimed')}
                </span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <select
                aria-label={t('settings.tokens.linkedAccounts.assignTo', {
                  name: link.externalAccountName,
                })}
                value={link.userId ?? ''}
                onChange={(e) => assign.mutate({ linkId: link.id, userId: e.target.value || null })}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
              >
                <option value="">{t('settings.tokens.linkedAccounts.unassigned')}</option>
                {data.assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="danger"
                onClick={() => remove.mutate(link.id)}
                aria-label={`${t('settings.tokens.linkedAccounts.remove')}: ${link.externalAccountName}`}
              >
                {t('settings.tokens.linkedAccounts.remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
