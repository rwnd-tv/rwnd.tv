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
}) {
  return (
    <div
      className={
        sticky
          ? 'sticky top-16 z-10 flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] py-3'
          : 'flex flex-wrap items-end gap-3'
      }
    >
      <Field
        label={filterLabel}
        hideLabel
        type="search"
        placeholder={filterPlaceholder}
        value={filterValue}
        onChange={(e) => onFilterChange(e.target.value)}
        className="min-w-48 flex-1"
      />
      {betweenFilterAndSort}
      <Select
        label={sortLabel}
        hideLabel
        value={sortValue}
        onChange={(e) => onSortChange(e.target.value as SortKey)}
        className="w-48"
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
