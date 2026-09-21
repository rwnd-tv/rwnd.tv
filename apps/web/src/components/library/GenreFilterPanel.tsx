import type { GenreFilterMode, GenreFilters } from '../../lib/library-filter.js'
import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import { FilterSection } from './FilterSection.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * ShowsPage.tsx) — the card itself is the parent's job, this is just its
 * `<details>` content. A single vertical list, one row per genre present in
 * the library, each with a plus (include) and minus (exclude) icon button
 * rather than a single tri-state control — a toggle button, not a
 * checkbox, is what let each one be clicked again to fall back to "no
 * rule" while still rendering as an icon rather than a native checkbox
 * square.
 */
export function GenreFilterPanel({
  genres,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  genres: string[]
  filters: GenreFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: GenreFilters) => GenreFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(genre: string, mode: GenreFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[genre] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[genre]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[genre] = mode
      }
      return next
    })
  }

  return (
    <FilterSection title={groupLabel}>
      {/* w-fit: sizes to the widest row's natural content width (longest
          genre name + icons), so each shorter row's justify-between icons
          land close to that same right edge instead of being spread across
          the full card width. gap-3 (not gap-2): tiles IconButton's 44px
          hit-area expansion vertically with zero overlap between rows. */}
      <ul className="mt-3 flex w-fit flex-col gap-3">
        {genres.map((genre) => {
          const mode = filters[genre]
          return (
            <li key={genre} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{genre}</span>
              <IncludeExcludeToggle
                value={mode}
                onSelect={(next) => setMode(genre, next)}
                includeLabel={`${includeLabel} ${genre}`}
                excludeLabel={`${excludeLabel} ${genre}`}
              />
            </li>
          )
        })}
      </ul>
    </FilterSection>
  )
}
