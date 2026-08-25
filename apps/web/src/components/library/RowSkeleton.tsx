/**
 * Placeholder shown by OnDeckRow.tsx/UpNextRow.tsx/HistoryRow.tsx while their
 * query is loading, in the same shape (heading + horizontal row of
 * `w-40`/`aspect-[2/3]` tiles matching PosterTile.tsx) their real content
 * will render in. Reserving that shape is what fixes the loading-order shift
 * where History's fast `GET /plays` query used to resolve — and render, as
 * the only visible row — before On Deck/Up Next's slower per-show
 * resolution finished, then get shoved down once those popped in above it
 * (docs/TODO.md, "Loading-order layout shift on Dashboard"): since all three
 * rows now occupy their final position from the first paint, nothing moves
 * as each query resolves into real content or (if empty) collapses to
 * nothing.
 *
 * `aria-hidden` throughout: it's a purely visual placeholder, not
 * information — a screen reader has nothing useful to announce for a
 * heading/tiles with no real content yet.
 */
export function RowSkeleton({ tileCount = 6 }: { tileCount?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface)]" />
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {Array.from({ length: tileCount }, (_, i) => (
          <li key={i} className="flex w-40 flex-shrink-0 flex-col gap-2">
            <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-[var(--color-surface)]" />
            {/* PosterTile.tsx always renders a title line (its `<h2>`) plus a
             * second line for whatever's passed as `children` (the caption
             * every Dashboard row uses this in) — two lines, not one, each
             * separated by PosterTile's own gap-2. Matching that exactly
             * (rather than one guessed-height bar) is what keeps the real
             * content from landing ~30px taller than the skeleton reserved,
             * found from a real before/after comparison on dev.rwnd.tv,
             * James 2026-08-25. */}
            <div className="h-5 w-3/4 animate-pulse rounded bg-[var(--color-surface)]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-surface)]" />
          </li>
        ))}
      </ul>
    </div>
  )
}
