import type { ReactNode } from 'react'

/**
 * Shared poster/still-plus-text-column layout for the four detail pages
 * (ShowDetailPage, SeasonDetailPage, MovieDetailPage, EpisodeDetailPage) —
 * extracted from four independently-copied blocks (M4 review's
 * `/code-review high` pass, docs/TODO.md) that had already drifted apart on
 * breakpoint (`sm:` vs `lg:`) without a behavioral reason.
 *
 * `lg:items-start` is load-bearing, not decorative: flex's default
 * `align-items: stretch` would otherwise force the media box to match the
 * text column's height once they sit side by side, distorting a poster's
 * real crop or, for a 16:9 still, cropping it to fill a stretched box
 * instead of its true aspect ratio (surfaced 2026-08-31 on
 * ShowDetailPage.tsx: the poster box visibly grew whenever a "Refreshed."
 * success line added an extra line of height to the text column).
 *
 * Standardised on `lg:` for all four pages by M5's mobile/responsive pass
 * (2026-09-21): Show/Season used to switch to a row layout at `sm:` (640px)
 * while Movie/Episode waited for `lg:` (1024px), inherited unresolved from
 * the four originally-independent blocks. At `sm:`, Show's six-button
 * action row was squeezed into a narrower text column from 640px up, a band
 * the mobile audit never tested — `lg:` gives every page's action row the
 * full column width until there's genuinely enough room for the media box
 * beside it.
 */
export function DetailHeader({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {media}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  )
}
