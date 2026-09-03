import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { AdminUserSummary, UserRole } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { useSortCookie } from '../../lib/use-sort-cookie.js'
import { useGenreFilterCookie } from '../../lib/use-genre-filter-cookie.js'
import {
  createdComparatorAsc,
  createdComparatorDesc,
  filterByMfa,
  filterByNameOrEmail,
  filterByRole,
  filterByVerified,
  lastLoginComparatorAsc,
  lastLoginComparatorDesc,
  MFA_FILTER_MODES,
  nameComparatorAsc,
  nameComparatorDesc,
  roleComparatorAsc,
  roleComparatorDesc,
  VERIFIED_FILTER_MODES,
  type MfaFilterMode,
  type VerifiedFilterMode,
} from '../../lib/admin-user-filter.js'
import { ROLE_KEY } from '../../lib/admin-role-labels.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'
import { LibraryControls } from '../library/LibraryControls.js'
import { FiltersPanel } from '../library/FiltersPanel.js'
import { RoleFilterPanel } from './RoleFilterPanel.js'
import { MfaFilterPanel } from './MfaFilterPanel.js'
import { VerifiedFilterPanel } from './VerifiedFilterPanel.js'
import { UserRow } from './UserRow.js'

const SORT_KEYS = [
  'nameAsc',
  'nameDesc',
  'roleAsc',
  'roleDesc',
  'lastLoginDesc',
  'lastLoginAsc',
  'createdDesc',
  'createdAsc',
] as const
type SortKey = (typeof SORT_KEYS)[number]

const ALL_ROLES: UserRole[] = ['owner', 'admin', 'user']

function sortUsers(users: AdminUserSummary[], sortBy: SortKey, locale: string): AdminUserSummary[] {
  const sorted = [...users]
  switch (sortBy) {
    case 'nameAsc':
      return sorted.sort(nameComparatorAsc(locale))
    case 'nameDesc':
      return sorted.sort(nameComparatorDesc(locale))
    case 'roleAsc':
      return sorted.sort(roleComparatorAsc(locale))
    case 'roleDesc':
      return sorted.sort(roleComparatorDesc(locale))
    case 'lastLoginDesc':
      return sorted.sort(lastLoginComparatorDesc)
    case 'lastLoginAsc':
      return sorted.sort(lastLoginComparatorAsc)
    case 'createdDesc':
      return sorted.sort(createdComparatorDesc)
    case 'createdAsc':
      return sorted.sort(createdComparatorAsc)
  }
}

/**
 * `/admin` (AdminPage.tsx) — every user on the instance, display-name
 * ordered by default (`GET /admin/users`'s own `orderBy`), re-filterable/
 * re-sortable client-side (2026-09-03, docs/TODO_ARCHIVE.md) against that
 * one already-in-memory response — same "no pagination, no server query
 * params" situation as the Shows/Movies galleries' own filter/sort, so this
 * follows their pattern directly: `LibraryControls` for search + sort, a
 * "Filters…" button expanding a `FiltersPanel` (James, 2026-09-03: tried
 * putting the 3 facets inline first, but that overflowed the controls row
 * and squeezed the search box — the collapsible panel the galleries
 * already use avoids that), one collapsible `*FilterPanel.tsx` section per
 * facet (`RoleFilterPanel`/`MfaFilterPanel`/`VerifiedFilterPanel`, modelled
 * on `StatusFilterPanel`/`DroppedFilterPanel`), and a Reset button.
 *
 * Collapsed by default, same `<details>`/`<summary>` + `usePanelOpen`
 * idiom as every other panel on Import/Settings/Account (see
 * AdvancedPreferencesCard.tsx's doc comment for why `<details>` over a
 * bespoke show/hide component), and remembered the same way across a page
 * remount (James, 2026-09-03: asked for this page to match those rather
 * than always rendering open).
 */
