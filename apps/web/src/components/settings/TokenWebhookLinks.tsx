import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { WebhookAccountLink } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { invalidateWatchData } from '../../lib/query-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Button } from '../ui/Button.js'
import { Field } from '../ui/Field.js'
import { Dialog } from '../ui/Dialog.js'
import { Spinner } from '../ui/Spinner.js'

/**
 * A webhook token doesn't map to exactly one rwnd.tv user — the media
 * server it's registered against (e.g. a Plex server with more than one
 * user on it) can have several of its own, discovered one at a time as
 * events actually arrive (see `packages/db/src/schema.ts`'s
 * `webhookAccountLinks` doc comment). Renders nothing until at least one
 * external account has been seen for this token — most tokens, and every
 * non-webhook token, show nothing extra here.
 *
 * Linking an account for anyone but yourself always goes through a
 * one-time code the target redeems themselves
 * (`LinkedAccountsPanel.tsx`, further down this same Settings page) —
 * this component only ever writes to the *caller's own* account
 * directly ("This is me") or generates a code for someone else; see
 * `docs/adr/0007-security-posture.md`'s addendum for why there's no
 * direct-assign-to-anyone control here any more.
 *
 * Section heading is "Detected accounts", not "Linked accounts" — James,
 * 2026-09-02: the standalone `LinkedAccountsPanel.tsx` above this one on
 * the same Settings page already claims that name for "what's linked to
 * *me*", and having both headings say the exact same thing right next
 * to each other, for two different meanings (everyone this token has
 * ever seen, vs. only what belongs to the caller), read as confusing.
 */
export function TokenWebhookLinks({ tokenId }: { tokenId: string }) {
  const { t } = useTranslation()
  const queryKey: QueryKey = ['tokens', tokenId, 'webhook-links']

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.tokens.webhookLinks(tokenId),
  })

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!data || data.links.length === 0) return null

  return (
    <div className="mt-2 border-t border-[var(--color-border)] pt-2">
      <p className="mb-1 text-xs font-medium text-[var(--color-fg-muted)]">
        {t('settings.tokens.detectedAccounts.title')}
      </p>
      <ul className="flex flex-col gap-2">
        {data.links.map((link) => (
          <WebhookLinkRow key={link.id} tokenId={tokenId} queryKey={queryKey} link={link} />
        ))}
      </ul>
    </div>
  )
}

