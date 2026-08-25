import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SUPPORTED_LOCALES, type Theme } from '@rwnd/shared'
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

export function ProfileForm() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [locale, setLocale] = useState(user?.locale ?? 'en-GB')
  const [theme, setTheme] = useState<Theme>(user?.theme ?? 'system')
  const [spoilerProtectionEnabled, setSpoilerProtectionEnabled] = useState(
    user?.spoilerProtectionEnabled ?? true,
  )
  const [onDeckFillGaps, setOnDeckFillGaps] = useState(user?.onDeckFillGaps ?? false)

  const updateProfile = useMutation({
    mutationFn: () =>
      api.auth.updateMe({ displayName, locale, theme, spoilerProtectionEnabled, onDeckFillGaps }),
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
      setAvatarError(t('profile.avatarInvalidType'))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(t('profile.avatarTooLarge'))
      return
    }
    uploadAvatar.mutate(file)
  }

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('profile.avatar')}</span>
        <div className="flex items-center gap-4">
          {user && <Avatar user={user} size={64} />}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              isLoading={uploadAvatar.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('profile.avatarUpload')}
            </Button>
            {user?.avatarUpdatedAt && (
              <Button
                type="button"
                variant="ghost"
                isLoading={deleteAvatar.isPending}
                onClick={() => deleteAvatar.mutate()}
              >
                {t('profile.avatarRemove')}
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
          label={t('profile.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="locale-select" className="text-sm font-medium">
            {t('profile.locale')}
          </label>
          <select
            id="locale-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('profile.theme')}</legend>
          <div className="flex gap-4">
            {(['system', 'light', 'dark'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="theme"
                  value={option}
                  checked={theme === option}
                  onChange={() => setTheme(option)}
                />
                {t(`profile.theme${option[0]!.toUpperCase()}${option.slice(1)}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={spoilerProtectionEnabled}
              onChange={(e) => setSpoilerProtectionEnabled(e.target.checked)}
            />
            {t('profile.spoilerProtection')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('profile.spoilerProtectionDescription')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={onDeckFillGaps}
              onChange={(e) => setOnDeckFillGaps(e.target.checked)}
            />
            {t('profile.onDeckFillGaps')}
          </label>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('profile.onDeckFillGapsDescription')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={updateProfile.isPending}>
            {t('profile.save')}
          </Button>
          {updateProfile.isSuccess && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('profile.saved')}</span>
          )}
        </div>
      </form>
    </Card>
  )
}
