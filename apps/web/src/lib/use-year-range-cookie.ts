import { useEffect, useRef, useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

export interface AfterBefore {
  after: number
  before: number
}

/** Clamps a stored/parsed range into `[min, max]` and repairs an impossible
 * `after > before` (e.g. the library's year range shifted since the cookie
 * was written — a new, earlier-released show got imported) by resetting to
 * the full range rather than showing a filter that would hide everything. */
function normalize(range: AfterBefore, min: number, max: number): AfterBefore {
  const after = Math.min(Math.max(range.after, min), max)
  const before = Math.min(Math.max(range.before, min), max)
  return after <= before ? { after, before } : { after: min, before: max }
}

function parseStoredRange(raw: string | undefined, min: number, max: number): AfterBefore {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as AfterBefore).after === 'number' &&
        typeof (parsed as AfterBefore).before === 'number'
      ) {
        return normalize(parsed as AfterBefore, min, max)
      }
    } catch {
      // Malformed cookie — fall through to the full-range default.
    }
  }
  return { after: min, before: max }
}

/**
 * Same session-cookie approach as useSortCookie.ts / useGenreFilterCookie.ts
 * — remembered while browsing, cleared when the browser closes.
 *
 * `min`/`max` are the library's actual year range (see yearRange() in
 * library-filter.ts). This hook is always called from ShowsPage.tsx's first
 * render — before `data` has loaded, while `isLoading` is still true — so
 * on that first call `min`/`max` arrive as a `0, 0` placeholder, not the
 * real range. `ready` tells the hook when they've become real; until then
 * it holds `{ after: min, before: max }` (i.e. `0, 0`) without persisting
 * anything, then seeds itself from the cookie exactly once, the first time
 * `ready` flips true.
 *
 * A first attempt used a "has this effect run yet" ref with no `ready`
 * input — broken, because effects fire after the *first* render too, so it
 * marked itself "already hydrated" using the 0/0 placeholder before real
 * data ever arrived, and never got a second chance (found live: sliders
 * stuck at 0/0 forever). Needs an explicit "the real range is available
 * now" signal from the caller, not just "min/max changed".
 */
export function useYearRangeCookie(
  cookieName: string,
  min: number,
  max: number,
  ready: boolean,
): [AfterBefore, (next: AfterBefore) => void] {
  const [range, setRange] = useState<AfterBefore>(() =>
    ready ? parseStoredRange(getCookie(cookieName), min, max) : { after: min, before: max },
  )
  const hydrated = useRef(ready)

  useEffect(() => {
    if (!ready || hydrated.current) return
    hydrated.current = true
    setRange(parseStoredRange(getCookie(cookieName), min, max))
  }, [ready, min, max, cookieName])

  function update(next: AfterBefore) {
    setRange(next)
    setSessionCookie(cookieName, JSON.stringify(next))
  }

  return [range, update]
}
