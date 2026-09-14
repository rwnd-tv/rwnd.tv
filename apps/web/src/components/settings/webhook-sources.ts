import type { WebhookSource } from '@rwnd/shared'

/**
 * Each source's real icon, self-hosted the same way `lib/tmdb.ts`'s
 * `TMDB_LOGO_URL` is — a byte-for-byte copy under `public/attribution/`,
 * not bundled via Vite's asset pipeline, so hotlinking a third party's own
 * CDN can't make this badge look broken. Every one is unmodified and used
 * only as a small compatibility indicator (never as rwnd.tv's own logo,
 * never implying endorsement) — see `docs/adr/0007-security-posture.md`'s
 * 2026-09-14 icon-sourcing note for the full reasoning per source, and the
 * README's "Trademarks" section for the disclaimer this UI's own
 * `settings.webhooks.disclaimer` string mirrors. Sourced 2026-09-14:
 * - **Plex**: `icon-192x192.png` from `watch.plex.tv/icons/`, the actual
 *   app's own current icon — brand.plex.tv's downloadable kit only offers
 *   the 2022 wordmark refresh, which doesn't crop down to a small square.
 * - **Jellyfin**: `icon-transparent.svg` from the `jellyfin-ux` repo,
 *   CC-BY-SA-4.0 (license text is embedded in the SVG file itself).
 * - **Emby**: `android-chrome-192x192.png` from emby.media — no separate
 *   brand-asset page exists to pull from instead.
 * - **Tautulli**: `logo-circle.png` from the `tautulli.github.io` repo
 *   (the project's own site source) — no license is declared on that
 *   repo either way; used on the strength of it being a small, accurately-
 *   labelled compatibility icon for an open-source project, not a
 *   commercial claim.
 */
export const SOURCE_ICON_URL: Record<WebhookSource, string> = {
  plex: '/attribution/plex-icon.png',
  jellyfin: '/attribution/jellyfin-icon.svg',
  emby: '/attribution/emby-icon.png',
  tautulli: '/attribution/tautulli-icon.png',
}

// Tautulli's webhook body has no fixed shape — the self-hoster pastes this
// into the "Watched" trigger's Data tab. Kept as a plain constant (not
// i18n: it's a JSON/token template, not prose) with the same content as
// docs/self-hosting.md's Tautulli section — that duplication is
// unavoidable, since markdown can't import a JS constant, but keeping the
// two in sync matters, since apps/api/src/webhooks/tautulli.ts's parser is
// built against exactly these field names. See that file's own doc
// comment for what each field is used for. Shared by the create wizard
// (WebhooksPanel.tsx) and every existing Tautulli webhook's own setup
// instructions (WebhookCard.tsx) rather than duplicated between them.
export const TAUTULLI_JSON_TEMPLATE = `{
  "action": "{action}",
  "media_type": "{media_type}",
  "show_name": "{show_name}",
  "season_num": "{season_num}",
  "episode_num": "{episode_num}",
  "imdb_id": "{imdb_id}",
  "themoviedb_id": "{themoviedb_id}",
  "thetvdb_id": "{thetvdb_id}",
  "rating_key": "{rating_key}",
  "user_id": "{user_id}",
  "user": "{user}",
  "username": "{username}",
  "server_machine_id": "{server_machine_id}"
}`

export function webhookUrl(source: WebhookSource, token: string): string {
  return `${window.location.origin}/api/v1/webhooks/${source}/${token}`
}
