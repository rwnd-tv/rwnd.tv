export interface RangeValue {
  low: number
  high: number
}

/** Number of decimal digits `step` is expressed to (e.g. `0.1` → 1), used to
 * round index→value conversions back to a clean number instead of
 * accumulating float noise (`2.8 + 66 * 0.1` → `9.399999999999999`). */
function stepDecimals(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i === -1 ? 0 : s.length - i - 1
}

/**
 * A single track with two draggable handles that can't cross, built from two
 * overlapping native `<input type="range">` elements rather than fully
 * custom pointer/keyboard handling — the CSS in index.css
 * (`.dual-range-input`) makes each input's track invisible and
 * `pointer-events: none`, leaving only its thumb clickable/draggable
 * (`pointer-events: auto` on `::-webkit-slider-thumb`/`::-moz-range-thumb`).
 * That keeps native keyboard (arrow keys, Home/End), touch, and
 * screen-reader slider semantics for both handles for free — the same
 * reasoning that favoured two separate native sliders originally (see the
 * old ReleaseYearFilterPanel comment) — while presenting as one track
 * visually. Trade-off: clicking empty track no longer jumps a handle there
 * (neither input's track owns that click), only dragging/keyboard does.
 *
 * The two inputs are stacked with `z-index` swapped based on which value is
 * further from the midpoint, so when the handles meet or nearly overlap the
 * one with room to move stays on top and grabbable.
 *
 * The native inputs themselves run over an integer index space (`0` to
 * `totalSteps`), not the real `min`/`max`/`step` — found live: a rating
 * slider (`min={2.8}`, `step={0.1}`) could never actually reach `9.5` by
 * dragging or arrow keys, only by the initial/reset value. HTML range
 * inputs snap by stepping `step` from `min`, and since `9.5 - 2.8` isn't an
 * exact multiple of `0.1` in floating point, the browser's own snapping
 * arithmetic clamps one step short of the real max instead of reaching it.
 * Stepping by whole integers instead is always exact, so `totalSteps` is
 * always reachable; `toIndex`/`fromIndex` convert to/from the real value at
 * the boundary, with `aria-value*` overrides so screen readers still
 * announce the real value rather than its index. */
export function DualRangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  lowLabel,
  highLabel,
  formatValue = (v) => String(v),
}: {
  min: number
  max: number
  step?: number
  value: RangeValue
  onChange: (next: RangeValue) => void
  lowLabel: string
  highLabel: string
  formatValue?: (value: number) => string
}) {
  const decimals = stepDecimals(step)
  const totalSteps = Math.max(0, Math.round((max - min) / step))

  function toIndex(v: number): number {
    return Math.min(totalSteps, Math.max(0, Math.round((v - min) / step)))
  }

  function fromIndex(index: number): number {
    if (index <= 0) return min
    if (index >= totalSteps) return max
    const multiplier = 10 ** decimals
    return Math.round((min + index * step) * multiplier) / multiplier
  }

  function setLow(index: number) {
    const next = fromIndex(index)
    onChange({ low: Math.min(next, value.high), high: value.high })
  }

  function setHigh(index: number) {
    const next = fromIndex(index)
    onChange({ low: value.low, high: Math.max(next, value.low) })
  }

  const span = max - min || 1
  const lowPercent = ((value.low - min) / span) * 100
  const highPercent = ((value.high - min) / span) * 100
  const lowOnTop = value.low - min > span / 2

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>
          {lowLabel} <span className="text-[var(--color-fg-muted)]">{formatValue(value.low)}</span>
        </span>
        <span>
          {highLabel}{' '}
          <span className="text-[var(--color-fg-muted)]">{formatValue(value.high)}</span>
        </span>
      </div>
      <div className="relative flex h-5 items-center">
        <div className="absolute h-1 w-full rounded-full bg-[var(--color-border)]" />
        <div
          className="absolute h-1 rounded-full bg-[var(--color-primary)]"
          style={{ left: `${lowPercent}%`, right: `${100 - highPercent}%` }}
        />
        <input
          type="range"
          aria-label={lowLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value.low}
          aria-valuetext={formatValue(value.low)}
          min={0}
          max={totalSteps}
          step={1}
          value={toIndex(value.low)}
          onChange={(e) => setLow(Number(e.target.value))}
          className="dual-range-input absolute w-full"
          style={{ zIndex: lowOnTop ? 4 : 3 }}
        />
        <input
          type="range"
          aria-label={highLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value.high}
          aria-valuetext={formatValue(value.high)}
          min={0}
          max={totalSteps}
          step={1}
          value={toIndex(value.high)}
          onChange={(e) => setHigh(Number(e.target.value))}
          className="dual-range-input absolute w-full"
          style={{ zIndex: lowOnTop ? 3 : 4 }}
        />
      </div>
    </div>
  )
}
