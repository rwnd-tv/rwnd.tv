import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { Database, Tx } from '@rwnd/db'
import { plays } from '@rwnd/db'
import type { PlaySource } from '@rwnd/shared'

/** Media-server sources that report a watch live, at (or very near) the
 * moment it actually happened — as opposed to `manual` (a user's own
 * explicit, not-necessarily-live entry) or `import` (a relay of a watch
 * Trakt already has on file, which itself originated somewhere else
 * entirely — Trakt's own scrobbler, another Trakt-connected app, or a
 * manual mark on trakt.tv). Any future live integration (Tautulli, Kodi,
 * ...) belongs here once it exists. */
const ORIGIN_SOURCES = ['plex', 'jellyfin', 'emby'] as const
type OriginSource = (typeof ORIGIN_SOURCES)[number]

export function isOrigin(source: PlaySource): source is OriginSource {
  return (ORIGIN_SOURCES as readonly string[]).includes(source)
}

/** How close two *different* sources' reports of the same entity have to
 * land (in either direction) to be treated as the same real watch rather
 * than two separate ones. Trakt import's `watchedAt` (`apps/api/src/
 * import/trakt.ts`) is Trakt's own recorded timestamp for the watch,
 * which for a Plex-scrobbled event is essentially identical to the Plex
 * webhook's own `watchedAt` — the live duplicate case this was found from
 * (see docs/TODO_ARCHIVE.md) always lands within seconds/minutes, not
 * hours. 15 minutes comfortably covers that plus reporting/sync lag,
 * while still treating a genuinely separate rewatch on a different
 * platform some time later the same day as two real plays (confirmed
 * live 2026-09-11: the same episode played on Jellyfin then Emby about an
 * hour apart was expected to produce two plays, not one — a same-UTC-day
 * heuristic was too coarse for that). */
const CROSS_SOURCE_WINDOW_MS = 15 * 60 * 1000

/** How close two reports from the *same* origin source have to land to be
 * treated as a retry of the same delivery rather than a genuine rewatch —
 * replaces the old `dailySourceRef` day-bucket (webhook-plays.ts's git
 * history) none of these media servers hand over a stable per-delivery
 * id, so a retry can only be recognized by timing. A media server only
 * retries a webhook because the first attempt didn't get a fast 2xx —
 * i.e. because the original delivery is *still being processed* — so a
 * retry landing within a few minutes of the original is the expected
 * shape of the problem, not a rare coincidence. 5 minutes comfortably
 * covers that while staying far shorter than the runtime of anything a
 * user could plausibly rewatch, so it can never mistake a genuine
 * back-to-back rewatch of the same source for a retry. */
const SAME_SOURCE_RETRY_WINDOW_MS = 5 * 60 * 1000

export interface ConflictingPlay {
  id: string
  source: PlaySource
  watchedAt: Date
}

export interface PlayReconciliation {
  /** The newly-inserted row, or null if this event lost the
   * reconciliation (a retry, or outranked by an existing conflict) and
   * nothing was written. */
  inserted: typeof plays.$inferSelect | null
  /** Every existing play this event conflicted with (within the cross-
   * source window), regardless of which way the reconciliation went. */
  conflicts: ConflictingPlay[]
}

function withinMs(a: Date, b: Date, windowMs: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= windowMs
}

async function findConflictingPlays(
  tx: Tx,
  userId: string,
  entityRef: { movieId: string } | { episodeId: string },
  watchedAt: Date,
): Promise<ConflictingPlay[]> {
  const windowStart = new Date(watchedAt.getTime() - CROSS_SOURCE_WINDOW_MS)
  const windowEnd = new Date(watchedAt.getTime() + CROSS_SOURCE_WINDOW_MS)
  return tx
    .select({ id: plays.id, source: plays.source, watchedAt: plays.watchedAt })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        'movieId' in entityRef
          ? eq(plays.movieId, entityRef.movieId)
          : eq(plays.episodeId, entityRef.episodeId),
        gte(plays.watchedAt, windowStart),
        lt(plays.watchedAt, windowEnd),
      ),
    )
}

async function deletePlays(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await tx.delete(plays).where(inArray(plays.id, ids))
}

/**
 * Takes a Postgres advisory lock scoped to this exact (userId, entity)
 * pair for the rest of the enclosing transaction — nothing else touching
 * the same user's watch of the same movie/episode can run concurrently
 * with this reconciliation. Without it, two requests (most plausibly a
 * live webhook and a retry of that very same delivery — see
 * SAME_SOURCE_RETRY_WINDOW_MS's doc comment for why the retry is likely
 * to land *while the original is still mid-flight*, not after) could each
 * run their own conflict check before either has inserted, both see "no
 * conflict yet", and both write a play the reconciliation rules meant to
 * collapse into one.
 *
 * `pg_advisory_xact_lock` (the transaction-scoped variant, not the
 * session one) releases automatically on commit or rollback — no manual
 * unlock needed, and no risk of leaking a held lock if this throws.
 * `hashtext()` collisions between two different (user, entity) pairs are
 * possible but harmless: advisory locks are pure mutual exclusion, not
 * data, so a collision at worst makes two unrelated requests briefly wait
 * on each other — never a correctness issue. This is why the lock is
 * database-held rather than an in-process mutex: it holds even if this
 * app ever ran as more than one process sharing this Postgres, with no
 * extra coordination required.
 */
