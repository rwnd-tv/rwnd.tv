import { useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

/**
 * Which of a fixed, small set of string-literal "kinds" to show — a plain
 * "shown" set, not an include/exclude-per-item shape (see
 * use-activity-kind-filter-cookie.ts, this hook's original, single-purpose
 * form, for why that distinction matters). Generalized so
 * CalendarPage.tsx's watch/episode/release filter can share it with
 * HistoryPage.tsx's activity-kind filter rather than re-deriving the same
 * cookie-parsing/fallback rules.
 *
 * An empty or malformed *stored* cookie falls back to `defaultKinds`
 * (every kind, unless a caller narrows it — see
 * use-activity-kind-filter-cookie.ts), same tolerant treatment as every
 * other filter cookie hook — but a deliberate empty selection made via
 * `update()` is respected as-is (rendered as zero results) rather than
 * silently snapped back to the default: unlike an include/exclude genre
 * filter, there's no dead end here — any toggle click gets you straight
 * back out.
 */
export function useKindFilterCookie<K extends string>(
  cookieName: string,
  allKinds: readonly K[],
  defaultKinds: readonly K[] = allKinds,
): [Set<K>, (next: Set<K>) => void] {
  const knownKinds = new Set<string>(allKinds)

  const [shown, setShown] = useState<Set<K>>(() => {
    const raw = getCookie(cookieName)
    if (!raw) return new Set(defaultKinds)
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return new Set(defaultKinds)
      const kinds = parsed.filter((k): k is K => typeof k === 'string' && knownKinds.has(k))
      return kinds.length > 0 ? new Set(kinds) : new Set(defaultKinds)
    } catch {
      return new Set(defaultKinds)
    }
  })

  function update(next: Set<K>) {
    setShown(next)
    setSessionCookie(cookieName, JSON.stringify([...next]))
  }

  return [shown, update]
}
