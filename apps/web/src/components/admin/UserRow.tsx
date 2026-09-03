import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AdminUserSummary, AssignableRole, UserRole } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { useAuth } from '../../lib/use-auth.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Avatar } from '../Avatar.js'
import { Button } from '../ui/Button.js'
import { Select } from '../ui/Select.js'
import { Dialog } from '../ui/Dialog.js'
import { ChevronDownIcon } from '../icons.js'
import { UserSessions } from './UserSessions.js'
import { DeleteUserDialog } from './DeleteUserDialog.js'

const ROLE_KEY: Record<UserRole, 'roleAdmin' | 'roleUser' | 'roleOwner'> = {
  admin: 'roleAdmin',
  user: 'roleUser',
  owner: 'roleOwner',
}

/** Small inline badge, same shape as SessionsCard.tsx's "This device" chip
 * — no dedicated Badge component exists in this app. */
function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'primary' }) {
  return (
    <span
      className={
        tone === 'primary'
          ? 'shrink-0 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-xs font-normal text-[var(--color-primary-fg)]'
          : 'shrink-0 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-xs font-normal text-[var(--color-fg-muted)]'
      }
    >
      {children}
    </span>
  )
}

/**
 * One row on UsersPanel.tsx (M4, docs/TODO_ARCHIVE.md) — collapsed
 * summary (avatar, name/email, role/status badges, last login) expanding
 * to sessions and the admin actions. Local `open` state, not
 * `usePanelOpen` — that hook is keyed to one fixed cookie name per panel,
 * which is wrong for a dynamic per-row list.
 *
 * No avatar-serving endpoint exists for another user's image (Avatar.tsx
 * is hardwired to `GET /auth/me/avatar`, the caller's own) — rather than
 * add one just for this, every row renders the coloured-initials fallback
 * (`avatarUpdatedAt: null`). Display name plus email already identifies a
 * row unambiguously; real avatars here are a follow-up (docs/TODO.md).
 *
 * The owner's row (M4 "owner" role work, docs/TODO_ARCHIVE.md) is locked
 * down further: no role `Select` (a static label instead) and no Delete
 * button, for anyone — the owner can only be changed by themselves, via
 * TransferOwnershipCard.tsx on the Account page. Password reset and
 * session revoke stay available regardless of role; neither changes
 * privilege.
 */
export function UserRow({ user }: { user: AdminUserSummary }) {
  const { t, i18n } = useTranslation()
  const { user: currentUser } = useAuth()
  const { data: publicSettings } = usePublicSettings()
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [pendingRole, setPendingRole] = useState<AssignableRole | null>(null)
  const [roleError, setRoleError] = useState<string>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState<string>()

  const isSelf = currentUser?.id === user.id

  const updateRole = useMutation({
    mutationFn: (role: AssignableRole) => api.admin.updateUserRole(user.id, role),
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
    mutationFn: () => api.admin.sendPasswordReset(user.id),
    onSuccess: () => setResetSent(true),
    onError: (err) =>
      setResetError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  return (
    <li className="rounded-md border border-[var(--color-border)] p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar user={{ ...user, avatarUpdatedAt: null }} size={32} />
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
          <ChevronDownIcon
            className={`h-5 w-5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-[var(--color-border)] pt-4">
          <UserSessions userId={user.id} />

          <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
            <h3 className="text-sm font-semibold">{t('admin.actionsTitle')}</h3>

            {user.role === 'owner' ? (
              // The owner's role is never changed from a dropdown, by
              // anyone, including the owner themselves — only via
              // TransferOwnershipCard.tsx on the Account page (see
              // PATCH /admin/users/{id}'s server-side guard, which rejects
              // this regardless of what the UI offers).
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-[var(--color-fg)]">
                  {t('admin.role')}
                </span>
                <p className="text-sm text-[var(--color-fg-muted)]">{t('admin.ownerRoleLocked')}</p>
              </div>
            ) : (
              <Select
                label={t('admin.role')}
                value={user.role}
                onChange={(e) => setPendingRole(e.target.value as AssignableRole)}
                disabled={updateRole.isPending}
              >
                <option value="user">{t('admin.roleUser')}</option>
                <option value="admin">{t('admin.roleAdmin')}</option>
              </Select>
            )}

            {publicSettings?.emailConfigured && (
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
            )}

            {!isSelf && user.role !== 'owner' && (
              <Button
                type="button"
                variant="danger"
                className="self-start"
                onClick={() => setDeleteOpen(true)}
              >
                {t('admin.deleteUser')}
              </Button>
            )}
          </div>
        </div>
      )}

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

      <DeleteUserDialog user={user} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </li>
  )
}
