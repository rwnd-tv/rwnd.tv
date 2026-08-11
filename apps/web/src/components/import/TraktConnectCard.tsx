import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

const CONNECTION_QUERY_KEY = ['import', 'trakt', 'connection']

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
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t('import.trakt.title')}</h2>
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
      </Card>
    )
  }

  if (connection?.pairing) {
    const { pairing } = connection
    return (
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t('import.trakt.title')}</h2>
        {pairing.status === 'pending' ? (
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
        )}
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{t('import.trakt.title')}</h2>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('import.trakt.description')}</p>
      <Button onClick={() => startPairing.mutate()} isLoading={startPairing.isPending}>
        {t('import.trakt.connect')}
      </Button>
    </Card>
  )
}
