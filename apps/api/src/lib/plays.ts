import { and, eq, gte, lt, or } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { plays } from '@rwnd/db'

/** The two automated sources this dedup check applies between — 'manual'
 * is deliberately excluded (see hasCrossSourceDuplicate's own doc
 * comment), and any future automated source (Tautulli, Jellyfin, ...)
 * should be added here once it exists. */
const AUTOMATED_SOURCES = ['import', 'plex'] as const
type AutomatedSource = (typeof AUTOMATED_SOURCES)[number]

/**
 * Whether a play already exists for this user/entity/calendar day (UTC)
 * from a *different* automated source than `source`. Trakt import and the
 * Plex webhook can each independently capture the same real watch — a
 * user running Trakt's own Plex scrobbling alongside rwnd.tv's direct
 * webhook, the live case this was found from (see
 * docs/TODO_ARCHIVE.md) — and unlike a same-source retry/re-import,
 * that's not caught by `plays.sourceRef`'s own per-source uniqueness
 * (`plays_user_source_ref_idx`, scoped to `(userId, source, sourceRef)`).
 *
 * Scoped to 'import'/'plex' only, deliberately: a manual watch is a
 * user's own explicit action, not a scrobble, and can legitimately
 * coexist with (or precede) an automated one on the same day without
 * being a duplicate — this only guards against two *automated* pipelines
 * independently reporting the same underlying event.
 *
 * "Same calendar day" is an accepted, imperfect heuristic (see the TODO
 * this closes): a genuine same-day rewatch caught once by each pipeline
 * is rare but possible, and would be silently dropped by this check —
 * judged an acceptable tradeoff against the alternative (every dual-
 * pipeline watch double-counted).
 */
export async function hasCrossSourceDuplicate(
  db: Database,
  userId: string,
  entityRef: { movieId: string } | { episodeId: string },
  watchedAt: Date,
  source: AutomatedSource,
): Promise<boolean> {
  const dayStart = new Date(`${watchedAt.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const otherSources = AUTOMATED_SOURCES.filter((s) => s !== source)

  const [existing] = await db
    .select({ id: plays.id })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        'movieId' in entityRef
          ? eq(plays.movieId, entityRef.movieId)
          : eq(plays.episodeId, entityRef.episodeId),
        or(...otherSources.map((s) => eq(plays.source, s))),
        gte(plays.watchedAt, dayStart),
        lt(plays.watchedAt, dayEnd),
      ),
    )
    .limit(1)
  return Boolean(existing)
}
