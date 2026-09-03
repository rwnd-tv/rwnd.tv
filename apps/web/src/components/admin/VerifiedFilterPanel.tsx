import type { VerifiedFilterMode } from '../../lib/admin-user-filter.js'

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

/** Same plus/minus include/exclude button as library/DroppedFilterPanel.tsx's
 * DroppedModeButton — duplicated rather than shared, matching this
 * codebase's existing precedent of one small component per filter section. */
function VerifiedModeButton({
  mode,
  active,
  onClick,
  label,
}: {
  mode: Exclude<VerifiedFilterMode, 'neutral'>
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
 * One collapsible section of the admin Users list's "Filters…" panel — same
 * tri-state plus/minus toggle row shape as library/DroppedFilterPanel.tsx:
 * "email verified" has no numeric range, it's a single boolean condition.
 */
export function VerifiedFilterPanel({
  mode,
  onChange,
  groupLabel,
  rowLabel,
  includeLabel,
  excludeLabel,
}: {
  mode: VerifiedFilterMode
  onChange: (next: VerifiedFilterMode) => void
  groupLabel: string
  rowLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(next: Exclude<VerifiedFilterMode, 'neutral'>) {
    onChange(mode === next ? 'neutral' : next)
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 flex w-64 items-center justify-between gap-2 text-sm">
        <span>{rowLabel}</span>
        <span className="flex shrink-0 items-center gap-1">
          <VerifiedModeButton
            mode="include"
            active={mode === 'include'}
            onClick={() => setMode('include')}
            label={`${includeLabel} ${rowLabel}`}
          />
          <VerifiedModeButton
            mode="exclude"
            active={mode === 'exclude'}
            onClick={() => setMode('exclude')}
            label={`${excludeLabel} ${rowLabel}`}
          />
        </span>
      </div>
    </details>
  )
}
