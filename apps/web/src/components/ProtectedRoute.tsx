import { Navigate, Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth.js'
import { Spinner } from './ui/Spinner.js'

/**
 * Redirected to `/login?next=<this page>` rather than a bare `/login` —
 * LoginPage.tsx reads `next` and returns here once signed in, instead of
 * always landing on `/dashboard` regardless of what was actually
 * requested. Added 2026-09-02 for the webhook link-code email link
 * (`LinkWebhookAccountPage.tsx`, itself behind this same guard since
 * redemption needs a real session), but applies to every protected route
 * — any deep link someone isn't yet logged in for now returns them to
 * it, not just this one case.
 */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <Outlet />
}
