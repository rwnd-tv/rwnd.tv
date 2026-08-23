import type { ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * One tile in a gallery grid (ShowsPage.tsx, MoviesPage.tsx). The fixed
 * `aspect-[2/3]` box (TMDB's w342 posters are exactly 342×513, a 2:3
 * ratio) is what reserves layout space *before* any image has loaded —
 * that, combined with native `loading="lazy"`, is what makes the whole
 * grid scrollable and interactive immediately rather than waiting on
 * images, the way Plex's own library view behaves.
 */
export function PosterTile({
  title,
  year,
  posterPath,
  to,
  grayscale,
  className = '',
  children,
}: {
  title: string
  year: number | null
  posterPath: string | null
  /** When set, the poster + title link to a detail page (e.g. ShowDetailPage) —
   * omit it for tiles that don't have one yet (MoviesPage's movies). */
  to?: string
  /** Dims the artwork to greyscale — ShowsPage.tsx uses this for dropped
   * shows, gallery-only (the show's own detail page renders its poster
   * separately, not through this component, so dropping never affects it). */
  grayscale?: boolean
  /** Extra classes on the outer `<li>` — PosterGrid.tsx's own grid columns
   * size regular gallery tiles, so this is normally unused there; a
   * horizontally-scrolling row (DashboardPage.tsx's On Deck) needs a fixed
   * tile width instead, since nothing else constrains it. */
  className?: string
  /** Secondary content under the title — a progress bar, a play count, etc. */
  children?: ReactNode
}) {
  const poster = (
    <>
      <div
        className={`aspect-[2/3] w-full overflow-hidden rounded-lg bg-[var(--color-surface)] ${grayscale ? 'grayscale' : ''}`}
      >
        {posterPath ? (
          <img
            src={posterPath}
            // Decorative: the title is already right below as visible text,
            // so a repeated alt would just be screen-reader noise — same
            // reasoning as SearchResultCard.tsx and HistoryPage.tsx.
            alt=""
            loading="lazy"
            decoding="async"
            width={342}
            height={513}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full items-center justify-center text-2xl font-semibold text-[var(--color-fg-muted)]"
          >
            {title.charAt(0)}
          </div>
        )}
      </div>
      <div>
        <h2 className="truncate text-sm font-medium" title={title}>
          {title}
        </h2>
        {year !== null && <p className="text-xs text-[var(--color-fg-muted)]">{year}</p>}
      </div>
    </>
  )

  return (
    <li className={`flex flex-col gap-2 ${className}`}>
      {to ? (
        <Link to={to} className="flex flex-col gap-2 rounded-lg">
          {poster}
        </Link>
      ) : (
        poster
      )}
      {children}
    </li>
  )
}
