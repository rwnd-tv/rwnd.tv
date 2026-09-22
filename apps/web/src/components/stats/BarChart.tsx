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
 */
export function BarChart({
  data,
  formatValue = (value) => String(value),
  onBarClick,
}: {
  data: BarChartDatum[]
  formatValue?: (value: number) => string
  onBarClick?: (datum: BarChartDatum) => void
}) {
  const max = Math.max(1, ...data.map((d) => d.value))

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
