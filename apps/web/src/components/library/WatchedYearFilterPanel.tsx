import type { UnknownWatchedMode } from '../../lib/library-filter.js'
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

/** Same plus/minus include/exclude button as GenreFilterPanel.tsx's
 * GenreModeButton — duplicated rather than shared, matching this
 * codebase's existing precedent of one small component per filter section
 * (see StatusFilterPanel.tsx). Unlike the genre/status version, `active`
 * here reflects a single tri-state value rather than a per-item map entry. */
function UnknownModeButton({
  mode,
  active,
  onClick,
  label,
}: {
  mode: Exclude<UnknownWatchedMode, 'neutral'>
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
 * Same shape as ReleaseYearFilterPanel — two native "After"/"Before" range
 * sliders — plus one addition: an include/exclude toggle for shows whose
 * watched date is unknown (Trakt's 1900-01-01 sentinel, see watchedYearOf()
 * in library-filter.ts). That's a categorical condition, not a value the
 * range sliders could place inside or outside of, so it's a separate
 * control rather than trying to fold "unknown" into the slider range
 * itself — see ShowsPage.tsx's `watchedYearRange`, which excludes 1900 from
 * `min`/`max` entirely so the "After" slider can never be dragged back to
 * it.
 *
 * The control is a tri-state plus/minus toggle (same icon-button UI as
 * GenreFilterPanel.tsx), not a checkbox: neutral shows both known-in-range
 * and unknown shows (the default), exclude hides unknown entirely, and
 * include shows *only* unknown shows, ignoring the range sliders above.
 * Clicking an already-active icon falls back to neutral, same as a genre
 * toggle falling back to "no rule".
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
  function setAfter(value: number) {
    onChange({ after: Math.min(value, range.before), before: range.before })
  }

  function setBefore(value: number) {
    onChange({ after: range.after, before: Math.max(value, range.after) })
  }

  function setUnknownMode(mode: Exclude<UnknownWatchedMode, 'neutral'>) {
    onUnknownModeChange(unknownMode === mode ? 'neutral' : mode)
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
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{unknownLabel}</span>
          <span className="flex shrink-0 items-center gap-1">
            <UnknownModeButton
              mode="include"
              active={unknownMode === 'include'}
              onClick={() => setUnknownMode('include')}
              label={`${includeLabel} ${unknownLabel}`}
            />
            <UnknownModeButton
              mode="exclude"
              active={unknownMode === 'exclude'}
              onClick={() => setUnknownMode('exclude')}
              label={`${excludeLabel} ${unknownLabel}`}
            />
          </span>
        </div>
      </div>
    </details>
  )
}
