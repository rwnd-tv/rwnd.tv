import { useTranslation } from 'react-i18next'
import { useWatchlistActions } from '../../lib/use-watchlist-actions.js'
import { Button } from '../ui/Button.js'
import { Dialog } from '../ui/Dialog.js'
import { Field } from '../ui/Field.js'

/** Bookmark glyph for the one-click Default toggle — duplicated rather than
 * shared/exported, matching this codebase's existing precedent of one small
 * icon component per file (see ShowDetailPage.tsx's CheckIcon). */
function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4a1.5 1.5 0 00-1.5 1.5v14l7.5-4.5 7.5 4.5v-14A1.5 1.5 0 0018 4H6z" />
    </svg>
  )
}

function ManageListsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6" />
    </svg>
  )
}

/**
 * The show/movie page's watchlist controls (ShowDetailPage.tsx,
 * MovieDetailPage.tsx): a one-click toggle for the Default list, matching
 * the app's other one-click precedents (Drop/Undrop, RatingPicker), plus a
 * secondary icon-only button opening a dialog to manage custom-list
 * membership — James, 2026-08-27: wanted single-click for the common case,
 * happy for the rest to need more UI. One shared component rather than
 * duplicated per page, since the markup is otherwise identical — all the
 * real logic lives in useWatchlistActions.
 */
export function WatchlistButton({
  mediaType,
  slug,
  myWatchlistIds,
}: {
  mediaType: 'show' | 'movie'
  slug: string
  myWatchlistIds: string[]
}) {
  const { t } = useTranslation()
  const {
    watchlists,
    onDefault,
    toggleDefault,
    toggleList,
    togglePending,
    dialogOpen,
    setDialogOpen,
    newListName,
    setNewListName,
    createAndAdd,
    createPending,
    createError,
  } = useWatchlistActions(mediaType, slug, myWatchlistIds)

  return (
    <>
      <Button
        variant={onDefault ? 'primary' : 'secondary'}
        type="button"
        disabled={togglePending}
        title={t(onDefault ? 'watchlist.removeTooltip' : 'watchlist.addTooltip')}
        onClick={toggleDefault}
      >
        <BookmarkIcon />
        {t('watchlist.button')}
      </Button>
      <Button
        variant="secondary"
        type="button"
        className="px-2.5 py-2.5"
        title={t('watchlist.manageTooltip')}
        aria-label={t('watchlist.manageTooltip')}
        onClick={() => setDialogOpen(true)}
      >
        <ManageListsIcon />
      </Button>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('watchlist.dialogTitle')}
      >
        <ul className="flex flex-col gap-1 text-sm">
          {watchlists.map((watchlist) => (
            <li key={watchlist.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={myWatchlistIds.includes(watchlist.id)}
                  onChange={() => toggleList(watchlist.id)}
                />
                {watchlist.name}
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-end gap-2">
          <Field
            label={t('watchlist.newListLabel')}
            hideLabel
            placeholder={t('watchlist.newListPlaceholder')}
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={newListName.trim().length === 0}
            isLoading={createPending}
            onClick={createAndAdd}
          >
            {t('watchlist.newListButton')}
          </Button>
        </div>
        {createError && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
            {t('common.somethingWentWrong')}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
