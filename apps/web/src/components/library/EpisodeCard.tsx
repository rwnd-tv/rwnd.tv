import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { SeasonEpisode } from '@rwnd/shared'
import { useAuth } from '../../lib/auth-context.js'
import { useEpisodeWatchActions } from '../../lib/use-episode-watch-actions.js'
import { WatchDateDialog } from './WatchDateDialog.js'
import { UnwatchConfirmDialog } from './UnwatchConfirmDialog.js'

/** Duplicated from CheckIcon/PlusIcon's own precedent below, not imported
 * from SpoilerGuard.tsx — EpisodeCard can't use that component directly
 * (see its own doc comment for why) but still wants the same eye glyph. */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** Icon for the icon-only "log an additional watch" button below —
 * duplicated rather than shared, matching this file's existing per-file
 * icon precedent (see CheckIcon above). */
function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/**
 * One episode tile in an episode grid — styled after Plex's own season
 * view, a still image with a checkmark toggle overlaid top-right, plus
 * (once the episode already has a watch logged) a hover-revealed "log an
 * additional watch" button to its left. Shared by SeasonDetailPage.tsx's
 * season grid and ShowDetailPage.tsx's single-season shows (see that
 * file's doc comment on why a one-season show skips the season picker
 * entirely and shows this grid straight on the show page). Its own
 * component (not inlined in the parent's .map) so it owns its own
 * `useMutation`, the same "one card, one mutation" shape SearchResultCard.tsx
 * already uses — each tile gets independent pending state instead of one
 * mutation shared/racing across the grid.
 *
 * Unwatched-episode spoiler protection (SpoilerGuard.tsx's blur, elsewhere)
 * isn't reused here for the still: SpoilerGuard's reveal control is a
 * `<button>`, and this tile's whole image area is already a `<Link>` — an
 * interactive element nested inside another isn't valid HTML. Instead the
 * blur/reveal button live as siblings of the Link (same pattern the
 * existing plus/toggle buttons already use). Unlike SpoilerGuard's own
 * full-cover overlay, the reveal button here is a small corner icon,
 * hover-revealed same as the plus button (like the toggle/plus buttons it
 * shares the tile with) rather than covering the whole image — a
 * full-cover overlay would force a "reveal, then click again" click
 * through the Link underneath just to open the episode page, which James
 * found came up often enough to be annoying. The title is
 * swapped for the generic label under the same `stillHidden` condition as
 * the image, so clicking reveal shows both together — it has no reveal
 * control of its own, but isn't independent of the still's either. See the
 * `revealed` prop for the season-wide "reveal all at once" alternative to
 * this per-tile button, e.g. for a season with too many hidden tiles to
 * reveal one at a time.
 */
