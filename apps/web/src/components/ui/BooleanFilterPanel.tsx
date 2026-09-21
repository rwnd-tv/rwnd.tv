import { FilterSection } from '../library/FilterSection.js'
import { IncludeExcludeToggle, type IncludeExcludeMode } from './IncludeExcludeToggle.js'

type TriStateMode = 'neutral' | IncludeExcludeMode

/**
 * One collapsible section of a "Filters…" panel for a single boolean
 * condition with no numeric range — just a tri-state plus/minus toggle row.
 * Generic replacement for what were three byte-identical components
 * (library/DroppedFilterPanel.tsx, admin/MfaFilterPanel.tsx,
 * admin/VerifiedFilterPanel.tsx), which differed only in their mode type's
 * name and the caller's own labels/seed value — nothing about the panel
 * itself was ever specific to one of the three. (Dropped defaults its
 * cookie to `'exclude'` rather than `'neutral'`; that's the caller's seed
 * value, not something this component needs to know about.)
 */
export function BooleanFilterPanel<M extends TriStateMode>({
  mode,
  onChange,
  groupLabel,
  rowLabel,
  includeLabel,
  excludeLabel,
}: {
  mode: M
  onChange: (next: M) => void
  groupLabel: string
  rowLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  // IncludeExcludeToggle is deliberately non-generic (see its own doc
  // comment) — it only ever hands back a plain 'include' | 'exclude', so
  // the caller's own M-typed union is reconstructed here rather than
  // threaded through the toggle itself.
  function handleSelect(next: IncludeExcludeMode) {
    onChange((mode === next ? 'neutral' : next) as M)
  }

  return (
    <FilterSection title={groupLabel}>
      <div className="mt-3 flex w-64 items-center justify-between gap-2 text-sm">
        <span>{rowLabel}</span>
        <IncludeExcludeToggle
          value={mode}
          onSelect={handleSelect}
          includeLabel={`${includeLabel} ${rowLabel}`}
          excludeLabel={`${excludeLabel} ${rowLabel}`}
        />
      </div>
    </FilterSection>
  )
}
