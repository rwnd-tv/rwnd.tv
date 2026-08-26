import { ACTIVITY_KINDS, type ActivityKind } from '@rwnd/shared'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * HistoryPage.tsx) — a plain checked/unchecked list over the four fixed
 * ACTIVITY_KINDS, not the include/exclude toggle every other filter panel
 * in this app uses (GenreFilterPanel.tsx, StatusFilterPanel.tsx,
 * DroppedFilterPanel.tsx) — see use-activity-kind-filter-cookie.ts for why
 * `kind` doesn't fit that shape.
 */
export function ActivityKindFilterPanel({
  shown,
  onChange,
  labelFor,
  groupLabel,
}: {
  shown: Set<ActivityKind>
  onChange: (next: Set<ActivityKind>) => void
  labelFor: (kind: ActivityKind) => string
  groupLabel: string
}) {
  function toggle(kind: ActivityKind) {
    const next = new Set(shown)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    onChange(next)
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <ul className="mt-3 flex w-fit flex-col gap-2 text-sm">
        {ACTIVITY_KINDS.map((kind) => (
          <li key={kind}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={shown.has(kind)} onChange={() => toggle(kind)} />
              {labelFor(kind)}
            </label>
          </li>
        ))}
      </ul>
    </details>
  )
}
