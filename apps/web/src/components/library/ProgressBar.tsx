/**
 * Watched-episode progress for a show tile (apps/web/src/components/library/PosterTile.tsx).
 * No such primitive exists in the shared UI kit — this is local to the
 * gallery pages rather than promoted to components/ui, since nothing else
 * needs a progress bar today.
 */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  // Clamped for the *bar* only, not the numbers shown next to it: TMDB can
  // re-cut a season after you've already watched it (fewer episodes than
  // before), so `value` can legitimately exceed `max`. The bar caps at
  // 100% rather than overflowing; the label stays truthful either way.
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
    >
      <div
        className="h-full rounded-full bg-[var(--color-primary)]"
        // Inline style, not a class: Tailwind's build-time JIT can't
        // generate a class from a value only known at render time.
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
