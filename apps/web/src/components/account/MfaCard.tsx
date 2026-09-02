import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'react-qr-code'
import { api, ApiError } from '../../lib/api-client.js'
import { usePublicSettings } from '../../lib/use-public-settings.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'
import { ChevronDownIcon } from '../icons.js'
import { usePanelOpen } from '../../lib/use-panel-open.js'

type View = 'idle' | 'enrolling' | 'recovery-codes' | 'disabling' | 'regenerating'

/**
 * TOTP MFA (M3 security review follow-up, ASVS V4.3.1, docs/TODO.md) —
 * opt-in for any user, not admin-only, even though the finding that
 * surfaced this was about admin accounts specifically: the same code path
 * benefits anyone on a shared instance, and there's no reason to gate the
 * option itself by role. Self-gates on `mfaAvailable` (whether this
 * instance has ENCRYPTION_KEY configured) the same way DatabasePanel.tsx
 * self-gates a section on `backupsConfigured` — hides the whole card when
 * unavailable rather than letting someone start enrolling into a feature
 * that'll fail on confirmation, mirrored by InvitesPanel.tsx's full-card
 * self-gating on `registrationMode`. Collapsed by default like every
 * other card on this page as of 2026-09-02 — see
 * AdvancedPreferencesCard.tsx's doc comment for why `<details>` over a
 * bespoke show/hide component.
 */
export function MfaCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: publicSettings } = usePublicSettings()
  const [open, setOpen] = usePanelOpen('panelAccountMfa')

  const [view, setView] = useState<View>('idle')
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string }>()
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>()
  const [code, setCode] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string>()

  const { data: status, isLoading } = useQuery({
    queryKey: ['mfa', 'status'],
    queryFn: () => api.mfa.status(),
    enabled: publicSettings?.mfaAvailable === true,
  })

  function resetForm() {
    setCode('')
    setCurrentPassword('')
    setError(undefined)
  }

  const startEnroll = useMutation({
    mutationFn: () => api.mfa.enroll(),
    onSuccess: (data) => {
      setEnrollment(data)
      setView('enrolling')
      resetForm()
    },
  })

  const confirmEnroll = useMutation({
    mutationFn: () => api.mfa.confirm(code),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes)
      setView('recovery-codes')
      void queryClient.invalidateQueries({ queryKey: ['mfa', 'status'] })
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? t('account.mfaEnrollError') : t('common.somethingWentWrong'),
      ),
  })

  const disable = useMutation({
    mutationFn: () => api.mfa.disable({ currentPassword, code }),
    onSuccess: () => {
      setView('idle')
      resetForm()
      void queryClient.invalidateQueries({ queryKey: ['mfa', 'status'] })
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? t('account.mfaDisableError') : t('common.somethingWentWrong'),
      ),
  })

  const regenerate = useMutation({
    mutationFn: () => api.mfa.regenerateRecoveryCodes({ currentPassword, code }),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes)
      setView('recovery-codes')
      resetForm()
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? t('account.mfaDisableError') : t('common.somethingWentWrong'),
      ),
  })

  if (!publicSettings) return null
  if (!publicSettings.mfaAvailable) {
    return (
      <Card>
        <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {t('account.mfaTitle')}
            <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />
          <p className="text-sm text-[var(--color-fg-muted)]">{t('account.mfaUnavailable')}</p>
        </details>
      </Card>
    )
  }

  function handleConfirm(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    confirmEnroll.mutate()
  }

  function handleDisable(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    disable.mutate()
  }

  function handleRegenerate(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    regenerate.mutate()
  }

  return (
    <Card>
      <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-lg font-semibold [&::-webkit-details-marker]:hidden">
          {t('account.mfaTitle')}
          <ChevronDownIcon className="h-5 w-5 flex-shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 mb-4 border-t border-[var(--color-border)]" />

        {isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : view === 'recovery-codes' && recoveryCodes ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t('account.mfaRecoveryCodesTitle')}</p>
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('account.mfaRecoveryCodesDescription')}
            </p>
            <ul className="grid grid-cols-2 gap-1 rounded-md bg-[var(--color-surface)] p-3 font-mono text-sm">
              {recoveryCodes.map((rc) => (
                <li key={rc}>{rc}</li>
              ))}
            </ul>
            <div>
              <Button
                type="button"
                onClick={() => {
                  setRecoveryCodes(undefined)
                  setView('idle')
                }}
              >
                {t('account.mfaRecoveryCodesDone')}
              </Button>
            </div>
          </div>
        ) : view === 'enrolling' && enrollment ? (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-fg-muted)]">{t('account.mfaEnrollScan')}</p>
            <div className="w-fit rounded-md bg-white p-3">
              <QRCode value={enrollment.otpauthUri} size={160} />
            </div>
            <code className="block w-fit rounded-md bg-[var(--color-surface)] px-2 py-1 text-sm">
              {enrollment.secret}
            </code>
            <Field
              label={t('account.mfaEnrollCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              error={error}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" isLoading={confirmEnroll.isPending}>
                {t('account.mfaEnrollConfirm')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEnrollment(undefined)
                  setView('idle')
                  resetForm()
                }}
              >
                {t('account.mfaEnrollCancel')}
              </Button>
            </div>
          </form>
        ) : view === 'disabling' ? (
          <form onSubmit={handleDisable} className="flex flex-col gap-4">
            <Field
              label={t('account.mfaDisablePassword')}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <Field
              label={t('account.mfaDisableCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              error={error}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="danger" isLoading={disable.isPending}>
                {t('account.mfaDisableSubmit')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setView('idle')
                  resetForm()
                }}
              >
                {t('account.mfaDisableCancel')}
              </Button>
            </div>
          </form>
        ) : view === 'regenerating' ? (
          <form onSubmit={handleRegenerate} className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-fg-muted)]">
              {t('account.mfaRegenerateDescription')}
            </p>
            <Field
              label={t('account.mfaDisablePassword')}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <Field
              label={t('account.mfaDisableCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              error={error}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" isLoading={regenerate.isPending}>
                {t('account.mfaRegenerateSubmit')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setView('idle')
                  resetForm()
                }}
              >
                {t('account.mfaDisableCancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--color-fg-muted)]">{t('account.mfaDescription')}</p>
            <p className="text-sm font-medium">
              {status?.enabled ? t('account.mfaEnabled') : t('account.mfaDisabledStatus')}
            </p>
            <div className="flex items-center gap-3">
              {status?.enabled ? (
                <>
                  <Button type="button" variant="danger" onClick={() => setView('disabling')}>
                    {t('account.mfaDisable')}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setView('regenerating')}>
                    {t('account.mfaRegenerate')}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={() => startEnroll.mutate()}
                  isLoading={startEnroll.isPending}
                >
                  {t('account.mfaEnable')}
                </Button>
              )}
            </div>
          </div>
        )}
      </details>
    </Card>
  )
}
