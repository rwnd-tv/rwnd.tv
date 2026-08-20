import { useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

/** Same session-cookie approach as useSortCookie.ts / useGenreFilterCookie.ts
 * — remembered while browsing, cleared when the browser closes. Generic
 * over any single on/off filter toggle (currently just the "Unknown"
 * watched-date checkbox — see WatchedYearFilterPanel.tsx) rather than a
 * one-off hook per toggle. */
export function useBooleanCookie(
  cookieName: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = getCookie(cookieName)
    return stored === undefined ? defaultValue : stored === 'true'
  })

  function update(next: boolean) {
    setValue(next)
    setSessionCookie(cookieName, String(next))
  }

  return [value, update]
}