function WebhookLinkRow({
  tokenId,
  queryKey,
  link,
}: {
  tokenId: string
  queryKey: QueryKey
  link: WebhookAccountLink
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: settings } = usePublicSettings()
  const [error, setError] = useState<string>()
  const [linkCodeEmail, setLinkCodeEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  function reportError(err: unknown) {
    setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
  }

  function invalidateLinks() {
    // Also invalidates LinkedAccountsPanel's own list (['webhookLinks',
    // 'mine'], Settings page, above this one) — found missing 2026-09-02
    // (James: linking/unlinking/removing from here left that other panel
    // showing stale state until a manual page refresh). Cheap even when
    // this particular link isn't the caller's own — the query just
    // refetches and comes back unchanged.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['webhookLinks', 'mine'] }),
    ])
  }

  const linkSelf = useMutation({
    mutationFn: () => api.tokens.linkWebhookLink(tokenId, link.id),
    onSuccess: () => {
      void invalidateLinks()
      // Linking replays this account's stashed watches into the caller's
      // history server-side — without this, Activity/History/the
      // galleries would show it stale until a manual refresh.
      void invalidateWatchData(queryClient)
    },
    onError: reportError,
  })

  const unlink = useMutation({
    mutationFn: () => api.tokens.unlinkWebhookLink(tokenId, link.id),
    onSuccess: () => void invalidateLinks(),
    onError: reportError,
  })

  const remove = useMutation({
    mutationFn: () => api.tokens.deleteWebhookLink(tokenId, link.id),
    onSuccess: () => {
      setConfirmRemoveOpen(false)
      void invalidateLinks()
    },
    onError: (err) => {
      setConfirmRemoveOpen(false)
      reportError(err)
    },
  })

  const createCode = useMutation({
    mutationFn: (email?: string) =>
      api.tokens.createWebhookLinkCode(tokenId, link.id, email ? { email } : {}),
    onError: reportError,
  })

  function handleSendEmail(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setCopied(false)
    createCode.mutate(linkCodeEmail)
  }

  function handleShowCode() {
    setError(undefined)
    setCopied(false)
    createCode.mutate(undefined)
  }

  // Captured as a local const rather than read as `createCode.data`
  // inline below — TypeScript's undefined-narrowing from the `codeData &&`
  // check doesn't survive into the nested onClick closure when read as a
  // property access on the (potentially-reassigned-next-render) mutation
  // object, only when read from a plain local binding like this one.
  const codeData = createCode.data

  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm">
          {link.externalAccountName}
          <span className="ml-2 text-xs text-[var(--color-fg-muted)]">
            {link.userId ? link.userDisplayName : t('settings.tokens.detectedAccounts.unlinked')}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {link.userId && (
            <Button
              type="button"
              variant="secondary"
              isLoading={unlink.isPending}
              onClick={() => {
                setError(undefined)
                unlink.mutate()
              }}
            >
              {t('settings.tokens.detectedAccounts.unlink')}
            </Button>
          )}
          <Button
            type="button"
            variant="danger"
            onClick={() => setConfirmRemoveOpen(true)}
            aria-label={`${t('settings.tokens.detectedAccounts.remove')}: ${link.externalAccountName}`}
          >
            {t('settings.tokens.detectedAccounts.remove')}
          </Button>
        </div>
      </div>

      {!link.userId && !codeData && (
        <div className="flex flex-wrap items-center gap-2">
          {link.callerCanLinkAsSelf && (
            <>
              <Button
                type="button"
                variant="secondary"
                isLoading={linkSelf.isPending}
                onClick={() => {
                  setError(undefined)
                  linkSelf.mutate()
                }}
              >
                {t('settings.tokens.detectedAccounts.thisIsMe')}
              </Button>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('settings.tokens.detectedAccounts.or')}
              </span>
            </>
          )}
          {settings?.emailConfigured && (
            <>
              {/* display: contents — the form still owns real submit
                  semantics (Enter-to-submit, the button's type="submit"),
                  but doesn't create its own flex box, so its two children
                  (the field and the button) lay out as direct items of the
                  outer row instead of being confined to the form's own
                  width. That's what lets the field's flex-1 grow against
                  the *row's* remaining space rather than just the form's. */}
              <form onSubmit={handleSendEmail} className="contents">
                <Field
                  label={t('settings.tokens.detectedAccounts.email')}
                  hideLabel
                  type="email"
                  required
                  value={linkCodeEmail}
                  onChange={(e) => setLinkCodeEmail(e.target.value)}
                  placeholder={t('settings.tokens.detectedAccounts.email')}
                  className="min-w-32 flex-1"
                />
                <Button type="submit" variant="secondary" isLoading={createCode.isPending}>
                  {t('settings.tokens.detectedAccounts.sendLinkEmail')}
                </Button>
              </form>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('settings.tokens.detectedAccounts.or')}
              </span>
            </>
          )}
          <Button
            type="button"
            variant="secondary"
            isLoading={createCode.isPending}
            onClick={handleShowCode}
          >
            {t('settings.tokens.detectedAccounts.showLinkCode')}
          </Button>
        </div>
      )}

      {codeData && (
        <div
          role="status"
          className="rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-2"
        >
          <p className="mb-1 text-xs">{t('settings.tokens.detectedAccounts.linkCodeCreated')}</p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 truncate rounded-md bg-[var(--color-surface)] px-2 py-1 text-xs">
              {codeData.code}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(codeData.code)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied
                ? t('settings.tokens.detectedAccounts.copied')
                : t('settings.tokens.detectedAccounts.copy')}
            </Button>
          </div>
          {codeData.emailSent && (
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              {t('settings.tokens.detectedAccounts.linkCodeEmailed', { email: linkCodeEmail })}
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <Dialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        title={t('settings.tokens.detectedAccounts.removeConfirmTitle')}
      >
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('settings.tokens.detectedAccounts.removeConfirmBody', {
            name: link.externalAccountName,
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmRemoveOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('settings.tokens.detectedAccounts.remove')}
          </Button>
        </div>
      </Dialog>
    </li>
  )
}