export function EpisodeCard({
  episode,
  slug,
  seasonNumber,
  tmdbId,
  revealed = false,
}: {
  episode: SeasonEpisode
  slug: string
  seasonNumber: number
  tmdbId: string | null
  /** Reveals this tile even before its own per-tile button is clicked —
   * SeasonDetailPage.tsx's "reveal all episodes" control, for a season
   * with too many hidden tiles to reveal one at a time. Doesn't replace
   * the per-tile state below, just ORs with it: revealing everything here
   * doesn't stop a later individual reveal from still working the same
   * way it always has (there's nothing to "un-reveal" this from). Left
   * unset (false) for ShowDetailPage.tsx's own single-season grid, which
   * has no such control. */
  revealed?: boolean
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'
  const [stillRevealed, setStillRevealed] = useState(false)
  const {
    dialogOpen,
    setDialogOpen,
    logAdditionalWatchOpen,
    setLogAdditionalWatchOpen,
    unwatchConfirmOpen,
    setUnwatchConfirmOpen,
    watchesData,
    markWatched,
    unwatch,
    notAiredYet,
    toggleDisabled,
  } = useEpisodeWatchActions(slug, seasonNumber, episode, tmdbId)

  const episodeLabel = t('import.progress.episode', { number: episode.episodeNumber })
  const spoilerHidden = Boolean(user?.spoilerProtectionEnabled) && !episode.watched
  const stillHidden = spoilerHidden && !stillRevealed && !revealed
  const displayTitle = stillHidden ? episodeLabel : (episode.title ?? episodeLabel)
  const toggleLabel = t(episode.watched ? 'showDetail.markUnwatched' : 'showDetail.markWatched')
  const toggleTitle =
    !episode.watched && notAiredYet ? t('showDetail.episodeNotAiredYet') : toggleLabel

  return (
    <li className="flex flex-col gap-2">
      <div
        className="group relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--color-surface)]"
        title={spoilerHidden ? undefined : (episode.overview ?? undefined)}
      >
        <Link
          to={`/shows/${slug}/season/${seasonNumber}/episode/${episode.episodeNumber}`}
          className="absolute inset-0"
          aria-label={displayTitle}
        >
          <div className={stillHidden ? 'h-full w-full select-none blur-md' : 'h-full w-full'}>
            {episode.stillPath ? (
              <img
                src={episode.stillPath}
                alt=""
                loading="lazy"
                decoding="async"
                width={300}
                height={169}
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-full items-center justify-center text-xl font-semibold text-[var(--color-fg-muted)]"
              >
                {episode.episodeNumber}
              </div>
            )}
          </div>
        </Link>
        {stillHidden && (
          <button
            type="button"
            title={t('spoiler.reveal')}
            aria-label={t('spoiler.reveal')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setStillRevealed(true)
            }}
            className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/70 bg-black/40 text-white/90 opacity-0 transition-opacity hover:bg-black/60 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <EyeIcon />
          </button>
        )}
        {episode.watched && (
          <button
            type="button"
            disabled={unwatch.isPending || markWatched.isPending || !tmdbId}
            title={t('showDetail.addWatchTooltip.episode')}
            aria-label={t('showDetail.addWatchTooltip.episode')}
            onClick={() => setLogAdditionalWatchOpen(true)}
            className="absolute right-11 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/70 bg-black/40 text-white/90 opacity-0 transition-opacity hover:bg-black/60 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-60 group-hover:opacity-100"
          >
            <PlusIcon />
          </button>
        )}
        <button
          type="button"
          aria-pressed={episode.watched}
          aria-label={toggleTitle}
          title={toggleTitle}
          disabled={toggleDisabled}
          onClick={() => (episode.watched ? setUnwatchConfirmOpen(true) : setDialogOpen(true))}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            episode.watched
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
              : 'border-white/70 bg-black/40 text-white/90 hover:bg-black/60'
          }`}
        >
          {episode.watchedCount > 1 ? (
            <span className="text-xs font-semibold" aria-hidden="true">
              {episode.watchedCount}
            </span>
          ) : (
            <CheckIcon />
          )}
        </button>
      </div>
      <div>
        <h3 className="truncate text-sm font-medium">
          <Link
            to={`/shows/${slug}/season/${seasonNumber}/episode/${episode.episodeNumber}`}
            title={displayTitle}
            className="hover:underline"
          >
            {displayTitle}
          </Link>
        </h3>
        <p className="text-xs text-[var(--color-fg-muted)]">{episodeLabel}</p>
        {episode.watchedCount > 1 && (
          <p className="text-xs text-[var(--color-fg-muted)]">
            {t('showDetail.episodeWatchedCount', { count: episode.watchedCount })}
          </p>
        )}
      </div>

      <WatchDateDialog
        open={dialogOpen}
        episodeLabel={episodeLabel}
        episode={{
          title: episode.title,
          runtimeMinutes: episode.runtimeMinutes,
          firstAired: episode.firstAired,
        }}
        locale={locale}
        onConfirm={(watchedAt) => {
          markWatched.mutate(watchedAt)
          setDialogOpen(false)
        }}
        onCancel={() => setDialogOpen(false)}
      />

      <WatchDateDialog
        open={logAdditionalWatchOpen}
        episodeLabel={episodeLabel}
        episode={{
          title: episode.title,
          runtimeMinutes: episode.runtimeMinutes,
          firstAired: episode.firstAired,
        }}
        locale={locale}
        disableUnknown={episode.hasUnknownWatch}
        onConfirm={(watchedAt) => {
          markWatched.mutate(watchedAt)
          setLogAdditionalWatchOpen(false)
        }}
        onCancel={() => setLogAdditionalWatchOpen(false)}
      />

      <UnwatchConfirmDialog
        open={unwatchConfirmOpen}
        watchedCountHint={episode.watchedCount}
        watches={watchesData?.watches}
        locale={locale}
        onConfirm={(ids) => unwatch.mutate(ids)}
        onCancel={() => setUnwatchConfirmOpen(false)}
      />
    </li>
  )
}
