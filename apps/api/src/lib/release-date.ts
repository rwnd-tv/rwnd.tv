import { sql, type SQL } from 'drizzle-orm'
import { movies } from '@rwnd/db'

/**
 * ISO 3166-1 alpha-2 region from a BCP-47 locale tag (e.g. 'en-GB' → 'GB'),
 * or null when the tag carries no region subtag ('en') or is malformed.
 * `users.locale` is a plain text column (packages/db/src/schema.ts),
 * validated only loosely at the API boundary, so this must survive
 * arbitrary junk without throwing — same reasoning as calendar/build.ts's
 * `dayFormatter` try/catch around an unvalidated `users.timezone`.
 *
 * Deliberately no `.maximize()` (which would turn 'en' into 'en-Latn-US',
 * silently inventing a US preference) and no US default — `null` already
 * has the correct meaning downstream: "no regional preference", which
 * falls through to the movie's primary release date.
 */
export function localeRegion(locale: string): string | null {
  try {
    return new Intl.Locale(locale).region ?? null
  } catch {
    return null
  }
}

/** A cached movie row's release-date fields — the subset both
 * `resolveReleaseDate` and the SQL form below need. */
export interface ReleaseDateRow {
  releaseDate: string | null
  releaseDates: Record<string, string> | null
}

export interface ResolvedReleaseDate {
  date: string | null
  /** Non-null only when `date` actually came from `region` — never set on
   * a primary-date fallback, so a caller (the movie detail page) never
   * shows a region's flag next to a date that isn't actually that
   * region's. */
  region: string | null
}

/**
 * JS form of the per-user release-date resolution, for the movie detail
 * route. Must stay in lockstep with `releaseDateExpr` below (its SQL
 * twin, used by the Movies calendar feed) — `release-date.test.ts` asserts
 * both agree on the same fixtures.
 */
export function resolveReleaseDate(
  movie: ReleaseDateRow,
  region: string | null,
): ResolvedReleaseDate {
  const regional = region ? (movie.releaseDates?.[region] ?? null) : null
  return regional !== null ? { date: regional, region } : { date: movie.releaseDate, region: null }
}

/**
 * SQL form of `resolveReleaseDate` above, for `apps/api/src/calendar/
 * build.ts`'s `buildMoviesEvents` — used in SELECT/WHERE/ORDER BY so the
 * per-user resolved date, not just the primary one, drives `futureOnly`
 * filtering and the feed's `.limit()`. `jsonb_extract_path_text(...)`
 * rather than `->>`, which is overloaded on (jsonb, text) and (jsonb,
 * integer) and needs an untyped bind parameter to fall back to
 * preferred-type resolution — the function form has no overload to
 * resolve. `to_char(..., 'YYYY-MM-DD')` rather than a plain `::text` cast,
 * since `date::text` renders per the session's DateStyle rather than a
 * fixed format.
 */
export function releaseDateExpr(region: string | null): SQL<string | null> {
  const primary = sql`to_char(${movies.releaseDate}, 'YYYY-MM-DD')`
  if (region === null) return sql<string | null>`${primary}`
  return sql<
    string | null
  >`coalesce(jsonb_extract_path_text(${movies.releaseDates}, ${region}), ${primary})`
}
