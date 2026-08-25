import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { useAuth } from '../../lib/auth-context.js'
import { Avatar } from '../Avatar.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'

// Kept in sync with apps/api/src/routes/auth.ts's own limits — checked
// client-side too so a too-big/wrong-type file is rejected instantly
// rather than after a round trip.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Photo + display name — saves independently of PreferencesCard.tsx/
 * AdvancedPreferencesCard.tsx even though all three go through the same
 * `PATCH /auth/me` (every field on updateProfileRequestSchema is already
 * optional, so each card just sends its own subset) — three separate
 * "Save changes" actions for three separately-headed sections, rather
 * than one giant cross-card form, was the layout James asked for
 * (2026-08-25). */
export function ProfileCard() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')

  const updateProfile = useMutation({
    mutationFn: () => api.auth.updateMe({ displayName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    updateProfile.mutate()
  }

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => api.auth.uploadAvatar(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
    onError: (err) =>
      setAvatarError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })
  const deleteAvatar = useMutation({
    mutationFn: () => api.auth.deleteAvatar(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Always cleared, even on a rejected file — otherwise re-selecting that
    // same (still-invalid) file wouldn't fire another change event.
    e.target.value = ''
    if (!file) return
    setAvatarError(null)
    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setAvatarError(t('account.avatarInvalidType'))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(t('account.avatarTooLarge'))
      return
    }
    uploadAvatar.mutate(file)
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('account.profileTitle')}</h2>
      <div className="mb-4 mt-1 border-t border-[var(--color-border)]" />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('account.avatar')}</span>
        <div className="flex items-center gap-4">
          {user && <Avatar user={user} size={64} />}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              isLoading={uploadAvatar.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('account.avatarUpload')}
            </Button>
            {user?.avatarUpdatedAt && (
              <Button
                type="button"
                variant="ghost"
                isLoading={deleteAvatar.isPending}
                onClick={() => deleteAvatar.mutate()}
              >
                {t('account.avatarRemove')}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarChange}
            className="sr-only"
          />
        </div>
        {avatarError && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {avatarError}
          </p>
        )}
      </div>
      <div className="mb-4 mt-4 border-t border-[var(--color-border)]" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('account.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={updateProfile.isPending}>
            {t('account.save')}
          </Button>
          {updateProfile.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('account.saved')}</span>
          )}
        </div>
      </form>
    </Card>
  )
}
