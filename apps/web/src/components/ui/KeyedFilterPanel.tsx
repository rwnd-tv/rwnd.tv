import type { StatusFilterMode, StatusFilters } from '../../lib/library-filter.js'
import { FilterSection } from '../library/FilterSection.js'
import { IncludeExcludeToggle } from './IncludeExcludeToggle.js'

/**
 * One collapsible section of a "Filters…" panel: a vertical list, one row
 * per key, each with an include/exclude icon toggle. Generic replacement for
 * what were two near-identical components (library/StatusFilterPanel.tsx
 * over `shows.status`, admin/RoleFilterPanel.tsx over `role`), which already
 * shared `StatusFilterMode`/`StatusFilters` (library-filter.ts) under the
 * hood — both are just `Record<string, 'include' | 'exclude'>` — and
 * differed only in the key type and doc comment. `labelFor` stays the
 * caller's job (translated status/role text vs. genre names arriving
 * already localized from TMDB), same as GenreFilterPanel.tsx, which stays
 * separate: a genre list has no `labelFor` translation step to generalize
 * over.
 */
export function KeyedFilterPanel<K extends string>({
  keys,
  labelFor,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  keys: K[]
  labelFor: (key: K) => string
  filters: StatusFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: StatusFilters) => StatusFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(key: K, mode: StatusFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[key] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[key]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[key] = mode
      }
      return next
    })
  }

  return (
    <FilterSection title={groupLabel}>
      {/* w-fit: sizes to the widest row's natural content width. gap-3 (not
          gap-2): tiles IconButton's 44px hit-area expansion vertically with
          zero overlap between rows. */}
      <ul className="mt-3 flex w-fit flex-col gap-3">
        {keys.map((key) => {
          const mode = filters[key]
          const label = labelFor(key)
          return (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label}</span>
              <IncludeExcludeToggle
                value={mode}
                onSelect={(next) => setMode(key, next)}
                includeLabel={`${includeLabel} ${label}`}
                excludeLabel={`${excludeLabel} ${label}`}
              />
            </li>
          )
        })}
      </ul>
    </FilterSection>
  )
}
