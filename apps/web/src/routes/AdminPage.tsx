import { useTranslation } from 'react-i18next'
import { UsersPanel } from '../components/admin/UsersPanel.js'
import { InvitesPanel } from '../components/admin/InvitesPanel.js'
import { InstanceSettingsPanel } from '../components/admin/InstanceSettingsPanel.js'
import { DatabaseBackupsPanel } from '../components/admin/DatabaseBackupsPanel.js'

/**
 * `/admin` (M4, docs/TODO_ARCHIVE.md) — gated by AdminRoute.tsx, linked
 * from Sidebar.tsx only for `role === 'admin'`. The single consolidated
 * admin surface: Instance settings and Invites moved here from the
 * Settings page 2026-09-11 (docs/TODO_ARCHIVE.md), joining the Users list
 * and automatic-backup status that were already here.
 *
 * Four panels, ordered by expected frequency of use: the Users summary
 * list (UsersPanel.tsx — the one panel expanded by default here, each row
 * linking out to `/admin/users/{id}`, AdminUserPage.tsx, for everything
 * about one user), Invites (InvitesPanel.tsx), Instance settings
 * (InstanceSettingsPanel.tsx — instance name, registration mode, admin
 * contact email, metadata-provider priority), and the automatic
 * whole-database backup status (DatabaseBackupsPanel.tsx, docs/TODO.md).
 */
export function AdminPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <UsersPanel />
      <InvitesPanel />
      <InstanceSettingsPanel />
      <DatabaseBackupsPanel />
    </div>
  )
}
