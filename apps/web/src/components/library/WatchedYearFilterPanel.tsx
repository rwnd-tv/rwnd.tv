import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

/**
 * Same shape as ReleaseYearFilterPanel — two native "After"/"Before" range
 * sliders — plus one addition: a checkbox for shows whose watched date is
 * unknown (Trakt's 1900-01-01 sentinel, see watchedYearOf() in
 * library-filter.ts). That's a categorical toggle, not a value the range
 * sliders could place inside or outside of, so it's a separate control
 * rather than trying to fold "unknown" into the slider range itself — see
 * ShowsPage.tsx's `watchedYearRange`, which excludes 1900 from `min`/`max`
 * entirely so the "After" slider can never be dragged back to it.
 */
export function WatchedYearFilterPanel({
  min,
  max,
  range,
  onChange,
  includeUnknown,
  onIncludeUnknownChange,
  groupLabel,
  afterLabel,
  beforeLabel,
  unknownLabel,
}: {
  min: number
  max: number
  range: AfterBefore
  onChange: (next: AfterBefore) => void
  includeUnknown: boolean
  onIncludeUnknownChange: (next: boolean) => void
  groupLabel: string
  afterLabel: string
  beforeLabel: string
  unknownLabel: string
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
            <span>{afterLabel}</span>
            <span className="text-[var(--color-fg-muted)]">{range.after}</span>
          </div>
          <input
            type="range"
            aria-label={afterLabel}
            min={min}
            max={max}
            step={1}
            value={range.after}
            onChange={(e) => setAfter(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span>{beforeLabel}</span>
            <span className="text-[var(--color-fg-muted)]">{range.before}</span>
          </div>
          <input
            type="range"
            aria-label={beforeLabel}
            min={min}
            max={max}
            step={1}
            value={range.before}
            onChange={(e) => setBefore(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeUnknown}
            onChange={(e) => onIncludeUnknownChange(e.target.checked)}
          />
          {unknownLabel}
        </label>
      </div>
    </details>
  )
}
