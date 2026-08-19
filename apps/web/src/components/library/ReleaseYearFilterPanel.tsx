import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * ShowsPage.tsx) — two native range sliders, "After" and "Before", spanning
 * the library's actual earliest-to-latest release years. Two separate
 * single-thumb `<input type="range">` elements rather than one custom
 * dual-thumb slider: native gets keyboard/touch/screen-reader support for
 * free, matching this app's preference for native controls elsewhere
 * (Select, Field, the genre panel's checkboxes-as-buttons).
 *
 * The two are kept from crossing by clamping on change rather than by
 * constraining each slider's own min/max attribute — After's `max` stays
 * the library's true max throughout, so the thumb doesn't visually snap to
 * a shifting ceiling as Before moves; it simply can't be dragged past
 * Before's current value. Equal values are allowed (inclusive range,
 * collapsing to "this exact year").
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
      </div>
    </details>
  )
}
