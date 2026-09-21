import type { UserRole } from '@rwnd/shared'
import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import type { StatusFilterMode, StatusFilters } from '../../lib/library-filter.js'

/**
 * One collapsible section of the admin Users list's "Filters…" panel (see
 * FiltersPanel.tsx, UsersPanel.tsx) — same shape as
 * library/StatusFilterPanel.tsx (a vertical list, each row with an
 * include/exclude icon toggle), over `role` instead of `status`. Reuses
 * `StatusFilters`/`StatusFilterMode` (library-filter.ts) rather than
 * declaring an identical type — both are just `Record<string, 'include' |
 * 'exclude'>` under the hood, nothing status-specific about the shape.
 */
export function RoleFilterPanel({
  roles,
  labelFor,
  filters,
  onChange,
  groupLabel,
  includeLabel,
  excludeLabel,
}: {
  roles: UserRole[]
  labelFor: (role: UserRole) => string
  filters: StatusFilters
  /** Functional updater, not a plain value — see use-genre-filter-cookie.ts
   * for why computing "next" from a `filters` snapshot instead is unsafe
   * when two clicks can land before a re-render lands between them. */
  onChange: (updater: (prev: StatusFilters) => StatusFilters) => void
  groupLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(role: UserRole, mode: StatusFilterMode) {
    onChange((prev) => {
      const next = { ...prev }
      if (next[role] === mode) {
        // Clicking the already-active icon again clears the rule entirely.
        delete next[role]
      } else {
        // Setting one mode always clears the other — mutually exclusive.
        next[role] = mode
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
          reasoning as StatusFilterPanel.tsx. gap-3 (not gap-2): tiles
          IconButton's 44px hit-area expansion vertically with zero overlap
          between rows. */}
      <ul className="mt-3 flex w-fit flex-col gap-3">
        {roles.map((role) => {
          const mode = filters[role]
          const label = labelFor(role)
          return (
            <li key={role} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{label}</span>
              <IncludeExcludeToggle
                value={mode}
                onSelect={(next) => setMode(role, next)}
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
