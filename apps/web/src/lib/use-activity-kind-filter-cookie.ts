import { useState } from 'react'
import { ACTIVITY_KINDS, type ActivityKind } from '@rwnd/shared'
import { getCookie, setSessionCookie } from './cookies.js'

const KNOWN_KINDS = new Set<string>(ACTIVITY_KINDS)

/**
 * Which activity kinds to show on HistoryPage.tsx's activity feed — a plain
 * "shown" set, not use-genre-filter-cookie.ts's include/exclude-per-item
 * shape. `kind` is single-valued per entry (unlike a show's several
 * genres), so mixing "include watch" with "exclude rating" has no clean
 * combined meaning the way it does for genres — a checked/unchecked set is
 * what the four fixed kinds actually need. An empty or malformed *stored*
 * cookie defaults to "show everything", same tolerant treatment as every
 * other filter cookie hook — but a deliberate empty selection made via
 * `update()` is respected as-is (HistoryPage.tsx renders it as zero
 * results, same as any other filter narrowing to nothing) rather than
 * silently snapped back to "all", which — unlike the include/exclude genre
 * filter this was modelled on — has no dead end here: any checkbox click
 * gets you straight back out.
 */
export function useActivityKindFilterCookie(
  cookieName: string,
): [Set<ActivityKind>, (next: Set<ActivityKind>) => void] {
  const [shown, setShown] = useState<Set<ActivityKind>>(() => {
    const raw = getCookie(cookieName)
    if (!raw) return new Set(ACTIVITY_KINDS)
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return new Set(ACTIVITY_KINDS)
      const kinds = parsed.filter(
        (k): k is ActivityKind => typeof k === 'string' && KNOWN_KINDS.has(k),
      )
      return kinds.length > 0 ? new Set(kinds) : new Set(ACTIVITY_KINDS)
    } catch {
      return new Set(ACTIVITY_KINDS)
    }
  })

  function update(next: Set<ActivityKind>) {
    setShown(next)
    setSessionCookie(cookieName, JSON.stringify([...next]))
  }

  return [shown, update]
}
