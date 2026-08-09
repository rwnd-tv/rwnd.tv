import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold">404</h1>
      <p className="text-[var(--color-fg-muted)]">{t('app.name')}</p>
      <Link to="/" className="text-[var(--color-primary)] underline">
        ← Back
      </Link>
    </div>
  )
}
