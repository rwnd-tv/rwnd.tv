/**
 * Strips bearer secrets out of an inbound request path before it can reach
 * a log line (middleware/request-log.ts). Distinct from `redact-url.ts`
 * beside it, which strips sensitive *query parameters* from *outbound*
 * provider URLs — that helper is no use here, because these secrets are
 * URL path *segments*, not query parameters.
 *
 * Two routes carry a bearer credential in their path, both for the same
 * unavoidable reason (neither a media server's webhook agent nor a
 * calendar app can attach an Authorization header — see
 * `apps/api/src/routes/webhooks.ts` and `routes/calendar.ts`, and
 * `docs/adr/0007-security-posture.md`, which accepts "token in a URL, in
 * transit, over TLS" as a risk). That acceptance does **not** extend to
 * "token at rest in a plaintext container log, forever" — writing
 * `c.req.path` unscrubbed would silently convert an accepted risk into an
 * unaccepted one, which is why this runs before anything is emitted.
 *
 * Two layers, deliberately:
 *  1. Exact route shapes, mirroring `middleware/auth.ts`'s `WEBHOOK_PATH`
 *     and `CALENDAR_FEED_PATH` but anchored to the full `/api/v1/...`
 *     path (that file's own regexes are tested against a path with
 *     `/api/v1` already stripped by `requireSession` — this module is
 *     mounted at the outer `app`, before that prefix is stripped). Kept
 *     as a separate definition rather than importing those, since these
 *     need capture groups to rebuild the path; those are pure matchers
 *     used for an auth decision.
 *  2. A prefix sweep over every segment, because layer 1 only catches a
 *     *correctly shaped* URL: a typo'd `…/feed.ic`, a trailing slash, or a
 *     probe at a path that doesn't exist still carries a live secret into
 *     a 404's log line. The prefixes are this app's own
 *     (`lib/tokens.ts`'s `rwnd_`, `lib/calendar-feeds.ts`'s `rwndcal_`),
 *     chosen at generation time precisely so a leaked string is
 *     identifiable at a glance.
 *
 * Query strings are excluded from `c.req.path` entirely, so nothing here
 * deals with them — and the logger built on this should never record one
 * anyway: search terms and date ranges are the user's own data, not
 * security-relevant.
 *
 * Any future new token-in-path route must be added to `TOKEN_PATH_PATTERNS`
 * below too — see the cross-reference comment at `middleware/auth.ts`'s
 * `WEBHOOK_PATH`.
 */
const REDACTED = '[redacted]'

const TOKEN_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/^(\/api\/v1\/webhooks\/[^/]+\/)[^/]+$/, `$1${REDACTED}`],
  [/^(\/api\/v1\/calendar\/)[^/]+(\/feed\.ics)$/, `$1${REDACTED}$2`],
]

const TOKEN_SEGMENT_PREFIXES = ['rwnd_', 'rwndcal_']

/** Bounds one pathological request's contribution to the log. */
const MAX_LOGGED_PATH_LENGTH = 200

function truncate(path: string): string {
  return path.length > MAX_LOGGED_PATH_LENGTH ? `${path.slice(0, MAX_LOGGED_PATH_LENGTH)}…` : path
}

export function redactPath(path: string): string {
  for (const [pattern, replacement] of TOKEN_PATH_PATTERNS) {
    if (pattern.test(path)) return truncate(path.replace(pattern, replacement))
  }
  const swept = path
    .split('/')
    .map((segment) =>
      TOKEN_SEGMENT_PREFIXES.some((prefix) => segment.startsWith(prefix)) ? REDACTED : segment,
    )
    .join('/')
  return truncate(swept)
}
