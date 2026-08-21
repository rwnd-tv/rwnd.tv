import { useTranslation } from 'react-i18next'
import { formatDateTimeInput } from '../../lib/date.js'
import { Dialog } from '../ui/Dialog.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

/**
 * "Are you sure?" shown before clearing an episode's watch history (see
 * SeasonDetailPage.tsx — clicking the checkmark on an already-watched
 * episode opens this instead of unwatching immediately, since that clears
 * *every* logged play for the episode, not just one). `watchedAt` is the
 * actual list of timestamps, fetched on demand only while this dialog is
 * open (see api.library.episodeWatches) — the singular/plural copy is
 * based on its length once loaded, not on the season list's cached
 * `watchedCount`, which can disagree with the live count (e.g. right
 * after a Trakt import added a rewatch the season query hasn't refetched
 * yet) — showing "this watch" next to a list of three would be a worse
 * bug than a one-tick-late title. `watchedCountHint` is used only for the
 * instant-open title, before the real list has loaded.
 */
export function UnwatchConfirmDialog({
  open,
  watchedCountHint,
  watchedAt,
  locale,
  onConfirm,
  onCancel,
}: {
  open: boolean
  watchedCountHint: number
  watchedAt: string[] | undefined
  locale: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const isMultiple = (watchedAt?.length ?? watchedCountHint) > 1

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t(
        isMultiple
          ? 'showDetail.unwatchDialog.titleMultiple'
          : 'showDetail.unwatchDialog.titleSingle',
      )}
    >
      {watchedAt === undefined ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
          {watchedAt.map((iso) => (
            <li key={iso}>{formatDateTimeInput(new Date(iso), locale)}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('showDetail.watchDialog.cancel')}
        </Button>
        <Button type="button" variant="danger" onClick={onConfirm}>
          {t(isMultiple ? 'showDetail.unwatchDialog.removeAll' : 'showDetail.unwatchDialog.remove')}
        </Button>
      </div>
    </Dialog>
  )
}
