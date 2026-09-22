export interface BarChartDatum {
  key: string
  label: string
  value: number
  /** Full tooltip/accessible text for this bar — falls back to
   * "label: formatValue(value)" when omitted. */
  title?: string
}

/**
 * One generic bar chart, reused by ActivityChart.tsx (stage 2) and, per the
 * M6 plan, the top-genres/ratings-histogram charts in stage 3 — inline
 * `style={{height}}` bars rather than SVG, same trick ProgressBar.tsx
 * already uses for a value only known at render time (Tailwind's JIT can't
 * emit a class for that). No chart library, no new dependency.
 *
 * Each bar carries its own `title` attribute (a native tooltip) plus an
 * `.sr-only` line with the same text, since the bar's visual height alone
 * conveys nothing to a screen reader or in a high-contrast/no-hover
 * context.
 *
 * `onBarClick` is optional — when a caller passes one (ActivityChart.tsx's
 * year bars, drilling into that year), the whole bar+label column renders
 * as a real `<button>` instead of a plain `<div>`, which gets keyboard
 * operation and the app's global `:focus-visible` outline (index.css) for
 * free rather than needing its own focus styling. Without it, a bar stays
 * inert — the right default for a chart with nothing to drill into, e.g.
 * stage 3's top-genres/ratings bars.
 *
 * `orientation: 'horizontal'` (stage 3's top-genres list) swaps the column
 * layout for a labeled-row layout — a genre name can run much longer than
 * a month/rating label, so it reads better to the side of its bar than
 * underneath it. Solid `bg-[var(--color-primary)]` either way: rank and
 * bar length already carry the ranking, so a categorical per-item color
 * isn't needed (same reasoning the M6 plan gives for skipping one).
 *
 * Horizontal mode is a real CSS grid (`grid-cols-[auto_1fr_auto]` on the
 * list, `grid-cols-subgrid` on each row), not a per-row flexbox — a plain
 * flex row sizes its label/value columns independently per row, which (a)
 * makes the middle "bar" column a different width on every row (however
 * long that row's own value text happens to be), so the bars themselves
 * stop lining up at a common length, and (b) can't give the label and
 * value columns the *same* tight gap against the bar, since whichever one
 * isn't fixed-width keeps trailing extra blank space for anything shorter
 * than the widest entry. Subgrid makes every row share the same three
 * column tracks — sized to the single widest label and widest value across
 * the *whole* list — so every bar is the same length and the gap on both
 * sides is exactly `gap-x-2`, for every row, not just the widest one.
 */
export function BarChart({
  data,
  formatValue = (value) => String(value),
  onBarClick,
  orientation = 'vertical',
}: {
  data: BarChartDatum[]
  formatValue?: (value: number) => string
  onBarClick?: (datum: BarChartDatum) => void
  orientation?: 'vertical' | 'horizontal'
}) {
  const max = Math.max(1, ...data.map((d) => d.value))

  if (orientation === 'horizontal') {
    return (
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2">
        {data.map((d) => {
          const text = d.title ?? `${d.label}: ${formatValue(d.value)}`
          const content = (
            <>
              <span className="truncate text-xs text-[var(--color-fg-muted)]">{d.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${(d.value / max) * 100}%` }}
                />
              </div>
              <span className="text-xs whitespace-nowrap text-[var(--color-fg-muted)]">
                {formatValue(d.value)}
              </span>
              <span className="sr-only">{text}</span>
            </>
          )
          return onBarClick ? (
            <button
              key={d.key}
              type="button"
              title={text}
              onClick={() => onBarClick(d)}
              className="col-span-3 grid grid-cols-subgrid items-center gap-x-2 rounded text-left hover:opacity-80"
            >
              {content}
            </button>
          ) : (
            <div
              key={d.key}
              className="col-span-3 grid grid-cols-subgrid items-center gap-x-2"
              title={text}
            >
              {content}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-40 items-end gap-1">
      {data.map((d) => {
        const text = d.title ?? `${d.label}: ${formatValue(d.value)}`
        const content = (
          <>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-[var(--color-primary)]"
                style={{ height: `${(d.value / max) * 100}%` }}
              />
            </div>
            <span className="truncate text-[10px] text-[var(--color-fg-muted)]">{d.label}</span>
            <span className="sr-only">{text}</span>
          </>
        )
        return onBarClick ? (
          <button
            key={d.key}
            type="button"
            title={text}
            onClick={() => onBarClick(d)}
            className="flex h-full flex-1 flex-col items-center gap-1 rounded hover:opacity-80"
          >
            {content}
          </button>
        ) : (
          <div key={d.key} className="flex h-full flex-1 flex-col items-center gap-1" title={text}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
