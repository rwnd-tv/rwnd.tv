import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/use-auth.js'
import { invalidateWatchData } from '../lib/query-client.js'
import { Card } from '../components/ui/Card.js'
import { Button } from '../components/ui/Button.js'

/**
 * Landed on from the link in `sendWebhookLinkEmail`
 * (`apps/api/src/lib/email.ts`) — the code travels as a `?code=` query
 * param rather than being typed in manually. `LinkedAccountsPanel.tsx`
 * (`components/settings/`, on the Settings page) still has a "Have a
 * link code?" manual-entry form for e.g. a code read out over the
 * phone, or generated via "Show link code" instead of emailed.
 *
 * Behind `ProtectedRoute`, so `user` below is always set by the time
 * this renders: a not-yet-logged-in recipient is routed through
 * `/login` first, which returns here afterward (see that route's `next`
 * param handling in `ProtectedRoute.tsx`/`LoginPage.tsx`).
 *
 * Shows a confirmation step rather than redeeming on load, unlike
 * `VerifyEmailPage.tsx`/`ConfirmEmailChangePage.tsx`'s auto-fire pattern
 * — deliberate (James, 2026-09-02): those tokens only ever confirm
 * something about the account that's already logged in, but this one
 * decides *which* account a Plex profile's history gets attributed to,
 * so a stale session on a shared device silently linking it without
 * ever showing who it's about to be linked as would be a real footgun.
 *
 * Named `LinkWebhookAccountPage` (not `...ClaimWebhookAccountPage`) as
 * of 2026-09-02 — the whole feature was renamed from "claim" to "link"
 * throughout, James felt "link" is the term users would actually
 * understand; this page's own copy already said "link" even before
 * that, which is what prompted the rename.
 */
export function LinkWebhookAccountPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const redeem = useMutation({
    mutationFn: () => api.webhookLinks.redeem({ code: code! }),
    onSuccess: () => {
      // The redeemed link's pending watches were just replayed into this
      // account's own history server-side — without this, Activity/
      // History/the galleries would show it stale until a manual refresh.
      void invalidateWatchData(queryClient)
      // LinkedAccountsPanel (Settings page) reads this same key —
      // without invalidating it too, this link wouldn't show up there
      // until something else happened to refetch it.
      void queryClient.invalidateQueries({ queryKey: ['webhookLinks', 'mine'] })
    },
  })

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">{t('linkAccount.title')}</h1>
        {!code ? (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('linkAccount.invalidLink')}</p>
        ) : redeem.isSuccess ? (
          <>
            <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('linkAccount.success')}</p>
            <Link to="/settings" className="text-[var(--color-primary)] underline">
              {t('linkAccount.continue')}
            </Link>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
              {t('linkAccount.confirmBody', { name: user?.displayName ?? user?.email })}
            </p>
            {redeem.isError && (
              <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">
                {redeem.error instanceof ApiError
                  ? redeem.error.message
                  : t('common.somethingWentWrong')}
              </p>
            )}
            <Button type="button" isLoading={redeem.isPending} onClick={() => redeem.mutate()}>
              {t('linkAccount.confirm')}
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
