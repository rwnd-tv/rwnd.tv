import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Button } from '../ui/Button.js'

// Kept in sync with apps/api/src/routes/imports.ts's own limit — checked
// client-side too so an oversized file is rejected instantly rather than
// after a round trip.
const MAX_ZIP_BYTES = 25 * 1024 * 1024

/**
 * Round-trip import for rwnd.tv's own data export (Settings > Database >
 * Export data, DatabasePanel.tsx) — uploads the same zip that button
 * produces. Near-identical to TraktZipImportCard.tsx (same file-picker/
 * validation/checkbox-form shape), duplicated rather than shared since the
 * two differ in every string and in which api.imports method they call —
 * not worth a shared component for this little logic. Shown unconditionally
 * (ImportPage.tsx), same reasoning as the Trakt ZIP card: needs no external
 * service configured on this instance at all.
 */
export function CsvImportCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [history, setHistory] = useState(true)
  const [ratings, setRatings] = useState(true)
  const [watchlist, setWatchlist] = useState(true)
  const [dropped, setDropped] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: jobsData } = useQuery({
    queryKey: ['import', 'jobs'],
    queryFn: () => api.imports.jobs(),
  })
  const activeJob = jobsData?.jobs.find((j) => j.status === 'pending' || j.status === 'running')

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('No file selected')
      return api.imports.uploadCsv(file, { history, ratings, watchlist, dropped })
    },
    onSuccess: () => {
      setFile(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['import', 'jobs'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong')),
  })

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    // Always cleared, even on a rejected file — otherwise re-selecting that
    // same (still-invalid) file wouldn't fire another change event.
    e.target.value = ''
    if (!selected) return
    setError(null)
    if (!selected.name.toLowerCase().endsWith('.zip')) {
      setError(t('import.csv.invalidType'))
      return
    }
    if (selected.size > MAX_ZIP_BYTES) {
      setError(t('import.csv.tooLarge'))
      return
    }
    setFile(selected)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    upload.mutate()
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{t('import.csv.title')}</h2>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">{t('import.csv.description')}</p>

      <h3 className="mb-1 text-sm font-semibold">{t('import.csv.chooseStepTitle')}</h3>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
          {t('import.csv.chooseFile')}
        </Button>
        <span className="truncate text-sm text-[var(--color-fg-muted)]">
          {file ? file.name : t('import.csv.noFileChosen')}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>

      {file && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <h3 className="mb-1 text-sm font-semibold">{t('import.start.title')}</h3>
          <p className="mb-3 text-sm text-[var(--color-fg-muted)]">
            {t('import.csv.startDescription')}
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dropped}
                onChange={(e) => setDropped(e.target.checked)}
              />
              {t('import.start.dropped')}
            </label>
            <div>
              <Button type="submit" isLoading={upload.isPending} disabled={Boolean(activeJob)}>
                {t('import.start.submit')}
              </Button>
            </div>
            {activeJob && (
              <p className="text-sm text-[var(--color-fg-muted)]">
                {t('import.start.alreadyRunning')}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}
          </form>
        </div>
      )}
    </Card>
  )
}
