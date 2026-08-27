import { DualRangeSlider } from '../ui/DualRangeSlider.js'
import type { UnratedMode } from '../../lib/library-filter.js'
import type { AfterBefore } from '../../lib/use-year-range-cookie.js'

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  )
}

/** Same plus/minus include/exclude button as WatchedYearFilterPanel.tsx's
 * UnknownModeButton — duplicated rather than shared, matching this
 * codebase's existing precedent of one small component per filter section. */
function UnratedModeButton({
  mode,
  active,
  onClick,
  label,
}: {
  mode: Exclude<UnratedMode, 'neutral'>
  active: boolean
  onClick: () => void
  label: string
}) {
  const activeClass = mode === 'include' ? 'text-emerald-500' : 'text-[var(--color-danger)]'
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex items-center justify-center rounded p-1 hover:bg-[var(--color-border)] ${
        active ? activeClass : 'text-[var(--color-fg-muted)]'
      }`}
    >
      {mode === 'include' ? <PlusIcon /> : <MinusIcon />}
    </button>
  )
}

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
          lowLabel={minLabel}
          highLabel={maxLabel}
          formatValue={(v) => `${(v / 2).toFixed(1)}★`}
        />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{unratedLabel}</span>
          <span className="flex shrink-0 items-center gap-1">
            <UnratedModeButton
              mode="include"
              active={unratedMode === 'include'}
              onClick={() => setUnratedMode('include')}
              label={`${includeLabel} ${unratedLabel}`}
            />
            <UnratedModeButton
              mode="exclude"
              active={unratedMode === 'exclude'}
              onClick={() => setUnratedMode('exclude')}
              label={`${excludeLabel} ${unratedLabel}`}
            />
          </span>
        </div>
      </div>
    </details>
  )
}
