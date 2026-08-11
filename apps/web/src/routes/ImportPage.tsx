import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api-client.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { Card } from '../components/ui/Card.js'
import { Button } from '../components/ui/Button.js'
import { Spinner } from '../components/ui/Spinner.js'
import { TraktConnectCard } from '../components/import/TraktConnectCard.js'
import { ImportProgress } from '../components/import/ImportProgress.js'

export function ImportPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: settings, isLoading: settingsLoading } = usePublicSettings()
  const [history, setHistory] = useState(true)
  const [ratings, setRatings] = useState(true)
  const [watchlist, setWatchlist] = useState(true)

  const { data: connection } = useQuery({
    queryKey: ['import', 'trakt', 'connection'],
    queryFn: () => api.imports.connection(),
    enabled: Boolean(settings?.traktConfigured),
  })

  const { data: jobsData } = useQuery({
    queryKey: ['import', 'jobs'],
    queryFn: () => api.imports.jobs(),
    enabled: Boolean(settings?.traktConfigured),
  })
  const activeJob = jobsData?.jobs.find((j) => j.status === 'pending' || j.status === 'running')

  const startImport = useMutation({
    mutationFn: () => api.imports.start({ history, ratings, watchlist }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import', 'jobs'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    startImport.mutate()
  }

  if (settingsLoading) return <Spinner label={t('common.loading')} />

  if (!settings?.traktConfigured) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">{t('import.title')}</h1>
        <p className="text-[var(--color-fg-muted)]">{t('import.notConfigured')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('import.title')}</h1>
      <TraktConnectCard />

      {connection?.connected && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">{t('import.start.title')}</h2>
          <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
            {t('import.start.description')}
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
              />
              {t('import.start.history')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ratings}
                onChange={(e) => setRatings(e.target.checked)}
              />
              {t('import.start.ratings')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={watchlist}
                onChange={(e) => setWatchlist(e.target.checked)}
              />
              {t('import.start.watchlist')}
            </label>
            <div>
              <Button type="submit" isLoading={startImport.isPending} disabled={Boolean(activeJob)}>
                {t('import.start.submit')}
              </Button>
            </div>
            {activeJob && (
              <p className="text-sm text-[var(--color-fg-muted)]">
                {t('import.start.alreadyRunning')}
              </p>
            )}
          </form>
        </Card>
      )}

      <ImportProgress />
    </div>
  )
}
