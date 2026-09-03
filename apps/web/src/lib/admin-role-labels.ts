import type { UserRole } from '@rwnd/shared'

/** Maps a role to its `admin.*` i18n key — shared between `UserRow.tsx`
 * (the list row's role badge), `AdminUserPage.tsx` (the detail page's
 * header badge and the role `Select`'s own options), and `role-badge.tsx`,
 * so none of them drift on what a role is called. Kept out of
 * `role-badge.tsx` itself (a plain constant, not a component) so that file
 * stays Fast-Refresh-friendly — see its own react-refresh lint rule. */
export const ROLE_KEY: Record<UserRole, 'roleAdmin' | 'roleUser' | 'roleOwner'> = {
  admin: 'roleAdmin',
  user: 'roleUser',
  owner: 'roleOwner',
}
