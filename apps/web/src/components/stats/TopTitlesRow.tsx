import type { ReactNode } from 'react'
import { PosterTile } from '../library/PosterTile.js'

interface TopTitleItem {
  slug: string
  title: string
  year: number | null
  posterPath: string | null
}

/**
 * "Top Shows" / "Top Movies" on StatsPage.tsx — a horizontally-scrolling
 * poster row, same shape as DashboardPage's On Deck row
 * (components/library/OnDeckRow.tsx): a flex row with `overflow-x-auto`
 * rather than PosterGrid's wrapping grid, and no `<h1>`/empty state of its
 * own — renders nothing at all when `items` is empty (the page-level empty
 * state, if any, is StatsPage.tsx's job, not this component's), consistent
 * with OnDeckRow's own reasoning for the same choice.
 */
export function TopTitlesRow<T extends TopTitleItem>({
  title,
  items,
  linkPrefix,
  renderSecondary,
}: {
  title: string
  items: T[]
  /** '/shows' or '/movies' — each item's slug is appended to this. */
  linkPrefix: string
  renderSecondary: (item: T) => ReactNode
}) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {items.map((item) => (
          <PosterTile
            key={item.slug}
            title={item.title}
            year={item.year}
            posterPath={item.posterPath}
            to={`${linkPrefix}/${item.slug}`}
            className="w-40 flex-shrink-0"
          >
            <p className="text-xs text-[var(--color-fg-muted)]">{renderSecondary(item)}</p>
          </PosterTile>
        ))}
      </ul>
    </div>
  )
}
