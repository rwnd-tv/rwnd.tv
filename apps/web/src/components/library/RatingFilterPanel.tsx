import { DualRangeSlider } from '../ui/DualRangeSlider.js'
import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

/**
 * Same shape as ReleaseYearFilterPanel — a single two-handle
 * DualRangeSlider spanning the library's actual lowest-to-highest TMDB
 * rating — but with a 0.1 step and one-decimal display (TMDB's own
 * precision) instead of whole years, and "Min"/"Max" labels rather than
 * "After"/"Before" (a rating isn't a point in time, so that pairing doesn't
 * read right here).
 */
export function RatingFilterPanel({
  min,
  max,
  range,
  onChange,
  groupLabel,
  minLabel,
  maxLabel,
}: {
  min: number
  max: number
  range: AfterBefore
  onChange: (next: AfterBefore) => void
  groupLabel: string
  minLabel: string
  maxLabel: string
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 w-64">
        <DualRangeSlider
          min={min}
          max={max}
          step={0.1}
          value={{ low: range.after, high: range.before }}
          onChange={({ low, high }) => onChange({ after: low, before: high })}
          lowLabel={minLabel}
          highLabel={maxLabel}
          formatValue={(v) => v.toFixed(1)}
        />
      </div>
    </details>
  )
}