async function lockEntity(
  tx: Tx,
  userId: string,
  entityRef: { movieId: string } | { episodeId: string },
): Promise<void> {
  const entityId = 'movieId' in entityRef ? entityRef.movieId : entityRef.episodeId
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${entityId}))`)
}

/**
 * Reconciles a new watch event against whatever's already recorded for
 * this user/entity, per a source priority (origin > manual > import)
 * rather than by arrival order — an event's own contained `watchedAt`
 * bears no relation to when it happens to get processed (a Trakt import
 * can run years after, or the same day before, the live watch it's
 * relaying; a manual entry's timestamp is whatever the user picked).
 * Inserts the new play (with `sourceRef` if given) and returns the
 * inserted row, or `inserted: null` if it lost the reconciliation; as a
 * side effect, deletes any already-stored plays that lose to it.
 *
 * The conflict read, any deletes, and the insert all run inside one
 * transaction behind `lockEntity`'s advisory lock — see its own doc
 * comment for why that's needed, not just a defensive nicety.
 *
 * Rules (decided live 2026-09-11 after a same-UTC-day heuristic wrongly
 * collapsed a genuine Jellyfin-then-Emby rewatch an hour apart into one
 * play):
 * - An origin event (`plex`/`jellyfin`/`emby`) is never removed, and
 *   deletes any conflicting `manual`/`import` row outright — it's the
 *   most direct evidence a real watch happened. The one exception: an
 *   existing play from the *same* origin source within
 *   `SAME_SOURCE_RETRY_WINDOW_MS` is treated as a retry of the same
 *   delivery rather than a second watch, and this event is dropped
 *   instead of inserted.
 * - A `manual` event is removed only if a conflicting origin event
 *   exists; it never yields to (or removes) another `manual` or an
 *   `import` — quite the opposite, it outranks `import` and deletes a
 *   conflicting import row, since a manual entry is still the user's own
 *   explicit action.
 * - An `import` event is removed by *any* conflicting event — origin,
 *   manual, or another import — since it's the least direct evidence
 *   (Trakt relaying a watch that itself originated somewhere else,
 *   possibly the very same origin webhook already recorded). Between two
 *   conflicting imports, the newer contained `watchedAt` wins: `plays.
 *   watchedAt` records when playback *finished*, not started (see
 *   plays_watchedat_semantics memory), and a completion-threshold signal
 *   can only fire at or before the true finish — so the later of two
 *   candidate timestamps is the one closer to reality. A literal retry of
 *   the same Trakt history item is instead caught by `sourceRef`'s own
 *   partial unique index (`plays_user_source_ref_idx`) before it ever
 *   reaches this reasoning — a real natural key, unlike a webhook's lack
 *   of one.
 */
export async function reconcilePlayDuplicates(
  db: Database,
  userId: string,
  entityRef: { movieId: string } | { episodeId: string },
  watchedAt: Date,
  source: PlaySource,
  sourceRef?: string,
): Promise<PlayReconciliation> {
  return db.transaction(async (tx) => {
    await lockEntity(tx, userId, entityRef)
    const conflicts = await findConflictingPlays(tx, userId, entityRef, watchedAt)

    async function insert(): Promise<PlayReconciliation> {
      const [row] = await tx
        .insert(plays)
        .values({ userId, ...entityRef, watchedAt, source, sourceRef })
        .onConflictDoNothing()
        .returning()
      return { inserted: row ?? null, conflicts }
    }

    if (isOrigin(source)) {
      const isRetry = conflicts.some(
        (c) => c.source === source && withinMs(c.watchedAt, watchedAt, SAME_SOURCE_RETRY_WINDOW_MS),
      )
      if (isRetry) return { inserted: null, conflicts }
      await deletePlays(
        tx,
        conflicts.filter((c) => !isOrigin(c.source)).map((c) => c.id),
      )
      return insert()
    }

    if (source === 'manual') {
      if (conflicts.some((c) => isOrigin(c.source))) return { inserted: null, conflicts }
      await deletePlays(
        tx,
        conflicts.filter((c) => c.source === 'import').map((c) => c.id),
      )
      return insert()
    }

    // source === 'import'
    if (conflicts.some((c) => isOrigin(c.source) || c.source === 'manual')) {
      return { inserted: null, conflicts }
    }
    const otherImports = conflicts.filter((c) => c.source === 'import')
    if (otherImports.some((c) => c.watchedAt >= watchedAt)) {
      return { inserted: null, conflicts }
    }
    await deletePlays(
      tx,
      otherImports.map((c) => c.id),
    )
    return insert()
  })
}
