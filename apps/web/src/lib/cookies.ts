/**
 * Minimal client-side cookie helpers for UI-only preferences (e.g. the
 * gallery pages' remembered sort order — see ShowsPage.tsx/MoviesPage.tsx).
 * Deliberately not localStorage: these are meant to behave as ordinary
 * session cookies, cleared when the browser closes, matching what was
 * asked for. Unrelated to the httpOnly auth session cookie
 * (apps/api/src/lib/cookies.ts) — this module never touches that one.
 */

export function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  const raw = match?.[1]
  return raw === undefined ? undefined : decodeURIComponent(raw)
}

/** Sets a true session cookie — no Max-Age/Expires, so it lasts only until
 * the browser closes. Not `Secure`: the local dev loop runs over plain
 * http://localhost, and this never carries anything sensitive. */
export function setSessionCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`
}
