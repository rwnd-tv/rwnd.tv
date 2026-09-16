import { useCallback, useRef, useState } from 'react'

/**
 * "Copied!" label-swap feedback for a clipboard copy button — consolidates
 * five independent hand-rolled copies (InvitesPanel.tsx, TokenWebhookLinks.tsx,
 * WebhookCard.tsx, WebhooksPanel.tsx, CalendarFeedsPanel.tsx; M4 review's
 * `/code-review high` pass, docs/TODO.md).
 *
 * Two shapes existed across those five: a plain boolean (one copy target per
 * component) and a keyed one (`WebhookCard`'s 'url'/'template', `CalendarFeedsPanel`'s
 * per-feed-type) — the keyed sites already had a functional-updater guard so
 * a superseded copy's timeout can't clear a newer one's flag, which this
 * hook applies unconditionally rather than only for callers that ask for it,
 * since it's strictly safer and free. `K`'s `true` default makes the boolean
 * case just `copy(text)` / `copied` with no key ever touched.
 *
 * Deliberately unchanged from all five originals: `writeText`'s rejection is
 * swallowed (`void`), and there's no cleanup of the pending timeout on
 * unmount — both are pre-existing gaps in every site this replaces, not
 * something to fix as part of a reuse cleanup.
 */
export function useCopyFeedback<K = true>(
  timeoutMs = 2000,
): {
  copied: K | undefined
  isCopied: (key: K) => boolean
  copy: (text: string, key?: K) => void
  /** Clears the copied flag immediately, without waiting for the timeout —
   * InvitesPanel.tsx/TokenWebhookLinks.tsx need this to hide a stale
   * "Copied" label the instant a *new* code/link is revealed. */
  reset: () => void
} {
  const [copied, setCopied] = useState<K>()
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const copy = useCallback(
    (text: string, key: K = true as K) => {
      void navigator.clipboard.writeText(text)
      setCopied(key)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setCopied((current) => (current === key ? undefined : current))
      }, timeoutMs)
    },
    [timeoutMs],
  )

  const isCopied = useCallback((key: K) => copied === key, [copied])

  const reset = useCallback(() => {
    clearTimeout(timeoutRef.current)
    setCopied(undefined)
  }, [])

  return { copied, isCopied, copy, reset }
}
