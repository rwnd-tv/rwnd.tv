import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import type { MfaFilterMode } from '../../lib/admin-user-filter.js'

/**
 * One collapsible section of the admin Users list's "Filters…" panel — same
 * tri-state plus/minus toggle row shape as library/DroppedFilterPanel.tsx:
 * "has MFA enabled" has no numeric range, it's a single boolean condition.
 */
export function MfaFilterPanel({
  mode,
  onChange,
  groupLabel,
  rowLabel,
  includeLabel,
  excludeLabel,
}: {
  mode: MfaFilterMode
  onChange: (next: MfaFilterMode) => void
  groupLabel: string
  rowLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(next: Exclude<MfaFilterMode, 'neutral'>) {
    onChange(mode === next ? 'neutral' : next)
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 flex w-64 items-center justify-between gap-2 text-sm">
        <span>{rowLabel}</span>
        <IncludeExcludeToggle
          value={mode}
          onSelect={setMode}
          includeLabel={`${includeLabel} ${rowLabel}`}
          excludeLabel={`${excludeLabel} ${rowLabel}`}
        />
      </div>
    </details>
  )
}
