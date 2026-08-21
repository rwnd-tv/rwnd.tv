import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

/**
 * Same shape as ReleaseYearFilterPanel — two native range sliders spanning
 * the library's actual lowest-to-highest TMDB rating — but with a 0.1 step
 * and one-decimal display (TMDB's own precision) instead of whole years,
 * and "Min"/"Max" labels rather than "After"/"Before" (a rating isn't a
 * point in time, so that pairing doesn't read right here).
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
  function setAfter(value: number) {
    onChange({ after: Math.min(value, range.before), before: range.before })
  }

  function setBefore(value: number) {
    onChange({ after: range.after, before: Math.max(value, range.after) })
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 flex w-64 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span>{minLabel}</span>
            <span className="text-[var(--color-fg-muted)]">{range.after.toFixed(1)}</span>
          </div>
          <input
            type="range"
            aria-label={minLabel}
            min={min}
            max={max}
            step={0.1}
            value={range.after}
            onChange={(e) => setAfter(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span>{maxLabel}</span>
            <span className="text-[var(--color-fg-muted)]">{range.before.toFixed(1)}</span>
          </div>
          <input
            type="range"
            aria-label={maxLabel}
            min={min}
            max={max}
            step={0.1}
            value={range.before}
            onChange={(e) => setBefore(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </div>
      </div>
    </details>
  )
}
