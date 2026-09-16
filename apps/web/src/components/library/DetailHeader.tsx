import type { ReactNode } from 'react'

/**
 * Shared poster/still-plus-text-column layout for the four detail pages
 * (ShowDetailPage, SeasonDetailPage, MovieDetailPage, EpisodeDetailPage) —
 * extracted from four independently-copied blocks (M4 review's
 * `/code-review high` pass, docs/TODO.md) that had already drifted apart on
 * breakpoint (`sm:` vs `lg:`) without a behavioral reason.
 *
 * `sm:items-start`/`lg:items-start` is load-bearing, not decorative: flex's
 * default `align-items: stretch` would otherwise force the media box to
 * match the text column's height once they sit side by side, distorting a
 * poster's real crop or, for a 16:9 still, cropping it to fill a stretched
 * box instead of its true aspect ratio (surfaced 2026-08-31 on
 * ShowDetailPage.tsx: the poster box visibly grew whenever a "Refreshed."
 * success line added an extra line of height to the text column).
 *
 * `breakpoint` is intentionally still a prop, not unified: Show/Season
 * switch to a row layout at `sm:`, Movie/Episode at `lg:` (the latter pair
 * needs more width before a full-height image comfortably fits next to the
 * text column). That inconsistency predates this extraction and is left
 * for M5's mobile/responsive pass to resolve as a deliberate decision, not
 * a side effect of this cleanup.
 */
export function DetailHeader({
  breakpoint,
  media,
  children,
}: {
  breakpoint: 'sm' | 'lg'
  media: ReactNode
  children: ReactNode
}) {
  const rowClass = breakpoint === 'sm' ? 'sm:flex-row sm:items-start' : 'lg:flex-row lg:items-start'

  return (
    <div className={`flex flex-col gap-6 ${rowClass}`}>
      {media}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  )
}
