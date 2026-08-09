import { Navigate, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth-context.js'
import { Spinner } from './ui/Spinner.js'

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
