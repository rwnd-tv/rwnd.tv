import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssignableRole } from '@rwnd/shared'
import { api, ApiError } from '../lib/api-client.js'
import { useAuth } from '../lib/use-auth.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { Avatar } from '../components/Avatar.js'
import { Button } from '../components/ui/Button.js'
import { Card } from '../components/ui/Card.js'
import { Select } from '../components/ui/Select.js'
import { Dialog } from '../components/ui/Dialog.js'
import { Spinner } from '../components/ui/Spinner.js'
import { ChevronDownIcon } from '../components/icons.js'
import { usePanelOpen } from '../lib/use-panel-open.js'
import { Badge } from '../components/admin/role-badge.js'
import { ROLE_KEY } from '../lib/admin-role-labels.js'
import { UserSessions } from '../components/admin/UserSessions.js'
import { DeleteUserDialog } from '../components/admin/DeleteUserDialog.js'

/**
 * `/admin/users/{id}/{slug}` — one user's full admin detail (M4 "split
 * the list into a summary list plus a per-user detail page" work,
 * docs/TODO_ARCHIVE.md): everything `UserRow.tsx`'s expanded row used to
 * hold inline (sessions, role control, password reset, delete), now its
 * own page, the same `/shows/:slug`/`/watchlists/:id` detail-route
 * convention every other list with real per-item depth in this app uses.
 * The `{slug}` is cosmetic and ignored here (see `UserRow.tsx`, which
 * builds it); `{id}` alone resolves the page, and the slugless
 * `/admin/users/{id}` still routes to this same component.
 *
 * Sessions, Role, Password and Delete account are each a `Card` +
 * `<details>` + `usePanelOpen` panel, the same idiom (and same
 * collapsed-by-default) as Account/Settings/Import (James, 2026-09-03:
 * asked for panels rather than the plain horizontal rules this first
 * shipped with, then for the single Actions panel to split into one
 * panel per action). One panel per concern mirrors `AccountPage.tsx`,
 * where Password, Sessions and Delete account are likewise separate
 * panels rather than a combined "Actions" block. The identity header
 * above them isn't a panel, matching how `AccountPage.tsx`'s own title
 * sits outside its cards.
 *
 * No panel disappears just because it can't act right now; each says why
 * instead. Role locks on the owner's page; Delete account explains on
 * both the owner's page (ownership must transfer first) and your own
 * (belongs on your Account page, behind a password re-proof, not here);
 * Password explains when the instance has no SMTP configured at all, an
 * instance-wide gap rather than something about this particular user.
 *
 * No explicit "back to Users" link, matching every other detail page in
 * this app (the sidebar and browser back both already get you there).
 */
