import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { slugify, type AdminUserSummary } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { Avatar } from '../Avatar.js'
import { Badge } from './role-badge.js'
import { ROLE_KEY } from '../../lib/admin-role-labels.js'

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 text-[var(--color-fg-muted)]"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/**
 * One row on UsersPanel.tsx (M4, docs/TODO_ARCHIVE.md) — summary only
 * (avatar, name/email, role/MFA/verified badges, last login), linking to
 * `/admin/users/{id}/{slug}` (AdminUserPage.tsx) for everything else:
 * sessions, role control, password reset, delete. Used to expand inline
 * instead (a local `open` state, `<details>`-style); split out (M4 "split
 * the list into a summary list plus a per-user detail page" work,
 * docs/TODO_ARCHIVE.md) because that stopped scaling once a row's
 * expanded content could itself run to several session rows, and because
 * it's the pattern every other list in this app with real per-item depth
 * (`/shows/:slug`, `/watchlists/:id`) already uses.
 *
 * The `{slug}` segment is a display name slugified client-side, purely for
 * a readable URL (Stack Overflow/Jira-style) — it's never persisted or
 * checked for uniqueness, and `AdminUserPage.tsx` ignores it entirely when
 * resolving the page (the `{id}` alone does that), so a stale slug from a
 * later display-name change never breaks a bookmarked or shared link.
 * `displayName` isn't unique or slug-safe the way a show/movie title is
 * (no collision suffixing, can be all-punctuation/emoji), so unlike
 * `/shows/:slug` the id still has to be the real key; falls back to no
 * slug segment at all (still routed, see App.tsx) if slugifying leaves
 * nothing.
 *
 * Real avatars (2026-09-03, docs/TODO_ARCHIVE.md) via the admin-only
 * `GET /admin/users/{id}/avatar` (routes/admin-users.ts) — `Avatar.tsx`'s
 * `avatarUrl` prop points it there instead of its default `GET
 * /auth/me/avatar`, the only other route that would otherwise leave every
 * row here stuck on the coloured-initials fallback.
 *
 * The selection checkbox (M4, bulk select/actions, docs/TODO_ARCHIVE.md)
 * has to sit *outside* the `<Link>`, not inside it: nesting interactive
 * content inside an `<a>` is invalid HTML, and a click on the checkbox
 * would otherwise also navigate. `selected`/`onToggleSelect`/
 * `selectAriaLabel` follow the same prop shape `ActivityTile.tsx` already
 * uses for HistoryPage.tsx's own bulk-select checkboxes — no shared
 * `Checkbox` component exists in `components/ui/`, every checkbox in this
 * app is a bare `<input>`. `selectDisabled` covers two cases the parent
 * knows about and this component doesn't: this is the acting admin's own
 * row (UsersPanel.tsx excludes self from every bulk action), or a batch is
 * currently running. `selectTitle` carries the "why" for the former —
 * matching this app's own rule (see AdminUserPage.tsx's doc comment) that
 * a disabled control should say why rather than just going quiet.
 */
export function UserRow({
  user,
  selected,
  onToggleSelect,
  selectDisabled,
  selectAriaLabel,
  selectTitle,
}: {
  user: AdminUserSummary
  selected: boolean
  onToggleSelect: () => void
  selectDisabled: boolean
  selectAriaLabel: string
  selectTitle?: string
}) {
  const { t, i18n } = useTranslation()
  const slug = slugify(user.displayName)

  return (
    <li className="flex items-center gap-3">
      <label className="flex shrink-0 items-center">
        <span className="sr-only">{selectAriaLabel}</span>
        <input
          type="checkbox"
          checked={selected}
          disabled={selectDisabled}
          title={selectTitle}
          onChange={onToggleSelect}
        />
      </label>
      <Link
        to={slug ? `/admin/users/${user.id}/${slug}` : `/admin/users/${user.id}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-md border border-[var(--color-border)] p-3 hover:bg-[var(--color-surface)]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar user={user} avatarUrl={(v) => api.admin.avatarUrl(user.id, v)} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate font-medium">{user.displayName}</p>
              <Badge tone={user.role === 'user' ? 'muted' : 'primary'}>
                {t(`admin.${ROLE_KEY[user.role]}`)}
              </Badge>
            </div>
            <p className="truncate text-sm text-[var(--color-fg-muted)]">{user.email}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden flex-col items-end gap-1 sm:flex">
            <span className="text-xs text-[var(--color-fg-muted)]">
              {user.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString(i18n.language)
                : t('admin.lastLoginNever')}
            </span>
            <div className="flex gap-1">
              <Badge>{user.mfaEnabled ? t('admin.mfaOn') : t('admin.mfaOff')}</Badge>
              <Badge>{user.emailVerifiedAt ? t('admin.verified') : t('admin.unverified')}</Badge>
            </div>
          </div>
          <ChevronRightIcon />
        </div>
      </Link>
    </li>
  )
}
