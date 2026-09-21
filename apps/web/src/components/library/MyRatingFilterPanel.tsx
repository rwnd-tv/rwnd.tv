import { DualRangeSlider } from '../ui/DualRangeSlider.js'
import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import type { UnratedMode } from '../../lib/library-filter.js'
import type { AfterBefore } from '../../lib/use-year-range-cookie.js'
import { FilterSection } from './FilterSection.js'

/**
 * Same shape as WatchedYearFilterPanel — a DualRangeSlider plus a tri-state
 * Unrated toggle — but over the current user's own 1-10 rating (see
 * library-filter.ts's myRatingRange/filterByMyRating) rather than a watched
 * year, and formatted as stars (the scale the RatingPicker widget actually
 * shows) rather than the raw 1-10 number, since nobody ever types or reads
 * that number directly.
 */
export function MyRatingFilterPanel({
  min,
  max,
  range,
  onChange,
  unratedMode,
  onUnratedModeChange,
  groupLabel,
  minLabel,
  maxLabel,
  unratedLabel,
  includeLabel,
  excludeLabel,
}: {
  min: number
  max: number
  range: AfterBefore
  onChange: (next: AfterBefore) => void
  unratedMode: UnratedMode
  onUnratedModeChange: (next: UnratedMode) => void
  groupLabel: string
  minLabel: string
  maxLabel: string
  unratedLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setUnratedMode(mode: Exclude<UnratedMode, 'neutral'>) {
    onUnratedModeChange(unratedMode === mode ? 'neutral' : mode)
  }

  return (
    <FilterSection title={groupLabel}>
      <div className="mt-3 flex w-64 flex-col gap-4">
        <DualRangeSlider
          min={min}
          max={max}
          step={1}
          value={{ low: range.after, high: range.before }}
          onChange={({ low, high }) => onChange({ after: low, before: high })}
          lowLabel={minLabel}
          highLabel={maxLabel}
          formatValue={(v) => `${(v / 2).toFixed(1)}★`}
        />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{unratedLabel}</span>
          <IncludeExcludeToggle
            value={unratedMode}
            onSelect={setUnratedMode}
            includeLabel={`${includeLabel} ${unratedLabel}`}
            excludeLabel={`${excludeLabel} ${unratedLabel}`}
          />
        </div>
      </div>
    </FilterSection>
  )
}
