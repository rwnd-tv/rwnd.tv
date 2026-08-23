/** TMDB's own CDN-hosted logo asset — used by the rating badge on both
 * ShowDetailPage.tsx and MovieDetailPage.tsx (and the required attribution
 * footer in README.md), rather than a bare "★", so the rating is
 * attributed to its source the way a Trakt-style rating chip credits
 * IMDb/RT/Metacritic. Not bundled as a local asset: TMDB's attribution
 * terms require using their logo unmodified, and linking their own hosted
 * copy is the simplest way not to accidentally violate that (no local
 * crop/recolor/re-export to get out of sync with). Shared here rather than
 * duplicated per page, unlike this codebase's usual per-file icon
 * precedent — a long CDN URL with attribution constraints attached is
 * data, not a trivial inline SVG, and two copies could drift. */
export const TMDB_LOGO_URL =
  'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg'
