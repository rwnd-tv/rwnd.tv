import { eq, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
  droppedShows,
  importJobs,
  plays,
  ratings,
  users,
  watchlistItems,
  type importJobStatusEnum,
} from '@rwnd/db'
import { UNKNOWN_WATCHED_AT } from '@rwnd/shared'
import type { MetadataProvider } from '../providers/types.js'
import { orderedProviders } from '../providers/priority.js'
import type { ExternalIdBundle } from '../lib/external-match.js'
import {
  createCsvImportCaches,
  matchCsvEpisode,
  matchCsvMovie,
  matchCsvShow,
  type CsvImportCaches,
  type CsvMatchOutcome,
} from './csv-match.js'
import type { ParsedCsvZip } from './csv-zip-parse.js'

/**
 * Runs a CSV import job to completion — the round-trip counterpart of
 * apps/api/src/import/trakt.ts's runImportJob, over rwnd.tv's own exported
 * CSV rows (apps/api/src/export/build.ts) instead of Trakt API pages. See
 * csv-match.ts's doc comment for why this is a separate implementation
 * rather than a new `PageFetcher` over the Trakt engine.
 *
 * Unlike the Trakt engine there's no cursor/resume support within a job —
 * same "the parsed file only ever lived in this request's memory" reasoning
 * as runTraktZipImport, and the same handling in apps/api/src/index.ts's
 * resumeInterruptedImports (a `csv` job caught `running` by a restart is
 * marked failed, asking for a re-upload, rather than resumed from nothing).
 */

const PHASES = ['history', 'ratings', 'watchlist', 'dropped'] as const
type Phase = (typeof PHASES)[number]
type JobStatus = (typeof importJobStatusEnum.enumValues)[number]
/** Progress is persisted after every this-many rows within a phase (and
 * always at the end of a phase) — CSV rows are already fully in memory, so
 * there's no natural "page" boundary the way the Trakt engine has; this
 * just keeps DB writes from dominating a large import while still giving
 * the UI's progress bar/cancel button reasonably frequent updates. */
const PROGRESS_BATCH_SIZE = 200

interface JobRow {
  id: string
  userId: string
  status: JobStatus
  includeHistory: boolean
  includeRatings: boolean
  includeWatchlist: boolean
  includeDropped: boolean
  failures: Array<{
    phase: string
    reason: string
    title?: string
    show?: string
    season?: number
    episode?: number
  }>
}

async function loadJob(db: Database, jobId: string): Promise<JobRow | undefined> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1)
  return job
}

async function isCancelled(db: Database, jobId: string): Promise<boolean> {
  const job = await loadJob(db, jobId)
  return job?.status === 'cancelled'
}

function rowIds(row: Record<string, string>): ExternalIdBundle {
  return { tmdb: field(row, 'tmdb_id') || undefined, tvdb: field(row, 'tvdb_id') || undefined }
}

/** `'unknown'` is build.ts's own text for the UNKNOWN_WATCHED_AT sentinel
 * (see export/build.ts's formatWatchedAt) — mapped back here rather than
 * `new Date('unknown')`, which would just be an Invalid Date. */
function parseWatchedAt(value: string): Date {
  return value === 'unknown' ? new Date(UNKNOWN_WATCHED_AT) : new Date(value)
}

function parseIntField(value: string): number | null {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) ? n : null
}

/** `Record<string, string>` index access types as `string | undefined`
 * under this project's `noUncheckedIndexedAccess` — every row here always
 * has every header's key populated (rowsToObjects fills missing trailing
 * cells with `''`, never omits a key), so this is a plain type-narrowing
 * helper, not a real defensive fallback. */
function field(row: Record<string, string>, key: string): string {
  return row[key] ?? ''
}

