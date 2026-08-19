import type { ReactNode } from 'react'

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
  children,
}: {
  title: string
  year: number | null
  posterPath: string | null
  /** Secondary content under the title — a progress bar, a play count, etc. */
  children?: ReactNode
}) {
  return (
    <li className="flex flex-col gap-2">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-[var(--color-surface)]">
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
      {children}
    </li>
  )
}
