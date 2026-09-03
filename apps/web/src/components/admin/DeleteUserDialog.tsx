import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AdminUserSummary } from '@rwnd/shared'
import { api, ApiError } from '../../lib/api-client.js'
import { Dialog } from '../ui/Dialog.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

/**
 * Mirrors account/DeleteAccountCard.tsx's confirm dialog shape (typed
 * email as the deliberate extra step against an accidental click), minus
 * the password field — this is an admin acting within their own
 * authority on someone else's account, same as DELETE /invites/{id}
 * needing no re-proof beyond the requireAdmin session itself.
 */
export function DeleteUserDialog({
  user,
  open,
  onClose,
}: {
  user: AdminUserSummary
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()

  const deleteUser = useMutation({
    mutationFn: () => api.admin.deleteUser(user.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      handleClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleClose() {
    setEmail('')
    setError(undefined)
    deleteUser.reset()
    onClose()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    deleteUser.mutate()
  }

  const emailMatches = email.trim().toLowerCase() === user.email.toLowerCase()

  return (
    <Dialog open={open} onClose={handleClose} title={t('admin.deleteConfirmTitle')}>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t('admin.deleteConfirmBody', { email: user.email })}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('admin.deleteConfirmEmail')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
          error={error}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!emailMatches}
            isLoading={deleteUser.isPending}
          >
            {t('admin.deleteUser')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
