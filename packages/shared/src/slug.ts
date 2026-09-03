/** Same transform as the `0004_same_iron_patriot.sql` (shows) and
 * `0009_concerned_randall_flagg.sql` (movies) backfill migrations run by the
 * API (apps/api/src/lib/slug.ts, which re-exports this) — keep all three in
 * sync, or old and new rows end up with inconsistently formatted slugs. Also
 * used client-side (apps/web/src/components/admin/UserRow.tsx) for the
 * purely cosmetic slug segment of `/admin/users/{id}/{slug}`, which is never
 * persisted or checked for uniqueness. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
