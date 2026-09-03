import { Navigate, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth.js'
import { Spinner } from './ui/Spinner.js'

/**
 * Nested inside ProtectedRoute (so `user` is already guaranteed non-null
 * here) — gates `/admin` on `role === 'admin'`. A non-admin is bounced to
 * `/dashboard` rather than `/login` (see ProtectedRoute.tsx): they're
 * authenticated, just not privileged, and there's no dedicated "forbidden"
 * page in this app.
 *
 * Same reasoning as every other client-side role check in this codebase
 * (DeleteAccountCard.tsx's admin framing, SettingsPage.tsx's
 * `user?.role === 'admin'` panel gates): this is only ever a UX
 * convenience, never the real gate. The server enforces independently —
 * every `/admin/users/*` route is `requireAdmin`-gated
 * (apps/api/src/middleware/auth.ts) regardless of what this component
 * decides to render.
 */
export function AdminRoute() {
  const { user, isLoading } = useAuth()
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
