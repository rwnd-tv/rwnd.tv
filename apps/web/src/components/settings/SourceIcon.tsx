import { WEBHOOK_SOURCE_LABELS, type WebhookSource } from '@rwnd/shared'
import { SOURCE_ICON_URL } from './webhook-sources.js'

/**
 * One media server's real icon, rendered directly with no backdrop chip —
 * every source's asset here (`webhook-sources.ts`'s doc comment covers
 * where each came from) is a transparent-cornered app icon, the PWA/
 * touch-icon style all four happen to share, so it composites cleanly
 * against this app's own background at full size without a white square
 * behind it flattening the contrast or shrinking the mark itself down to
 * fit inside a chip's padding (James, 2026-09-14: the chip read as
 * jarring against the dark theme and made the logos too small).
 *
 * The "?" fallback is for a legacy token whose `source` was never
 * backfilled (see `apiTokens.source`'s doc comment,
 * packages/db/src/schema.ts) — there's no icon to show yet, so this one
 * case still gets a plain bordered placeholder box instead of a bare
 * question mark floating on the page.
 */
export function SourceIcon({
  source,
  className = 'h-9 w-9',
}: {
  source: WebhookSource | null
  className?: string
}) {
  if (!source) {
    return (
      <span
        className={`flex flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-bold text-[var(--color-fg-muted)] ${className}`}
      >
        ?
      </span>
    )
  }

  return (
    <img
      src={SOURCE_ICON_URL[source]}
      alt={WEBHOOK_SOURCE_LABELS[source]}
      className={`flex-shrink-0 object-contain ${className}`}
    />
  )
}
