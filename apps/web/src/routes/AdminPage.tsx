import { useTranslation } from 'react-i18next'
import { UsersPanel } from '../components/admin/UsersPanel.js'

/**
 * `/admin` (M4, docs/TODO_ARCHIVE.md) — gated by AdminRoute.tsx, linked
 * from Sidebar.tsx only for `role === 'admin'`. A separate top-level page
 * rather than another Settings panel, unlike InstanceSettingsPanel/
 * InvitesPanel (which stay on Settings for now — consolidating every
 * admin surface under here is a follow-up, not part of this).
 *
 * Thin like SettingsPage.tsx, just one panel today: the Users summary list
 * (UsersPanel.tsx), each row linking out to `/admin/users/{id}`
 * (AdminUserPage.tsx) for everything about one user.
 */
export function AdminPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <UsersPanel />
    </div>
  )
}
