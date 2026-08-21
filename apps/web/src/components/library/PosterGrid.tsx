import type { ReactNode } from 'react'

/**
 * Fluid Plex-style gallery grid — `auto-fill` + `minmax` picks however many
 * columns fit at the minimum tile width and stretches them to fill the
 * row, with no breakpoints and no JS: 2 columns on a phone, ~30 on a
 * 5120px ultrawide, reflowing live as the window resizes. `minTileWidth`
 * defaults to `10rem`, which keeps poster tiles comfortably under TMDB's
 * stored poster width (w342, baked into the URL at fetch time — see
 * apps/api/src/providers/tmdb.ts) so posters never upscale. A wider tile
 * (e.g. SeasonDetailPage.tsx's episode stills, w300) should pass a larger
 * value here rather than each caller reinventing the grid.
 */
export function PosterGrid({
  children,
  minTileWidth = '10rem',
}: {
  children: ReactNode
  minTileWidth?: string
}) {
  return (
    <ul
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}, 1fr))` }}
    >
      {children}
    </ul>
  )
}
