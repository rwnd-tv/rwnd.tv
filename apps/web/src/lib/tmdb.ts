/** TMDB's attribution logo — used by the rating badge on both
 * ShowDetailPage.tsx and MovieDetailPage.tsx (and the required attribution
 * footer in README.md), rather than a bare "★", so the rating is
 * attributed to its source the way a Trakt-style rating chip credits
 * IMDb/RT/Metacritic. Self-hosted from `public/attribution/tmdb-logo.svg` —
 * a byte-for-byte copy of TMDB's own SVG (downloaded from the same URL this
 * constant used to point at directly), not bundled via Vite's asset
 * pipeline so its filename/URL stays stable rather than content-hashed.
 * Hotlinking TMDB's own server was tried first and dropped: their CDN
 * proved unreliable enough in practice to make the attribution badge look
 * broken (confirmed live 2026-08-24), and neither TMDB's attribution page
 * nor their API terms of use require serving the asset live from their own
 * domain — the attribution page itself offers the SVG as a download, and
 * the terms only require the logo be used unmodified and less prominently
 * than this app's own branding. If TMDB ever redesigns this logo, this
 * copy needs a manual re-download to stay current — an accepted tradeoff
 * against a hotlink that can silently fail. Shared here rather than
 * duplicated per page, unlike this codebase's usual per-file icon
 * precedent — an attribution constraint attached to it is worth keeping
 * in one place rather than risking copies drifting apart. */
export const TMDB_LOGO_URL = '/attribution/tmdb-logo.svg'
