import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaySource } from '@rwnd/shared'
import { UNKNOWN_WATCHED_AT, formatHistoryDate } from '../../lib/date.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { Spinner } from '../ui/Spinner.js'

interface WatchHistoryRow {
  id: string
  watchedAt: string
  source: PlaySource
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string | null
}

interface WatchHistoryTableProps {
  /** `undefined` while the watches query is still loading — same "only
   * fetch once there's a watch to show" gate every caller already applies
   * before rendering this at all. */
  watches: WatchHistoryRow[] | undefined
  showSeasonColumn: boolean
  showEpisodeColumn: boolean
  locale: string
  isDeleting: boolean
  /**
   * Unifies the two delete-mutation shapes across the 4 callers: Show/
   * Season pass a dedicated bulk-delete mutation's `.mutate`, Movie/Episode
   * reuse their watch-actions hook's `unwatch.mutate`. Takes an explicit
   * `onSuccess` rather than returning a promise so either shape can just
   * forward it as the mutation call's own per-call `onSuccess` — the
   * mutation's own (cache-invalidation) onSuccess still runs first; this
   * one only needs to close the dialog and clear selection, which is state
   * this component owns rather than the caller.
   */
  onDeleteSelected: (ids: string[], onSuccess: () => void) => void
}

/**
 * The collapsible "History" table repeated identically on all 4 detail
 * pages (show/season/movie/episode) — a checkbox/date/time/source table
 * plus a delete-selected confirmation dialog, varying only in which of the
 * Season/Episode columns apply and how the delete itself is wired (see
 * onDeleteSelected above).
 */
export function WatchHistoryTable({
  watches,
  showSeasonColumn,
  showEpisodeColumn,
  locale,
  isDeleting,
  onDeleteSelected,
}: WatchHistoryTableProps) {
  const { t } = useTranslation()
  const [selectedWatchIds, setSelectedWatchIds] = useState<Set<string>>(new Set())
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false)

  function toggleWatchSelected(id: string) {
    setSelectedWatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDeleteConfirmed() {
    onDeleteSelected([...selectedWatchIds], () => {
      setDeleteSelectedConfirmOpen(false)
      setSelectedWatchIds(new Set())
    })
  }

  return (
    <>
      {/* Native <details>/<summary> — closed by default, no extra state to
          manage for the disclosure itself. */}
      <details>
        <summary className="cursor-pointer text-lg font-semibold">
          {t('showDetail.historyTable.title')}
        </summary>
        {watches === undefined ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="max-w-2xl overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[var(--color-fg-muted)]">
                    <th className="w-8 py-1.5" />
                    {showSeasonColumn && (
                      <th className="py-1.5 pr-4 font-medium">
                        {t('showDetail.historyTable.seasonColumn')}
                      </th>
                    )}
                    {showEpisodeColumn && (
                      <th className="py-1.5 pr-4 font-medium">
                        {t('showDetail.historyTable.episodeColumn')}
                      </th>
                    )}
                    <th className="py-1.5 pr-4 font-medium">
                      {t('showDetail.historyTable.dateColumn')}
                    </th>
                    <th className="py-1.5 pr-4 font-medium">
                      {t('showDetail.historyTable.timeColumn')}
                    </th>
                    <th className="py-1.5 font-medium">
                      {t('showDetail.historyTable.typeColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {watches.map((watch) => {
                    const isUnknown = watch.watchedAt === UNKNOWN_WATCHED_AT
                    const watchedAt = new Date(watch.watchedAt)
                    return (
                      <tr key={watch.id} className="border-t border-[var(--color-border)]">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={selectedWatchIds.has(watch.id)}
                            onChange={() => toggleWatchSelected(watch.id)}
                            aria-label={t('showDetail.unwatchDialog.remove')}
                          />
                        </td>
                        {showSeasonColumn && (
                          <td className="py-2 pr-4">
                            {watch.seasonNumber === 0
                              ? t('showDetail.specials')
                              : t('import.progress.season', { number: watch.seasonNumber })}
                          </td>
                        )}
                        {showEpisodeColumn && (
                          <td className="py-2 pr-4">
                            {watch.episodeTitle ??
                              t('import.progress.episode', { number: watch.episodeNumber })}
                          </td>
                        )}
                        <td className="py-2 pr-4">
                          {isUnknown
                            ? t('history.unknownDate')
                            : formatHistoryDate(watchedAt, locale, t)}
                        </td>
                        <td className="py-2 pr-4">
                          {isUnknown
                            ? ''
                            : watchedAt.toLocaleTimeString(locale, {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                        </td>
                        <td className="py-2">{t(`history.sourceLabel.${watch.source}`)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="danger"
              className="w-fit"
              disabled={selectedWatchIds.size === 0}
              onClick={() => setDeleteSelectedConfirmOpen(true)}
            >
              {t('showDetail.historyTable.deleteSelectedWatches')}
            </Button>
          </div>
        )}
      </details>

      <Dialog
        open={deleteSelectedConfirmOpen}
        onClose={() => setDeleteSelectedConfirmOpen(false)}
        title={t('showDetail.unwatchDialog.titleSelected')}
      >
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDeleteSelectedConfirmOpen(false)}
          >
            {t('showDetail.watchDialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            isLoading={isDeleting}
            onClick={handleDeleteConfirmed}
          >
            {t('showDetail.unwatchDialog.removeSelected')}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
