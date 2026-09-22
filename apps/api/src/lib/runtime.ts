import { sql, inArray } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes } from '@rwnd/db'

// Duration for a history/stats row whose own runtime, and its show's
// sibling median (see medianRuntimeByShow below), are both unavailable —
// rare enough in practice (38 of 10,701 real episode plays on the
// reference instance, always a whole season TMDB never had a runtime for
// at all) that a fixed guess isn't worth more complexity. It only ever
// means "no better number was findable," never a real duration.
export const DEFAULT_EPISODE_RUNTIME_MINUTES = 30

// Same idea for a movie with no cached runtime at all — much rarer than
// the episode case (movies almost always carry a runtime from TMDB), so
// this is a plain conventional feature length rather than anything
// computed. Not worth a per-user median query for a value this rare.
export const DEFAULT_MOVIE_RUNTIME_MINUTES = 90

/**
 * A history/stats row's own runtime, or (for an episode) the median
 * runtime of other episodes of the same show, or the flat episode default
 * above — in that order. Movies with no runtime fall straight to the flat
 * movie default (no per-show/per-user median). `medianByShowId` covers
 * only shows a caller actually needs one for — see medianRuntimeByShow.
 */
export function runtimeForRow(
  row: {
    movieRuntimeMinutes: number | null
    episodeRuntimeMinutes: number | null
    showId: string | null
  },
  medianByShowId: Map<string, number>,
): number {
  const own = row.showId === null ? row.movieRuntimeMinutes : row.episodeRuntimeMinutes
  if (own !== null) return own
  if (row.showId === null) return DEFAULT_MOVIE_RUNTIME_MINUTES
  return medianByShowId.get(row.showId) ?? DEFAULT_EPISODE_RUNTIME_MINUTES
}

/**
 * Per-show median episode runtime, for exactly the shows named in
 * `showIds` — a **separate top-level query**, not a subquery nested
 * inside a joinless Drizzle query: docs/TODO_ARCHIVE.md records a live bug
 * where a raw `sql` fragment nested that way silently lost its own column
 * qualifiers, and a separate top-level query sidesteps that shape
 * entirely. `percentile_cont` itself ignores NULL inputs, so this is
 * correctly "the median of the episodes that do have a runtime."
 */
export async function medianRuntimeByShow(
  db: Database,
  showIds: string[],
): Promise<Map<string, number>> {
  const medianByShowId = new Map<string, number>()
  if (showIds.length === 0) return medianByShowId

  const medianRows = await db
    .select({
      showId: episodes.showId,
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${episodes.runtimeMinutes})`,
    })
    .from(episodes)
    .where(inArray(episodes.showId, showIds))
    .groupBy(episodes.showId)

  for (const row of medianRows) {
    if (row.median !== null) medianByShowId.set(row.showId, Math.round(row.median))
  }
  return medianByShowId
}
