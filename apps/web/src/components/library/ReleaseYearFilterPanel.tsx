import { DualRangeSlider } from '../ui/DualRangeSlider.js'
import type { AfterBefore } from '../../lib/use-year-range-cookie.js'
import { FilterSection } from './FilterSection.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * ShowsPage.tsx) — a single two-handle DualRangeSlider, "After" and
 * "Before", spanning the library's actual earliest-to-latest release
 * years. Equal values are allowed (inclusive range, collapsing to "this
 * exact year") — DualRangeSlider clamps rather than blocks.
 */
export function ReleaseYearFilterPanel({
  min,
  max,
  range,
  onChange,
  groupLabel,
  afterLabel,
  beforeLabel,
}: {
  min: number
  max: number
  range: AfterBefore
  onChange: (next: AfterBefore) => void
  groupLabel: string
  afterLabel: string
  beforeLabel: string
}) {
  return (
    <FilterSection title={groupLabel}>
      <div className="mt-3 w-64">
        <DualRangeSlider
          min={min}
          max={max}
          step={1}
          value={{ low: range.after, high: range.before }}
          onChange={({ low, high }) => onChange({ after: low, before: high })}
          lowLabel={afterLabel}
          highLabel={beforeLabel}
        />
      </div>
    </FilterSection>
  )
}
