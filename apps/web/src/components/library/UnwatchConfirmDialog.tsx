import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Watches } from '@rwnd/shared'
import { UNKNOWN_WATCHED_AT, formatDateTimeInput } from '../../lib/date.js'
import { Dialog } from '../ui/Dialog.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

/**
 * "Are you sure?" shown before clearing some or all of an episode's or
 * movie's watch history (see SeasonDetailPage.tsx/MovieDetailPage.tsx —
 * clicking the checkmark on an already-watched episode/movie opens this
 * instead of unwatching immediately, since it can clear more than one
 * logged play at once). Each watch has its own tick box, ticked by
 * default, so the user can remove just some of them rather than only ever
 * clearing everything. `watches` is the actual list, fetched on demand
 * only while this dialog is open (see api.library.episodeWatches/
 * movieWatches) — the singular/plural copy is based on its length once
 * loaded, not the caller's own cached `watchedCount`, which can disagree
 * with the live count (e.g. right after a Trakt import added a rewatch the
 * caller's query hasn't refetched yet) — showing "this watch" next to a
 * list of three would be a worse bug than a one-tick-late title.
 * `watchedCountHint` is used only for the instant-open title, before the
 * real list has loaded.
 */
export function UnwatchConfirmDialog({
  open,
  watchedCountHint,
  watches,
  locale,
  onConfirm,
  onCancel,
}: {
  open: boolean
  watchedCountHint: number
  watches: Watches['watches'] | undefined
  locale: string
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Whether this open has already had its "every watch ticked" default
  // applied — guards the effect below so a background refetch mid-dialog
  // (react-query's data can re-resolve to a new array reference even for
  // unchanged rows, e.g. if two watches share an identical `watchedAt`
  // and the DB doesn't return ties in a stable order — see the GET
  // route's doc comment in apps/api/src/routes/library.ts) can't silently
  // wipe out ticks the user already unchecked.
  const initializedForOpenRef = useRef(false)

  // Reset to "every watch ticked" once per fresh open, as soon as the
  // list is available — this dialog stays mounted across opens (see
  // Dialog.tsx's <dialog> not unmounting on close), so a partial
  // selection left over from a previous open-then-cancel would otherwise
  // leak into the next one. Deliberately does NOT re-run just because
  // `watches` changed while already open.
  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false
      return
    }
    if (watches && !initializedForOpenRef.current) {
      setSelectedIds(new Set(watches.map((w) => w.id)))
      initializedForOpenRef.current = true
    }
  }, [open, watches])

  const totalCount = watches?.length ?? watchedCountHint
  const isMultipleTotal = totalCount > 1
  const allSelected = watches !== undefined && selectedIds.size === watches.length

  const title = !isMultipleTotal
    ? t('showDetail.unwatchDialog.titleSingle')
    : allSelected
      ? t('showDetail.unwatchDialog.titleMultiple')
      : t('showDetail.unwatchDialog.titleSelected')

  const removeLabel = !isMultipleTotal
    ? t('showDetail.unwatchDialog.remove')
    : allSelected
      ? t('showDetail.unwatchDialog.removeAll')
      : t('showDetail.unwatchDialog.removeSelected')

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      {watches === undefined ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
          {watches.map((watch) => (
            <li key={watch.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.has(watch.id)}
                  onChange={() => toggle(watch.id)}
                />
                {watch.watchedAt === UNKNOWN_WATCHED_AT
                  ? t('history.unknownDate')
                  : formatDateTimeInput(new Date(watch.watchedAt), locale)}
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('showDetail.watchDialog.cancel')}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={selectedIds.size === 0}
          onClick={() => onConfirm([...selectedIds])}
        >
          {removeLabel}
        </Button>
      </div>
    </Dialog>
  )
}
