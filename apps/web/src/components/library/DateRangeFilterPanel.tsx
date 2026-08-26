import type { DateRange } from '../../lib/use-date-range-cookie.js'
import { Field } from '../ui/Field.js'

/**
 * One collapsible section of the "Filters…" panel (see FiltersPanel.tsx,
 * HistoryPage.tsx) — an inclusive after/before calendar-date range over
 * `occurredAt`. Two native `<input type="date">` fields rather than a
 * custom date-picker widget — same choice WatchDateDialog.tsx already
 * makes, and every modern browser renders one of these with its own
 * built-in calendar popup. `min`/`max` cross-constrain the two fields so
 * the browser's own picker won't let you drag them past each other, but
 * nothing here forces the *stored* values straight — an inverted or
 * empty-result range is fine (see use-date-range-cookie.ts).
 */
export function DateRangeFilterPanel({
  range,
  onChange,
  groupLabel,
  afterLabel,
  beforeLabel,
}: {
  range: DateRange
  onChange: (next: DateRange) => void
  groupLabel: string
  afterLabel: string
  beforeLabel: string
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-fg)]">
        {groupLabel}
      </summary>
      <div className="mt-3 flex w-fit gap-3">
        <Field
          type="date"
          label={afterLabel}
          value={range.after ?? ''}
          max={range.before ?? undefined}
          onChange={(e) => onChange({ ...range, after: e.target.value || null })}
        />
        <Field
          type="date"
          label={beforeLabel}
          value={range.before ?? ''}
          min={range.after ?? undefined}
          onChange={(e) => onChange({ ...range, before: e.target.value || null })}
        />
      </div>
    </details>
  )
}
