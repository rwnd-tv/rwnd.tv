import type { StatusFilterMode, StatusFilters } from '../../lib/library-filter.js'
import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * ShowsPage.tsx) — same shape as GenreFilterPanel.tsx (a vertical list, each
 * row with an include/exclude icon toggle), but over `shows.status` (a
 * single value per show, e.g. "Returning Series"/"Ended") rather than an
 * array of genres. `statuses` are TMDB's raw canonical strings; `labelFor`
 * maps each to its translated display text (see ShowsPage.tsx) — the panel
 * itself stays free of i18n, same as GenreFilterPanel.tsx does for genre
 * names (which arrive already localized from TMDB).
 */
export function StatusFilterPanel({
  statuses,
  labelFor,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  statuses: string[]
  labelFor: (status: string) => string
  filters: StatusFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: StatusFilters) => StatusFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(status: string, mode: StatusFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[status] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[status]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[status] = mode
      }
      return next
    })
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      {/* w-fit: sizes to the widest row's natural content width, same
          reasoning as GenreFilterPanel.tsx. gap-3 (not gap-2): tiles
          IconButton's 44px hit-area expansion vertically with zero overlap
          between rows. */}
      <ul className="mt-3 flex w-fit flex-col gap-3">
        {statuses.map((status) => {
          const mode = filters[status]
          const label = labelFor(status)
          return (
            <li key={status} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label}</span>
              <IncludeExcludeToggle
                value={mode}
                onSelect={(next) => setMode(status, next)}
                includeLabel={`${includeLabel} ${label}`}
                excludeLabel={`${excludeLabel} ${label}`}
              />
            </li>
          )
        })}
      </ul>
    </details>
  )
}