export function UsersPanel() {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const locale = currentUser?.locale ?? 'en-GB'
  const [open, setOpen] = usePanelOpen('panelAdminUsers')

  const [filter, setFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortBy, setSortBy] = useSortCookie('rwnd_admin_users_sort', SORT_KEYS, 'nameAsc')
  const [roleFilters, setRoleFilters] = useGenreFilterCookie('rwnd_admin_users_role_filters')
  const [mfaMode, setMfaMode] = useSortCookie<MfaFilterMode>(
    'rwnd_admin_users_mfa_mode',
    MFA_FILTER_MODES,
    'neutral',
  )
  const [verifiedMode, setVerifiedMode] = useSortCookie<VerifiedFilterMode>(
    'rwnd_admin_users_verified_mode',
    VERIFIED_FILTER_MODES,
    'neutral',
  )

  function resetFilters() {
    setRoleFilters({})
    setMfaMode('neutral')
    setVerifiedMode('neutral')
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.admin.listUsers(),
  })

  const users = useMemo(() => {
    const byName = filterByNameOrEmail(data?.users ?? [], filter)
    const byRole = filterByRole(byName, roleFilters)
    const byMfa = filterByMfa(byRole, mfaMode)
    const byVerified = filterByVerified(byMfa, verifiedMode)
    return sortUsers(byVerified, sortBy, locale)
  }, [data, filter, roleFilters, mfaMode, verifiedMode, sortBy, locale])

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
          <div className="flex flex-col gap-4">
            <LibraryControls<SortKey>
              filterValue={filter}
              onFilterChange={setFilter}
              filterLabel={t('admin.usersFilterLabel')}
              filterPlaceholder={t('admin.usersFilterPlaceholder')}
              betweenFilterAndSort={
                <Button
                  variant="secondary"
                  type="button"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((next) => !next)}
                >
                  {t('admin.usersFiltersButton')}
                </Button>
              }
              sortValue={sortBy}
              onSortChange={setSortBy}
              sortLabel={t('admin.usersSortLabel')}
              sortOptions={[
                { value: 'nameAsc', label: t('admin.usersSortNameAsc') },
                { value: 'nameDesc', label: t('admin.usersSortNameDesc') },
                { value: 'roleAsc', label: t('admin.usersSortRoleAsc') },
                { value: 'roleDesc', label: t('admin.usersSortRoleDesc') },
                { value: 'lastLoginDesc', label: t('admin.usersSortLastLoginDesc') },
                { value: 'lastLoginAsc', label: t('admin.usersSortLastLoginAsc') },
                { value: 'createdDesc', label: t('admin.usersSortCreatedDesc') },
                { value: 'createdAsc', label: t('admin.usersSortCreatedAsc') },
              ]}
            />

            {filtersOpen && (
              <FiltersPanel>
                <RoleFilterPanel
                  roles={ALL_ROLES}
                  labelFor={(role) => t(`admin.${ROLE_KEY[role]}`)}
                  filters={roleFilters}
                  onChange={setRoleFilters}
                  groupLabel={t('admin.usersFiltersPanel.role')}
                  includeLabel={t('admin.usersFiltersPanel.include')}
                  excludeLabel={t('admin.usersFiltersPanel.exclude')}
                />
                <MfaFilterPanel
                  mode={mfaMode}
                  onChange={setMfaMode}
                  groupLabel={t('admin.usersFiltersPanel.mfa')}
                  rowLabel={t('admin.usersFiltersPanel.mfa')}
                  includeLabel={t('admin.usersFiltersPanel.include')}
                  excludeLabel={t('admin.usersFiltersPanel.exclude')}
                />
                <VerifiedFilterPanel
                  mode={verifiedMode}
                  onChange={setVerifiedMode}
                  groupLabel={t('admin.usersFiltersPanel.emailVerified')}
                  rowLabel={t('admin.usersFiltersPanel.emailVerified')}
                  includeLabel={t('admin.usersFiltersPanel.include')}
                  excludeLabel={t('admin.usersFiltersPanel.exclude')}
                />
                <div>
                  <Button variant="secondary" type="button" onClick={resetFilters}>
                    {t('admin.usersFiltersPanel.reset')}
                  </Button>
                </div>
              </FiltersPanel>
            )}

            {users.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)]">
                {filter.trim()
                  ? t('admin.usersNoMatches', { query: filter })
                  : t('admin.usersNoFilterMatches')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {users.map((user) => (
                  <UserRow key={user.id} user={user} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.usersEmpty')}</p>
        )}
      </details>
    </Card>
  )
}