export async function runCsvImport(
  db: Database,
  metadataProviders: MetadataProvider[],
  jobId: string,
  data: ParsedCsvZip,
): Promise<void> {
  const job = await loadJob(db, jobId)
  if (!job || job.status === 'cancelled') return
  const userId = job.userId

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('Import job references a user that no longer exists')
  const locale = user.locale

  const providers = await orderedProviders(db, metadataProviders)
  const caches: CsvImportCaches = createCsvImportCaches()

  const enabledPhases = PHASES.filter(
    (phase) =>
      (phase === 'history' && job.includeHistory) ||
      (phase === 'ratings' && job.includeRatings) ||
      (phase === 'watchlist' && job.includeWatchlist) ||
      (phase === 'dropped' && job.includeDropped),
  )

  // Every existing play this user has, for every entity/exact watchedAt —
  // loaded once, not per row. The synthetic sourceRef below only guards a
  // history row against *itself* on a second run of the same CSV; it does
  // nothing against the plays this CSV was originally exported from in the
  // first place (manual/plex/an earlier real import), which have their own,
  // different sourceRefs (or none) and so never collide with the unique
  // index on their own. Confirmed live: without this, re-importing an
  // export back into the same account duplicated every history row (found
  // testing this feature — 5,200 of 5,200 processed rows reported
  // "imported" before the run was stopped). Keyed on entityId (movie or
  // episode id, whichever applies) + exact watchedAt.getTime(), which is
  // enough to catch "this exact watch already exists" regardless of which
  // source originally logged it. One known, accepted gap: several distinct
  // real rewatches that all share the UNKNOWN_WATCHED_AT sentinel (a
  // documented Trakt-import quirk — see plays.ts's own comment on why that
  // can legitimately happen) collapse to just one on a CSV round-trip,
  // since they're indistinguishable by this key alone.
  const existingPlayKeys = new Set<string>()
  if (job.includeHistory) {
    const existingPlays = await db
      .select({ movieId: plays.movieId, episodeId: plays.episodeId, watchedAt: plays.watchedAt })
      .from(plays)
      .where(eq(plays.userId, userId))
    for (const row of existingPlays) {
      existingPlayKeys.add(`${row.movieId ?? row.episodeId}:${row.watchedAt.getTime()}`)
    }
  }

  // Every show this user already has an effective "dropped" verdict for
  // (manualDropped ?? traktDropped ?? false — same read as everywhere else,
  // see droppedShows's doc comment in packages/db/src/schema.ts), keyed by
  // showId. A CSV export only ever contains shows that were *already*
  // effectively dropped at export time, so on a round-trip re-import every
  // one of them is already correctly reflected here — most commonly via
  // traktDropped alone, with manualDropped left null ("no override, defer
  // to Trakt"). Writing manualDropped: true anyway would convert that
  // deferral into a hardcoded override — a real, meaningful state change
  // (and one that reads as a whole-record replace in the JSON Backup diff,
  // e.g. a "19 added, 19 removed" Dropped TV shows line for zero actual
  // drop/undrop activity) even though the *effective* dropped-ness never
  // moved. Confirmed live: re-importing an export back into the same
  // account reported 19 "imported" dropped-show rows this way. So: skip
  // entirely (no write at all) whenever the show is already effectively
  // dropped, regardless of which field currently carries that verdict —
  // only a show that ISN'T already reflected as dropped locally (a fresh
  // instance, or one where Trakt hasn't synced this show's drop yet) should
  // actually gain a manual override from this importer.
  const effectivelyDroppedShowIds = new Set<string>()
  if (job.includeDropped) {
    const existingDropped = await db
      .select({
        showId: droppedShows.showId,
        traktDropped: droppedShows.traktDropped,
        manualDropped: droppedShows.manualDropped,
      })
      .from(droppedShows)
      .where(eq(droppedShows.userId, userId))
    for (const row of existingDropped) {
      if (row.manualDropped ?? row.traktDropped ?? false) {
        effectivelyDroppedShowIds.add(row.showId)
      }
    }
  }

  await db
    .update(importJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(importJobs.id, jobId))

  const state = {
    itemsTotal: enabledPhases.reduce((sum, phase) => sum + data[phase].length, 0),
    itemsProcessed: 0,
    itemsImported: 0,
    itemsSkipped: 0,
    failures: [] as JobRow['failures'],
  }

  function pushFailure(
    phase: Phase,
    outcome: { reason: string; title?: string; show?: string; season?: number; episode?: number },
  ) {
    state.failures.push({
      phase,
      reason: outcome.reason,
      title: outcome.title,
      show: outcome.show,
      season: outcome.season,
      episode: outcome.episode,
    })
  }

  async function persistProgress() {
    await db
      .update(importJobs)
      .set({
        itemsTotal: state.itemsTotal,
        itemsProcessed: state.itemsProcessed,
        itemsImported: state.itemsImported,
        itemsSkipped: state.itemsSkipped,
        failures: state.failures,
      })
      .where(eq(importJobs.id, jobId))
  }

  /** Shared by history/ratings/watchlist rows — they all carry the same
   * type/tmdb_id/tvdb_id/show_title/season_number/episode_number columns,
   * only what happens after a successful match differs. */
  async function matchRow(
    phase: Phase,
    row: Record<string, string>,
  ): Promise<CsvMatchOutcome | null> {
    const ids = rowIds(row)
    if (field(row, 'type') === 'movie')
      return matchCsvMovie(db, providers, ids, field(row, 'title'), locale)
    if (field(row, 'type') === 'show' && phase !== 'history') {
      return matchCsvShow(db, providers, ids, field(row, 'title'), locale, caches)
    }
    if (field(row, 'type') === 'episode') {
      const season = parseIntField(field(row, 'season_number'))
      const episode = parseIntField(field(row, 'episode_number'))
      if (season === null || episode === null) {
        return {
          ok: false,
          reason: 'Invalid season_number/episode_number',
          title: field(row, 'title'),
        }
      }
      return matchCsvEpisode(
        db,
        providers,
        ids,
        season,
        episode,
        field(row, 'show_title'),
        locale,
        caches,
      )
    }
    return {
      ok: false,
      reason: `Unsupported ${phase} row type: ${field(row, 'type')}`,
      title: field(row, 'title'),
    }
  }

  async function processHistoryRow(row: Record<string, string>): Promise<'imported' | 'skipped'> {
    const match = await matchRow('history', row)
    if (!match || !match.ok) {
      pushFailure('history', match ?? { reason: 'Unmatched row' })
      return 'skipped'
    }

    const watchedAt = parseWatchedAt(field(row, 'watched_at'))
    if (Number.isNaN(watchedAt.getTime())) {
      pushFailure('history', { reason: 'Invalid watched_at', title: match.title })
      return 'skipped'
    }
    const entityRef =
      match.entityType === 'movie' ? { movieId: match.entityId } : { episodeId: match.entityId }

    // Primary dedup: does *any* play already exist for this entity at this
    // exact watchedAt, regardless of which source originally logged it —
    // see existingPlayKeys' own doc comment above for why this (not just
    // the sourceRef below) is required.
    const dedupeKey = `${match.entityId}:${watchedAt.getTime()}`
    if (existingPlayKeys.has(dedupeKey)) return 'skipped'

    // Secondary/backstop dedup: a synthetic, deterministic sourceRef so two
    // rows *within this same CSV* that resolve to the same entity+watchedAt
    // (or a second run of this same file, mid-job) can't double-insert
    // against each other via the existing plays_user_source_ref_idx partial
    // unique index — existingPlayKeys alone wouldn't catch that until this
    // row's own insert lands.
    const sourceRef = `csv:${match.entityType}:${match.entityId}:${watchedAt.toISOString()}`
    const inserted = await db
      .insert(plays)
      .values({ userId, watchedAt, source: 'import', sourceRef, ...entityRef })
      .onConflictDoNothing()
      .returning({ id: plays.id })
    if (inserted.length === 0) return 'skipped'
    existingPlayKeys.add(dedupeKey)
    return 'imported'
  }

  async function processRatingRow(row: Record<string, string>): Promise<'imported' | 'skipped'> {
    const match = await matchRow('ratings', row)
    if (!match || !match.ok) {
      pushFailure('ratings', match ?? { reason: 'Unmatched row' })
      return 'skipped'
    }

    const rating = parseIntField(field(row, 'rating'))
    const ratedAt = new Date(field(row, 'rated_at'))
    if (rating === null || rating < 1 || rating > 10 || Number.isNaN(ratedAt.getTime())) {
      pushFailure('ratings', { reason: 'Invalid rating or rated_at', title: match.title })
      return 'skipped'
    }
    // setWhere makes RETURNING report a row only when the conflict branch
    // actually changes something — same reasoning as trakt.ts's own rating
    // upsert, so a no-op re-import doesn't report every rating as freshly
    // "imported".
    const written = await db
      .insert(ratings)
      .values({ userId, entityType: match.entityType, entityId: match.entityId, rating, ratedAt })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.entityType, ratings.entityId],
        set: { rating, ratedAt },
        setWhere: or(ne(ratings.rating, rating), ne(ratings.ratedAt, ratedAt)),
      })
      .returning({ id: ratings.id })
    return written.length > 0 ? 'imported' : 'skipped'
  }

  async function processWatchlistRow(row: Record<string, string>): Promise<'imported' | 'skipped'> {
    const match = await matchRow('watchlist', row)
    if (!match || !match.ok) {
      pushFailure('watchlist', match ?? { reason: 'Unmatched row' })
      return 'skipped'
    }

    const listedAt = new Date(field(row, 'listed_at'))
    if (Number.isNaN(listedAt.getTime())) {
      pushFailure('watchlist', { reason: 'Invalid listed_at', title: match.title })
      return 'skipped'
    }
    const notes = field(row, 'notes') || null
    // Unlike trakt.ts's own watchlist upsert (which never writes notes at
    // all), this one does — the CSV export carries real note data, so a
    // round-trip import should preserve it. `notes` is nullable, so the
    // change-detection uses IS DISTINCT FROM rather than drizzle's `ne()`
    // (which has ordinary SQL NULL semantics — `NULL != 'x'` is NULL, not
    // true, so a plain `ne` would silently never fire the update the first
    // time a null note becomes a real one).
    const written = await db
      .insert(watchlistItems)
      .values({ userId, entityType: match.entityType, entityId: match.entityId, listedAt, notes })
      .onConflictDoUpdate({
        target: [watchlistItems.userId, watchlistItems.entityType, watchlistItems.entityId],
        set: { listedAt, notes },
        setWhere: sql`${watchlistItems.listedAt} IS DISTINCT FROM ${listedAt.toISOString()}::timestamptz OR ${watchlistItems.notes} IS DISTINCT FROM ${notes}`,
      })
      .returning({ id: watchlistItems.id })
    return written.length > 0 ? 'imported' : 'skipped'
  }

  async function processDroppedRow(row: Record<string, string>): Promise<'imported' | 'skipped'> {
    const match = await matchCsvShow(
      db,
      providers,
      rowIds(row),
      field(row, 'show_title'),
      locale,
      caches,
    )
    if (!match.ok) {
      pushFailure('dropped', match)
      return 'skipped'
    }

    // Already effectively dropped locally (via Trakt, a prior manual
    // choice, or an earlier row in this same CSV) — nothing to do. See
    // effectivelyDroppedShowIds' own doc comment above for why this check,
    // not just the setWhere below, is required.
    if (effectivelyDroppedShowIds.has(match.entityId)) return 'skipped'

    const droppedAt = field(row, 'dropped_at') ? new Date(field(row, 'dropped_at')) : new Date()
    if (Number.isNaN(droppedAt.getTime())) {
      pushFailure('dropped', { reason: 'Invalid dropped_at', title: match.title })
      return 'skipped'
    }
    // manualDropped, not traktDropped — unlike trakt.ts's own dropped
    // upsert (processDroppedItem), this data didn't come from a live Trakt
    // sync. Marking it as the user's own manual choice is the semantically
    // correct read, and avoids it being silently auto-cleared the way
    // writing traktDropped could be by a future Trakt import that
    // disagrees (see droppedShows's doc comment in packages/db/src/schema.ts).
    const written = await db
      .insert(droppedShows)
      .values({ userId, showId: match.entityId, manualDropped: true, manualDroppedAt: droppedAt })
      .onConflictDoUpdate({
        target: [droppedShows.userId, droppedShows.showId],
        set: { manualDropped: true, manualDroppedAt: droppedAt },
        setWhere: sql`NOT (
          ${droppedShows.manualDropped} IS TRUE
          AND ${droppedShows.manualDroppedAt} IS NOT DISTINCT FROM ${droppedAt.toISOString()}::timestamptz
        )`,
      })
      .returning({ id: droppedShows.id })
    if (written.length === 0) return 'skipped'
    effectivelyDroppedShowIds.add(match.entityId)
    return 'imported'
  }

  function describeUnexpectedError(err: unknown): string {
    return err instanceof Error ? `Unexpected error: ${err.message}` : 'Unexpected error'
  }

  try {
    for (const phase of enabledPhases) {
      const rows = data[phase]
      for (const row of rows) {
        let outcome: 'imported' | 'skipped'
        try {
          outcome =
            phase === 'history'
              ? await processHistoryRow(row)
              : phase === 'ratings'
                ? await processRatingRow(row)
                : phase === 'watchlist'
                  ? await processWatchlistRow(row)
                  : await processDroppedRow(row)
        } catch (err) {
          pushFailure(phase, { reason: describeUnexpectedError(err) })
          outcome = 'skipped'
        }
        state.itemsProcessed += 1
        if (outcome === 'imported') state.itemsImported += 1
        else state.itemsSkipped += 1

        if (state.itemsProcessed % PROGRESS_BATCH_SIZE === 0) {
          await persistProgress()
          if (await isCancelled(db, jobId)) return
        }
      }
      await persistProgress()
      if (await isCancelled(db, jobId)) return
    }
    await db
      .update(importJobs)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(importJobs.id, jobId))
  } catch (err) {
    await db
      .update(importJobs)
      .set({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      })
      .where(eq(importJobs.id, jobId))
  }
}
