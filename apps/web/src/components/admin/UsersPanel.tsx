import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'
import { UserRow } from './UserRow.js'

/**
 * `/admin` (AdminPage.tsx) — every user on the instance, oldest-created
 * first (same order `GET /admin/users` returns). Collapsed by default,
 * same `<details>`/`<summary>` + `usePanelOpen` idiom as every other
 * panel on Import/Settings/Account (see AdvancedPreferencesCard.tsx's
 * doc comment for why `<details>` over a bespoke show/hide component),
 * and remembered the same way across a page remount (James, 2026-09-03:
 * asked for this page to match those rather than always rendering open).
 */
export function UsersPanel() {
  const { t } = useTranslation()
  const [open, setOpen] = usePanelOpen('panelAdminUsers')

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.admin.listUsers(),
  })

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('admin.usersTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('admin.usersDescription')}</p>
        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : data && data.users.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.users.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.usersEmpty')}</p>
        )}
      </details>
    </Card>
  )
}
