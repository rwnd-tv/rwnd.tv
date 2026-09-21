import { DualRangeSlider } from '../ui/DualRangeSlider.js'
import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import type { UnknownWatchedMode } from '../../lib/library-filter.js'
import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

/**
 * Same shape as ReleaseYearFilterPanel — a single "After"/"Before"
 * DualRangeSlider — plus one addition: an include/exclude toggle for shows
 * whose watched date is unknown (Trakt's 1900-01-01 sentinel, see
 * watchedYearOf() in library-filter.ts). That's a categorical condition, not a value the
 * range sliders could place inside or outside of, so it's a separate
 * control rather than trying to fold "unknown" into the slider range
 * itself — see ShowsPage.tsx's `watchedYearRange`, which excludes 1900 from
 * `min`/`max` entirely so the "After" slider can never be dragged back to
 * it.
 *
 * The control is a tri-state plus/minus toggle (IncludeExcludeToggle), not a
 * checkbox: neutral shows both known-in-range and unknown shows (the
 * default), exclude hides unknown entirely, and include shows *only*
 * unknown shows, ignoring the range sliders above. Clicking an already-active
 * icon falls back to neutral, same as a genre toggle falling back to "no
 * rule".
 */
export function WatchedYearFilterPanel({
  min,
  max,
  range,
  onChange,
  unknownMode,
  onUnknownModeChange,
  groupLabel,
  afterLabel,
  beforeLabel,
  unknownLabel,
  includeLabel,
  excludeLabel,
}: {
  min: number
  max: number
  range: AfterBefore
  onChange: (next: AfterBefore) => void
  unknownMode: UnknownWatchedMode
  onUnknownModeChange: (next: UnknownWatchedMode) => void
  groupLabel: string
  afterLabel: string
  beforeLabel: string
  unknownLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setUnknownMode(mode: Exclude<UnknownWatchedMode, 'neutral'>) {
    onUnknownModeChange(unknownMode === mode ? 'neutral' : mode)
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 flex w-64 flex-col gap-4">
        <DualRangeSlider
          min={min}
          max={max}
          step={1}
          value={{ low: range.after, high: range.before }}
          onChange={({ low, high }) => onChange({ after: low, before: high })}
          lowLabel={afterLabel}
          highLabel={beforeLabel}
        />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{unknownLabel}</span>
          <IncludeExcludeToggle
            value={unknownMode}
            onSelect={setUnknownMode}
            includeLabel={`${includeLabel} ${unknownLabel}`}
            excludeLabel={`${excludeLabel} ${unknownLabel}`}
          />
        </div>
      </div>
    </details>
  )
}
