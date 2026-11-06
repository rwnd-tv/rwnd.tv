import { FilterSection } from './FilterSection.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * HistoryPage.tsx) — a plain checked/unchecked list over a small fixed set of
 * options, not the include/exclude toggle every other filter panel in this app
 * uses (GenreFilterPanel.tsx, ui/KeyedFilterPanel.tsx,
 * ui/BooleanFilterPanel.tsx) — see use-activity-kind-filter-cookie.ts for why
 * a single-valued field like `kind` doesn't fit that shape.
 */
export function CheckboxFilterPanel<T extends string>({
  options,
  shown,
  onChange,
  labelFor,
  groupLabel,
}: {
  options: readonly T[]
  shown: Set<T>
  onChange: (next: Set<T>) => void
  labelFor: (option: T) => string
  groupLabel: string
}) {
  function toggle(option: T) {
    const next = new Set(shown)
    if (next.has(option)) next.delete(option)
    else next.add(option)
    onChange(next)
  }

  return (
    <FilterSection title={groupLabel}>
      <ul className="mt-3 flex w-fit flex-col gap-2 text-sm">
        {options.map((option) => (
          <li key={option}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={shown.has(option)} onChange={() => toggle(option)} />
              {labelFor(option)}
            </label>
          </li>
        ))}
      </ul>
    </FilterSection>
  )
}
