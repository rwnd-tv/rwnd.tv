import { and, eq, sql } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { droppedShows } from '@rwnd/db'

/**
 * "Trakt state and a manual override, collapsed to one effective value" —
 * the same `manualDropped ?? traktDropped ?? false` derivation duplicated
 * across apps/api/src/routes/library/shows.ts (the shows gallery, the
 * undropped filter, the show detail page) and apps/api/src/export/build.ts.
 * Not a refactor of those call sites — this is only for GET /activity-feed's
 * `dropped` branch (apps/api/src/routes/activity.ts), which needed the same
 * logic as a raw SQL expression rather than post-query JS. See
 * droppedShows's own doc comment in packages/db/src/schema.ts for why the
 * two-column split exists at all.
 */
export function effectiveDroppedExpr() {
  return sql<boolean>`coalesce(${droppedShows.manualDropped}, ${droppedShows.traktDropped}, false)`
}

/** Companion to effectiveDroppedExpr() above — the timestamp that goes with
 * whichever of the two states won. */
export function effectiveDroppedAtExpr() {
  return sql<Date | null>`case when ${droppedShows.manualDropped} is not null then ${droppedShows.manualDroppedAt} else ${droppedShows.traktDroppedAt} end`
}

/**
 * Un-drops a show — extracted from the DELETE /library/shows/{slug}/dropped
 * route (routes/library/shows.ts) so DELETE /activity-feed's `dropped`
 * branch can reuse the exact same override-vs-clear semantics: a `dropped`
 * activity entry is "removed" by un-dropping the show, not by deleting a row
 * (the row records derived state, not a loggable event — see
 * removeActivityRequestSchema's doc comment,
 * packages/shared/src/schemas/activity.ts). A no-op if the show was never
 * dropped. shows.ts's own route is left as-is rather than refactored to
 * call this — not a cleanup pass.
 */
export async function undropShow(db: Database | Tx, userId: string, showId: string) {
  const manualDroppedAt = new Date()
  const [row] = await db
    .update(droppedShows)
    .set({
      manualDropped: sql`case when ${droppedShows.traktDropped} = true then false else null end`,
      manualDroppedAt: sql`case when ${droppedShows.traktDropped} = true then ${manualDroppedAt.toISOString()}::timestamptz else null end`,
    })
    .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, showId)))
    .returning({
      traktDropped: droppedShows.traktDropped,
      traktDroppedAt: droppedShows.traktDroppedAt,
      manualDropped: droppedShows.manualDropped,
      manualDroppedAt: droppedShows.manualDroppedAt,
    })

  if (!row) return { dropped: false, droppedAt: null as Date | null }
  const dropped = row.manualDropped ?? row.traktDropped ?? false
  const droppedAt = row.manualDropped != null ? row.manualDroppedAt : row.traktDroppedAt
  return { dropped, droppedAt: dropped ? droppedAt : null }
}
