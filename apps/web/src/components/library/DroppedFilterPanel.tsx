import { IncludeExcludeToggle } from '../ui/IncludeExcludeToggle.js'
import type { DroppedFilterMode } from '../../lib/library-filter.js'

/**
 * One collapsible section of the "Filters…" panel — just the tri-state
 * plus/minus toggle row from WatchedYearFilterPanel.tsx's "Unknown"
 * section, without the range sliders: "dropped" has no numeric range, it's
 * a single condition, same as Unknown. Unlike Unknown though, ShowsPage.tsx
 * seeds this cookie at `'exclude'` rather than `'neutral'` — dropped shows
 * are meant to be hidden from the gallery unless asked for.
 */
export function DroppedFilterPanel({
  mode,
  onChange,
  groupLabel,
  rowLabel,
  includeLabel,
  excludeLabel,
}: {
  mode: DroppedFilterMode
  onChange: (next: DroppedFilterMode) => void
  groupLabel: string
  rowLabel: string
  includeLabel: string
  excludeLabel: string
}) {
  function setMode(next: Exclude<DroppedFilterMode, 'neutral'>) {
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
