import type { ReactNode } from 'react'
import { Field } from '../ui/Field.js'
import { Select } from '../ui/Select.js'

/** Filter-as-you-type box + sort dropdown, shared by ShowsPage and
 * MoviesPage. Generic over the sort key so each page supplies its own
 * option set (shows have a "progress" sort, movies have "times watched")
 * without this component needing to know about either. No debounce on the
 * filter: the whole library is already in memory, so filtering is a plain
 * array operation with nothing to save by delaying it — unlike the network
 * search on DashboardPage, which useDebouncedValue exists for. */
export function LibraryControls<SortKey extends string>({
  filterValue,
  onFilterChange,
  filterLabel,
  filterPlaceholder,
  betweenFilterAndSort,
  sortValue,
  onSortChange,
  sortLabel,
  sortOptions,
  sticky = false,
  panel,
}: {
  filterValue: string
  onFilterChange: (value: string) => void
  filterLabel: string
  filterPlaceholder: string
  /** Rendered between the filter box and the sort dropdown — currently just
   * the Shows page's "Filters…" button (GenreFilterPanel.tsx), which is why
   * this is a slot rather than a hardcoded control: Movies has nothing to
   * put here yet. */
  betweenFilterAndSort?: ReactNode
  sortValue: SortKey
  onSortChange: (value: SortKey) => void
  sortLabel: string
  sortOptions: Array<{ value: SortKey; label: string }>
  /** Pins the bar below the app header instead of scrolling away with the
   * rest of the page. `top-16`/`z-10` match Layout.tsx's header (`h-16`,
   * `z-20`) and Sidebar.tsx's own `top-16` sticky offset. */
  sticky?: boolean
  /** Rendered under the filter/sort row, inside the same (possibly sticky)
   * container: the pages' expanded "Filters…" card (FiltersPanel.tsx). It
   * lives in here rather than as a sibling after this component so it pins
   * along with the row instead of scrolling away on its own. When sticky,
   * the container is capped below the viewport height and the panel scrolls
   * internally, so a tall panel can't push its own lower sections off-screen
   * where page scrolling would never reach them, and a strip of results
   * stays visible underneath. */
  panel?: ReactNode
}) {
  return (
    <div
      className={
        sticky
          ? 'sticky top-16 z-10 flex max-h-[calc(100dvh-8rem)] flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] py-3'
          : 'flex flex-col gap-3'
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={filterLabel}
          hideLabel
          type="search"
          placeholder={filterPlaceholder}
          value={filterValue}
          onChange={(e) => onFilterChange(e.target.value)}
          // min-w-48 (192px) alone used to always force the sort Select (also
          // 192px) onto its own row below sm — nothing left for both to share
          // a line at a phone's ~343px usable width. min-w-32 lets this field
          // actually shrink there; sm:min-w-48 keeps today's floor everywhere
          // it already fit.
          className="min-w-32 flex-1 sm:min-w-48"
        />
        {betweenFilterAndSort}
        <Select
          label={sortLabel}
          hideLabel
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="w-36 sm:w-48"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {panel && <div className="min-h-0 overflow-y-auto">{panel}</div>}
    </div>
  )
}
