import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Select } from '../ui/Select.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

/**
 * Rendered on AccountPage.tsx only when `user?.role === 'owner'` (M4
 * "owner" role work, docs/TODO_ARCHIVE.md) — right before
 * DeleteAccountCard.tsx, same "most consequential action last" placement
 * reasoning already documented there. The only way ownership ever moves:
 * an ordinary admin can never promote/demote/delete the owner
 * (UserRow.tsx, routes/admin-users.ts), so the owner has to hand the role
 * on themselves.
 *
 * Target list is existing admins only, not any user (decided with James:
 * a safety rail against transferring ultimate control to someone never
 * even trusted with admin access) — fetched via the same `GET /admin/users`
 * the Users list itself uses, filtered client-side to `role === 'admin'`
 * rather than adding a dedicated endpoint for one dropdown.
 *
 * Same typed-confirmation-plus-password shape as DeleteAccountCard.tsx,
 * password re-proving identity for the single highest-privilege action in
 * the app — except the "confirm" field here is picking the target from a
 * `Select`, not typing anything, since the consequence (who becomes owner)
 * needs to be an unambiguous choice, not a free-text match.
 */
export function TransferOwnershipCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = usePanelOpen('panelAccountTransferOwnership')

  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.admin.listUsers(),
  })
  const admins = data?.users.filter((u) => u.role === 'admin') ?? []

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [targetUserId, setTargetUserId] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string>()

  const transferOwnership = useMutation({
    mutationFn: () => api.auth.transferOwnership({ targetUserId, currentPassword }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      ])
      handleClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleClose() {
    setConfirmOpen(false)
    setCurrentPassword('')
    setError(undefined)
    transferOwnership.reset()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    transferOwnership.mutate()
  }

  const target = admins.find((a) => a.id === targetUserId)

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('account.transferOwnershipTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('account.transferOwnershipDescription')}
        </p>

        {admins.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t('account.transferOwnershipNoAdmins')}
          </p>
        ) : (
          <>
            <Select
              label={t('account.transferOwnershipTarget')}
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            >
              <option value="" disabled>
                {t('account.transferOwnershipSelectPrompt')}
              </option>
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.displayName} ({admin.email})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="danger"
              className="mt-4"
              disabled={!targetUserId}
              onClick={() => setConfirmOpen(true)}
            >
              {t('account.transferOwnershipButton')}
            </Button>
          </>
        )}

        <Dialog
          open={confirmOpen}
          onClose={handleClose}
          title={t('account.transferOwnershipConfirmTitle')}
        >
          <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
            {t('account.transferOwnershipConfirmBody', { name: target?.displayName ?? '' })}
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field
              label={t('account.transferOwnershipPassword')}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              error={error}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="danger" isLoading={transferOwnership.isPending}>
                {t('account.transferOwnershipButton')}
              </Button>
            </div>
          </form>
        </Dialog>
      </details>
    </Card>
  )
}
