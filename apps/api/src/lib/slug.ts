import { eq, like, or } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { movies, shows } from '@rwnd/db'

/** Same transform as the `0004_same_iron_patriot.sql` (shows) and
 * `0009_concerned_randall_flagg.sql` (movies) backfill migrations — keep
 * all three in sync, or old and new rows end up with inconsistently
 * formatted slugs. Exported for apps/api/src/backup/paths.ts, which reuses
 * it verbatim for the human-readable part of a backup's filename — same
 * "lowercase, non-alphanumeric runs collapse to one dash" rule applies
 * equally well to free-text there. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The `-2`, `-3`, ... suffix scan shared by generateUniqueShowSlug and
 * generateUniqueMovieSlug below — `existing` is every slug already starting
 * with `base` (an exact match plus any `base-N` rows). Matches the
 * numbering the backfill migrations use for pre-existing duplicates, so old
 * and newly-resolved rows stay consistent.
 */
function pickUniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base

  const takenSuffixes = new Set(
    existing
      .map((slug) => Number(slug.slice(base.length + 1)))
      .filter((n) => Number.isInteger(n) && n > 1),
  )
  let suffix = 2
  while (takenSuffixes.has(suffix)) suffix++
  return `${base}-${suffix}`
}

/**
 * A show's slug is assigned once, when it's first resolved (resolveShow()
 * in media.ts), and never recomputed — so a show keeps the same URL even if
 * a later metadata refresh changes its title. Collisions (two shows with
 * the same title *and* year) get a `-2`, `-3`, ... suffix via
 * pickUniqueSlug above.
 */
export async function generateUniqueShowSlug(
  db: Database | Tx,
  title: string,
  year: number | null,
): Promise<string> {
  const base = year ? `${slugify(title)}-${year}` : slugify(title)
  const existing = await db
    .select({ slug: shows.slug })
    .from(shows)
    .where(or(eq(shows.slug, base), like(shows.slug, `${base}-%`)))
  return pickUniqueSlug(
    base,
    existing.map((row) => row.slug),
  )
}

/**
 * Movie counterpart of generateUniqueShowSlug above — same "assigned once,
 * never recomputed" and collision-numbering behaviour, querying `movies`
 * instead of `shows`. Movie titles collide more often than show titles
 * (remakes, re-releases, TMDB entries with no release date at all), so the
 * `-2`/`-3` suffixing here is exercised more in practice.
 */
export async function generateUniqueMovieSlug(
  db: Database | Tx,
  title: string,
  year: number | null,
): Promise<string> {
  const base = year ? `${slugify(title)}-${year}` : slugify(title)
  const existing = await db
    .select({ slug: movies.slug })
    .from(movies)
    .where(or(eq(movies.slug, base), like(movies.slug, `${base}-%`)))
  return pickUniqueSlug(
    base,
    existing.map((row) => row.slug),
  )
}
