import type { ActivityEntry } from '@rwnd/shared'
import { PosterTile } from './PosterTile.js'

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M12 2l2.9 6.6 7.1.6-5.4 4.8 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.8 7.1-.6L12 2Z" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  )
}

function DroppedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  )
}

const KIND_ICONS: Record<ActivityEntry['kind'], () => React.JSX.Element> = {
  watch: EyeIcon,
  rating: StarIcon,
  watchlist: BookmarkIcon,
  dropped: DroppedIcon,
}

/** Where an entry links to. A *watch* or *rating* entry for an episode
 * links straight to that episode's own page — both are naturally about one
 * specific thing, matching the Dashboard's History row (HistoryRow.tsx) and
 * RatingPicker.tsx's own display. A *watchlist* or *dropped* entry for an
 * episode still links to the show's page instead: those are about following
 * the show as a whole, not one episode. `undefined` for an entry with no
 * detail page to send the user to (a media row that predates showSlug/
 * movieSlug existing). */
function activityHref(entry: ActivityEntry): string | undefined {
  const { media } = entry
  if (media.type === 'movie') return media.movieSlug ? `/movies/${media.movieSlug}` : undefined
  if (!media.showSlug) return undefined
  if (
    (entry.kind === 'watch' || entry.kind === 'rating') &&
    media.type === 'episode' &&
    media.seasonNumber !== undefined &&
    media.episodeNumber !== undefined
  ) {
    return `/shows/${media.showSlug}/season/${media.seasonNumber}/episode/${media.episodeNumber}`
  }
  return `/shows/${media.showSlug}`
}

/**
 * One tile in the Activity page's grid (HistoryPage.tsx) — wraps
 * PosterTile.tsx with a selection checkbox and a kind-specific caption
 * (when it happened, and for a rating/watchlist/dropped entry, what that
 * action was), so a watch, a rating, a watchlist add and a drop all render
 * through the same tile shape ShowsPage.tsx/MoviesPage.tsx already use.
 */
export function ActivityTile({
  entry,
  title,
  caption,
  selected,
  onToggleSelect,
  selectAriaLabel,
}: {
  entry: ActivityEntry
  /** Built by the caller (HistoryPage.tsx), which has the locale/
   * translation context this component doesn't — the show title + episode
   * label for an episode entry, or the show/movie's own title otherwise. */
  title: string
  /** Kind-specific secondary line — same reasoning as `title`. */
  caption: string
  selected: boolean
  onToggleSelect: () => void
  selectAriaLabel: string
}) {
  const Icon = KIND_ICONS[entry.kind]

  return (
    <PosterTile
      title={title}
      year={null}
      posterPath={entry.media.posterPath}
      to={activityHref(entry)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1 truncate text-xs text-[var(--color-fg-muted)]">
          <Icon />
          <span className="truncate">{caption}</span>
        </p>
        <label className="flex shrink-0 items-center">
          <span className="sr-only">{selectAriaLabel}</span>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
      </div>
    </PosterTile>
  )
}
