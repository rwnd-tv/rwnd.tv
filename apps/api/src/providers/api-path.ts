/**
 * Builds a provider request path, percent-encoding every interpolated
 * value while leaving the template's own `/` separators alone.
 * `request()` in tmdb.ts/tvdb.ts can't encode the composed path itself —
 * that would also eat the separators of `/tv/1396/season/1/episode/1` —
 * so encoding has to happen per value, which is what this does by
 * construction rather than by convention at each call site.
 *
 * `externalId` traces back to attacker-controlled webhook payload content
 * (Plex `Metadata.Guid[].id`, Tautulli's templated fields — see
 * apps/api/src/lib/external-match.ts): anyone holding a valid webhook
 * token controls it. `new URL()` normalizes an injected `..` away, but
 * neither `?` (which would merge extra parameters into the request's own
 * searchParams) nor `#` (which would truncate the path into a fragment).
 * M4 review Stage 1, docs/TODO.md.
 */
export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce(
    (acc, literal, i) => acc + literal + (i < values.length ? encodeURIComponent(values[i]!) : ''),
    '',
  )
}