export function AdminUserPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()
  const { data: publicSettings } = usePublicSettings()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [sessionsOpen, setSessionsOpen] = usePanelOpen('panelAdminUserSessions')
  const [roleOpen, setRoleOpen] = usePanelOpen('panelAdminUserRole')
  const [passwordOpen, setPasswordOpen] = usePanelOpen('panelAdminUserPassword')
  const [deletePanelOpen, setDeletePanelOpen] = usePanelOpen('panelAdminUserDelete')
  const [pendingRole, setPendingRole] = useState<AssignableRole | null>(null)
  const [roleError, setRoleError] = useState<string>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState<string>()

  const {
    data: user,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: () => api.admin.getUser(id!),
    enabled: Boolean(id),
  })

  const isSelf = currentUser?.id === id

  const updateRole = useMutation({
    mutationFn: (role: AssignableRole) => api.admin.updateUserRole(id!, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      // A self-demotion changes what the sidebar/AdminRoute should show
      // right now, not just on next reload.
      if (isSelf) void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      setPendingRole(null)
    },
    onError: (err) =>
      setRoleError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  const sendPasswordReset = useMutation({
    mutationFn: () => api.admin.sendPasswordReset(id!),
    onSuccess: () => setResetSent(true),
    onError: (err) =>
      setResetError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (error) {
    return (
      <p className="text-[var(--color-fg-muted)]">
        {error instanceof ApiError && error.status === 404
          ? t('admin.userNotFound')
          : t('common.somethingWentWrong')}
      </p>
    )
  }
  if (!user) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar user={{ ...user, avatarUpdatedAt: null }} size={48} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">{user.displayName}</h1>
            <Badge tone={user.role === 'user' ? 'muted' : 'primary'}>
              {t(`admin.${ROLE_KEY[user.role]}`)}
            </Badge>
          </div>
          <p className="truncate text-sm text-[var(--color-fg-muted)]">{user.email}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--color-fg-muted)]">
        <span>
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString(i18n.language)
            : t('admin.lastLoginNever')}
        </span>
        <Badge>{user.mfaEnabled ? t('admin.mfaOn') : t('admin.mfaOff')}</Badge>
        <Badge>{user.emailVerifiedAt ? t('admin.verified') : t('admin.unverified')}</Badge>
      </div>

      <Card>
        <details
          className="group"
          open={sessionsOpen}
          onToggle={(e) => setSessionsOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {t('admin.sessionsTitle')}
            <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
          <UserSessions userId={id!} />
        </details>
      </Card>

      <Card>
        <details
          className="group"
          open={roleOpen}
          onToggle={(e) => setRoleOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {t('admin.roleTitle')}
            <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
          {user.role === 'owner' ? (
            // The owner's role is never changed from a dropdown, by anyone,
            // including the owner themselves — only via
            // TransferOwnershipCard.tsx on the Account page (see
            // PATCH /admin/users/{id}'s server-side guard, which rejects
            // this regardless of what the UI offers).
            <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.ownerRoleLocked')}</p>
          ) : (
            <Select
              // The panel's own title already says "Role"; the label stays
              // in the accessibility tree rather than repeating on screen.
              label={t('admin.role')}
              hideLabel
              value={user.role}
              onChange={(e) => setPendingRole(e.target.value as AssignableRole)}
              disabled={updateRole.isPending}
              className="max-w-xs"
            >
              <option value="user">{t('admin.roleUser')}</option>
              <option value="admin">{t('admin.roleAdmin')}</option>
            </Select>
          )}
        </details>
      </Card>

      {/* Explains rather than disappearing when SMTP isn't configured
          (James, 2026-09-03) — same treatment as Role/Delete account,
          extended to cover an instance-wide gap rather than something
          about this particular user. `requireEmailConfigured` is the
          real guard (routes/admin-users.ts); this is explanation only. */}
      <Card>
        <details
          className="group"
          open={passwordOpen}
          onToggle={(e) => setPasswordOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {t('admin.passwordTitle')}
            <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
          {publicSettings?.emailConfigured ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => sendPasswordReset.mutate()}
                isLoading={sendPasswordReset.isPending}
              >
                {t('admin.sendPasswordReset')}
              </Button>
              {resetSent && (
                <span role="status" className="text-sm text-[var(--color-fg-muted)]">
                  {t('admin.passwordResetSent')}
                </span>
              )}
              {resetError && (
                <span role="alert" className="text-sm text-[var(--color-danger)]">
                  {resetError}
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('admin.passwordResetUnavailable')}
            </p>
          )}
        </details>
      </Card>

      {/* Always a panel, explaining why the account can't be deleted from
          here rather than silently vanishing whenever it can't act
          (James, 2026-09-03) — same "say why, don't just hide it"
          treatment the Role panel's owner case already gets. Both the
          owner and self blocks are enforced server-side too
          (routes/admin-users.ts): this is explanation, not the actual
          guard. */}
      <Card>
        <details
          className="group"
          open={deletePanelOpen}
          onToggle={(e) => setDeletePanelOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {t('admin.deleteTitle')}
            <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
          {user.role === 'owner' ? (
            <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.deleteOwnerBlocked')}</p>
          ) : isSelf ? (
            <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.deleteSelfBlocked')}</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
                {t('admin.deleteWarning')}
              </p>
              <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
                {t('admin.deleteUser')}
              </Button>
            </>
          )}
        </details>
      </Card>

      <Dialog
        open={pendingRole !== null}
        onClose={() => {
          setPendingRole(null)
          setRoleError(undefined)
        }}
        title={
          pendingRole === 'admin' ? t('admin.promoteConfirmTitle') : t('admin.demoteConfirmTitle')
        }
      >
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {pendingRole === 'admin'
            ? t('admin.promoteConfirmBody', { name: user.displayName })
            : t('admin.demoteConfirmBody', { name: user.displayName })}
        </p>
        {isSelf && pendingRole === 'user' && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{t('admin.demoteSelfWarning')}</p>
        )}
        {roleError && (
          <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">
            {roleError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPendingRole(null)
              setRoleError(undefined)
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={pendingRole === 'user' ? 'danger' : 'primary'}
            isLoading={updateRole.isPending}
            onClick={() => pendingRole && updateRole.mutate(pendingRole)}
          >
            {pendingRole === 'admin' ? t('admin.promote') : t('admin.demote')}
          </Button>
        </div>
      </Dialog>

      <DeleteUserDialog
        user={user}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        // Unlike deleting from the list, deleting from here removes the
        // very page you're looking at out from under you — nowhere sane
        // left to stay, so head back to the list instead.
        onDeleted={() => void navigate('/admin')}
      />
    </div>
  )
}
