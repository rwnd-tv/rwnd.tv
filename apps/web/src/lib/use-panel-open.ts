import { useCallback, useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

/**
 * Collapsed/expanded state for one `<details>` panel (Account/Settings/
 * Import pages), remembered in a session cookie so it survives
 * navigating between pages — a client-side route change fully remounts
 * these page components, which would otherwise reset every panel back
 * to its hardcoded default every time (James, 2026-09-02: "keep the
 * panel collapsed state in some kind of session state, maybe a
 * cookie"). Same "remembered for this browsing session only, not a
 * permanent profile preference" contract `useSortCookie.ts` already
 * established for the gallery pages' sort order — reused rather than
 * introducing localStorage alongside it for what's conceptually the
 * same kind of state.
 *
 * `cookieName` must be unique per panel (every collapsible panel in the
 * app gets its own `panel*` cookie, not one shared blob) — see call
 * sites for the naming convention (`panelAccountProfile`,
 * `panelSettingsAbout`, `panelImportProgress`, ...).
 */
export function usePanelOpen(
  cookieName: string,
  defaultOpen = false,
): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    const stored = getCookie(cookieName)
    return stored === undefined ? defaultOpen : stored === '1'
  })

  // Stabilized like React's own `useState` setter — ImportProgress.tsx
  // passes this into a `useEffect` dependency array, which would
  // otherwise fire on every render if a fresh closure came back each
  // time.
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      setSessionCookie(cookieName, next ? '1' : '0')
    },
    [cookieName],
  )

  return [open, setOpen]
}
