import type { ReactNode } from 'react'

/**
 * Fluid Plex-style gallery grid — `auto-fill` + `minmax` picks however many
 * columns fit at the minimum tile width and stretches them to fill the
 * row, with no breakpoints and no JS: 2 columns on a phone, ~30 on a
 * 5120px ultrawide, reflowing live as the window resizes. `10rem` keeps
 * tiles comfortably under TMDB's stored poster width (w342, baked into the
 * URL at fetch time — see apps/api/src/providers/tmdb.ts) so posters never
 * upscale.
 */
export function PosterGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">{children}</ul>
}
