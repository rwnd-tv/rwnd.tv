import type { ReactNode } from 'react'

/**
 * The card a "Filters…" button expands under the filter/sort row (see
 * ShowsPage.tsx). Holds one or more collapsible `<details>` sections
 * (GenreFilterPanel, ReleaseYearFilterPanel, …) stacked vertically — the
 * card itself is the only thing that spans the full page width, matching
 * every other full-bleed control on this page; each section inside sizes
 * to its own content instead.
 */
export function FiltersPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}
