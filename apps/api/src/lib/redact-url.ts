/**
 * Strips known-sensitive query parameters from a URL before it can reach
 * a log line or a thrown error message (M3 security review, F-09) —
 * TMDB's v3 API requires its key as a query parameter
 * (`providers/tmdb.ts`'s `request()`; TVDB by contrast uses a Bearer
 * header, so it isn't at risk the same way). A non-2xx TMDB response
 * already builds its error message from the request `path` alone, never
 * the full URL, so the actual gap this closes is a network-level fetch()
 * failure (DNS, connection refused, ...) — those propagate whatever
 * message the underlying HTTP client attaches, which isn't this
 * codebase's to fully control, so `request()` catches that case and
 * rethrows using this instead of letting the raw error (and whatever it
 * may have captured) reach a log.
 */
const SENSITIVE_QUERY_PARAMS = ['api_key', 'apikey', 'key', 'token']

export function redactUrl(input: string | URL): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return typeof input === 'string' ? input : String(input)
  }
  for (const param of SENSITIVE_QUERY_PARAMS) {
    if (url.searchParams.has(param)) url.searchParams.set(param, '[redacted]')
  }
  return url.toString()
}
