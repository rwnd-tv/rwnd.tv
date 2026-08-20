import { eq, like, or } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { shows } from '@rwnd/db'

/** Same transform as the `0004_same_iron_patriot.sql` backfill migration —
 * keep them in sync, or old and new shows end up with inconsistently
 * formatted slugs. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A show's slug is assigned once, when it's first resolved (resolveShow()
 * in media.ts), and never recomputed — so a show keeps the same URL even if
 * a later metadata refresh changes its title. Collisions (two shows with
 * the same title *and* year) get a `-2`, `-3`, ... suffix, matching the
 * numbering the backfill migration uses for pre-existing duplicates.
 */
export async function generateUniqueShowSlug(
  db: Database,
  title: string,
  year: number | null,
): Promise<string> {
  const base = year ? `${slugify(title)}-${year}` : slugify(title)

  const existing = await db
    .select({ slug: shows.slug })
    .from(shows)
    .where(or(eq(shows.slug, base), like(shows.slug, `${base}-%`)))

  if (!existing.some((row) => row.slug === base)) return base

  const takenSuffixes = new Set(
    existing
      .map((row) => Number(row.slug.slice(base.length + 1)))
      .filter((n) => Number.isInteger(n) && n > 1),
  )
  let suffix = 2
  while (takenSuffixes.has(suffix)) suffix++
  return `${base}-${suffix}`
}
