import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

const CONNECTION_QUERY_KEY = ['import', 'trakt', 'connection']

/**
 * Connection status + action for the OAuth device flow only — no Card or
 * heading of its own. ImportPage.tsx wraps this together with the "Start an
 * import" controls in one card under a shared "Import from a Trakt account"
 * title (grouped there 2026-08-25 to sit alongside TraktZipImportCard's own
 * "Import from a Trakt export file" card as two parallel options), so this
 * only ever renders its own state-specific body.
 */
export function TraktConnectCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: connection, isLoading } = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () => api.imports.connection(),
    // Only worth polling while a pairing is actually in flight — once it
    // resolves (connected, denied, or expired) there's nothing left to wait on.
    refetchInterval: (query) => (query.state.data?.pairing?.status === 'pending' ? 1500 : false),
  })

  const startPairing = useMutation({
    mutationFn: () => api.imports.startPairing(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY }),
  })

  const disconnect = useMutation({
    mutationFn: () => api.imports.disconnect(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY }),
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (connection?.connected) {
    return (
      <>
        <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
          {t('import.trakt.connectedAs', { username: connection.username })}
        </p>
        <Button
          variant="secondary"
          onClick={() => disconnect.mutate()}
          isLoading={disconnect.isPending}
        >
          {t('import.trakt.disconnect')}
        </Button>
      </>
    )
  }

  if (connection?.pairing) {
    const { pairing } = connection
    return pairing.status === 'pending' ? (
      <>
        <p className="mb-2 text-sm">{t('import.trakt.pairingInstructions')}</p>
        <p className="mb-2 font-mono text-2xl tracking-widest">{pairing.userCode}</p>
        <a
          href={pairing.verificationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[var(--color-primary)] underline"
        >
          {pairing.verificationUrl}
        </a>
      </>
    ) : (
      <>
        <p className="mb-4 text-sm text-[var(--color-danger)]">
          {t(pairing.status === 'denied' ? 'import.trakt.denied' : 'import.trakt.expired')}
        </p>
        <Button onClick={() => startPairing.mutate()} isLoading={startPairing.isPending}>
          {t('import.trakt.retryPairing')}
        </Button>
      </>
    )
  }

  return (
    <Button onClick={() => startPairing.mutate()} isLoading={startPairing.isPending}>
      {t('import.trakt.connect')}
    </Button>
  )
}
