import { useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

/**
 * Sort-order state for a gallery page (ShowsPage.tsx, MoviesPage.tsx),
 * remembered in a session cookie so it survives navigating away and back
 * but not a browser restart — matches what was asked for over a permanent
 * (localStorage/profile) preference. `validValues` guards against a stale
 * cookie from a previous version of the page listing a sort key that no
 * longer exists.
 */
export function useSortCookie<T extends string>(
  cookieName: string,
  validValues: readonly T[],
  defaultValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = getCookie(cookieName)
    return stored && (validValues as readonly string[]).includes(stored)
      ? (stored as T)
      : defaultValue
  })

  function update(next: T) {
    setValue(next)
    setSessionCookie(cookieName, next)
  }

  return [value, update]
}
