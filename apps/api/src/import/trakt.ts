import { eq, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
  droppedShows,
  importJobs,
  plays,
  ratings,
  traktConnections,
  users,
  watchlistItems,
  type importJobStatusEnum,
} from '@rwnd/db'
import type { Env } from '../env.js'
import type { MetadataProvider } from '../providers/types.js'
import { orderedProviders } from '../providers/priority.js'
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { hasCrossSourceDuplicate } from '../lib/plays.js'
import { TraktClient, type PagedResult } from '../trakt/client.js'
import { refreshAccessToken } from '../trakt/auth.js'
import type {
  TraktHiddenItem,
  TraktHistoryItem,
  TraktRatingItem,
  TraktWatchlistItem,
} from '../trakt/types.js'
import {
  matchEpisode,
  matchMovie,
  matchTraktMediaItem,
  type ImportCaches,
  type MatchOutcome,
} from './match.js'

/**
 * Runs (or resumes) one Trakt import job to completion. Exported so tests
 * can `await` it directly instead of racing the fire-and-forget call the
 * route handler makes, and so apps/api/src/index.ts can resume a job that
 * was mid-flight when the process last stopped.
 *
 * Phases run in order history -> ratings -> watchlist -> dropped (history
 * first means the later phases mostly hit shows/episodes this job — or a
 * previous one — already resolved). Progress (counters + a {phase, page}
 * cursor) is
 * persisted after every page, which is both what drives the UI's progress
 * bar and what makes resuming after a restart possible.
 */

const PAGE_LIMIT = 1000
// 'dropped' runs last — a dropped show already has history, so this needs
// no reordering of the matching work the earlier phases already do.
const PHASES = ['history', 'ratings', 'watchlist', 'dropped'] as const
type Phase = (typeof PHASES)[number]
type JobStatus = (typeof importJobStatusEnum.enumValues)[number]
/** Refresh proactively rather than waiting for a request to 401 — Trakt
 * access tokens are valid 7 days, so refreshing inside the last day of
 * that window leaves comfortable margin for a long-running import. */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000

function describeUnexpectedError(err: unknown): string {
  return err instanceof Error ? `Unexpected error: ${err.message}` : 'Unexpected error'
}

interface JobRow {
  id: string
  userId: string
  status: JobStatus
  includeHistory: boolean
  includeRatings: boolean
  includeWatchlist: boolean
  includeDropped: boolean
  cursor: { phase: Phase; page: number } | null
  itemsTotal: number | null
  itemsProcessed: number
  itemsImported: number
  itemsSkipped: number
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

/** Decrypts the stored access token, transparently refreshing it first if
 * it's within REFRESH_MARGIN_MS of expiry. */
async function ensureFreshAccessToken(db: Database, env: Env, userId: string): Promise<string> {
  const [connection] = await db
    .select()
    .from(traktConnections)
    .where(eq(traktConnections.userId, userId))
    .limit(1)
  if (!connection) throw new Error('No Trakt connection for this user')

  const expiresInMs = connection.accessTokenExpiresAt.getTime() - Date.now()
  if (expiresInMs > REFRESH_MARGIN_MS) {
    return decryptSecret(connection.accessTokenEncrypted, env.ENCRYPTION_KEY!)
  }

  const refreshToken = decryptSecret(connection.refreshTokenEncrypted, env.ENCRYPTION_KEY!)
  const token = await refreshAccessToken(
    {
      authBaseUrl: env.TRAKT_AUTH_BASE_URL,
      clientId: env.TRAKT_CLIENT_ID!,
      clientSecret: env.TRAKT_CLIENT_SECRET!,
    },
    refreshToken,
  )
  await db
    .update(traktConnections)
    .set({
      accessTokenEncrypted: encryptSecret(token.access_token, env.ENCRYPTION_KEY!),
      refreshTokenEncrypted: encryptSecret(token.refresh_token, env.ENCRYPTION_KEY!),
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(traktConnections.userId, userId))
  return token.access_token
}

export async function runTraktImport(
  db: Database,
  metadataProviders: MetadataProvider[],
  env: Env,
  jobId: string,
): Promise<void> {
  const job = await loadJob(db, jobId)
  if (!job || job.status === 'cancelled') return
  // Captured as a plain string rather than referencing job.userId from
  // inside the closures below — TS doesn't carry the `job` narrowing above
  // into nested function declarations, so this sidesteps a spurious
  // "possibly undefined" on every use.
  const userId = job.userId

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('Import job references a user that no longer exists')
  const locale = user.locale

  // Resolved once per job, not once per item — a priority change takes
  // effect on the next import, same convention as the metadata refresher's
  // own sweep (apps/api/src/metadata/refresh.ts).
  const providers = await orderedProviders(db, metadataProviders)

  const enabledPhases = PHASES.filter(
    (phase) =>
      (phase === 'history' && job.includeHistory) ||
      (phase === 'ratings' && job.includeRatings) ||
      (phase === 'watchlist' && job.includeWatchlist) ||
      (phase === 'dropped' && job.includeDropped),
  )

  let startIndex = 0
  let startPage = 1
  if (job.cursor) {
    const idx = enabledPhases.indexOf(job.cursor.phase)
    if (idx >= 0) {
      startIndex = idx
      startPage = job.cursor.page
    }
  }

  await db
    .update(importJobs)
    .set(job.cursor ? { status: 'running' } : { status: 'running', startedAt: new Date() })
    .where(eq(importJobs.id, jobId))

  // Per-job caches: a show with many watched/rated/listed episodes should
  // only trigger one provider.getSeason() call per season, and a show
  // that fails to resolve at all should only be tried against every
  // configured provider once — not once per episode. See import/match.ts.
  const caches: ImportCaches = { seasons: new Map(), showFailures: new Map() }

  const state = {
    itemsTotal: job.itemsTotal,
    itemsProcessed: job.itemsProcessed,
    itemsImported: job.itemsImported,
    itemsSkipped: job.itemsSkipped,
    failures: [...job.failures],
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

  async function persistProgress(cursor: { phase: Phase; page: number } | null) {
    await db
      .update(importJobs)
      .set({
        itemsTotal: state.itemsTotal,
        itemsProcessed: state.itemsProcessed,
        itemsImported: state.itemsImported,
        itemsSkipped: state.itemsSkipped,
        failures: state.failures,
        cursor,
      })
      .where(eq(importJobs.id, jobId))
  }

  async function processHistoryItem(item: TraktHistoryItem): Promise<'imported' | 'skipped'> {
    let match: MatchOutcome
    if (item.type === 'movie' && item.movie) {
      match = await matchMovie(db, providers, item.movie, locale)
    } else if (item.type === 'episode' && item.show && item.episode) {
      match = await matchEpisode(db, providers, item.show, item.episode, locale, caches)
    } else {
      match = { ok: false, reason: `Unsupported history item type: ${item.type}` }
    }
    if (!match.ok) {
      pushFailure('history', match)
      return 'skipped'
    }
    const watchedAt = new Date(item.watched_at)
    const entityRef =
      match.entityType === 'movie' ? { movieId: match.entityId } : { episodeId: match.entityId }
    if (await hasCrossSourceDuplicate(db, userId, entityRef, watchedAt, 'import')) {
      return 'skipped'
    }
    const inserted = await db
      .insert(plays)
      .values({
        userId,
        watchedAt,
        source: 'import',
        sourceRef: String(item.id),
        ...entityRef,
      })
      .onConflictDoNothing()
      .returning({ id: plays.id })
    return inserted.length > 0 ? 'imported' : 'skipped'
  }

  async function processRatingItem(item: TraktRatingItem): Promise<'imported' | 'skipped'> {
    const match = await matchTraktMediaItem(db, providers, item, locale, caches)
    if (!match.ok) {
      pushFailure('ratings', match)
      return 'skipped'
    }
    const rating = item.rating
    const ratedAt = new Date(item.rated_at)
    // setWhere makes RETURNING report a row only when the conflict branch
    // actually changes something — without it, re-running an import against
    // unchanged Trakt data reports every rating as freshly "imported" every
    // time (itemsImported becoming meaningless noise rather than a real
    // count of new/changed activity).
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

  async function processWatchlistItem(item: TraktWatchlistItem): Promise<'imported' | 'skipped'> {
    const match = await matchTraktMediaItem(db, providers, item, locale, caches)
    if (!match.ok) {
      pushFailure('watchlist', match)
      return 'skipped'
    }
    const listedAt = new Date(item.listed_at)
    // See processRatingItem's own comment on setWhere — same reasoning.
    const written = await db
      .insert(watchlistItems)
      .values({ userId, entityType: match.entityType, entityId: match.entityId, listedAt })
      .onConflictDoUpdate({
        target: [watchlistItems.userId, watchlistItems.entityType, watchlistItems.entityId],
        set: { listedAt },
        setWhere: ne(watchlistItems.listedAt, listedAt),
      })
      .returning({ id: watchlistItems.id })
    return written.length > 0 ? 'imported' : 'skipped'
  }

  async function processDroppedItem(item: TraktHiddenItem): Promise<'imported' | 'skipped'> {
    // matchTraktMediaItem already handles `type: 'show'` items structurally
    // (it doesn't care that this came from /users/hidden rather than
    // /sync/ratings or /sync/watchlist) — no changes needed in match.ts.
    const match = await matchTraktMediaItem(db, providers, item, locale, caches)
    if (!match.ok) {
      pushFailure('dropped', match)
      return 'skipped'
    }
    const traktDroppedAt = new Date(item.hidden_at)
    // See processRatingItem's own comment on setWhere — same reasoning,
    // adapted to this row's own "would the update actually change
    // anything" condition: only when it isn't already traktDropped with
    // this exact traktDroppedAt, or a manual override is still sitting
    // there needing the conditional clear above to fire.
    const written = await db
      .insert(droppedShows)
      .values({
        userId,
        showId: match.entityId,
        traktDropped: true,
        traktDroppedAt,
        manualDropped: null,
        manualDroppedAt: null,
      })
      .onConflictDoUpdate({
        target: [droppedShows.userId, droppedShows.showId],
        set: {
          traktDropped: true,
          traktDroppedAt,
          // A manual override that's no longer needed — Trakt has caught
          // up to exactly what the user last chose here — is cleared back
          // to null rather than left sticky forever. A manual *undrop*
          // stays protected: it's a real, ongoing disagreement with
          // Trakt's own "still dropped" state, not a stale one. See
          // droppedShows's doc comment in packages/db/src/schema.ts.
          manualDropped: sql`case when ${droppedShows.manualDropped} = true then null else ${droppedShows.manualDropped} end`,
          manualDroppedAt: sql`case when ${droppedShows.manualDropped} = true then null else ${droppedShows.manualDroppedAt} end`,
        },
        // traktDroppedAt is passed as an explicit ISO string + cast, not the
        // raw Date — a Date interpolated directly into a sql`` template
        // doesn't get the same value serialization values()/set() apply,
        // and stringifies via Date.prototype.toString() instead (not a
        // valid timestamptz literal), silently failing this whole query.
        setWhere: sql`NOT (
          ${droppedShows.traktDropped} IS TRUE
          AND ${droppedShows.traktDroppedAt} IS NOT DISTINCT FROM ${traktDroppedAt.toISOString()}::timestamptz
          AND ${droppedShows.manualDropped} IS NOT TRUE
        )`,
      })
      .returning({ id: droppedShows.id })
    return written.length > 0 ? 'imported' : 'skipped'
  }

  /** Runs one phase from `fromPage` to completion. Returns true if the job
   * was cancelled mid-phase (caller should stop entirely). */
  async function runPhase(phase: Phase, fromPage: number): Promise<boolean> {
    let page = fromPage
    for (;;) {
      const accessToken = await ensureFreshAccessToken(db, env, userId)
      const client = new TraktClient({
        apiBaseUrl: env.TRAKT_API_BASE_URL,
        clientId: env.TRAKT_CLIENT_ID!,
        accessToken,
      })

      let result: PagedResult<
        TraktHistoryItem | TraktRatingItem | TraktWatchlistItem | TraktHiddenItem
      >
      if (phase === 'history') result = await client.getHistoryPage(page, PAGE_LIMIT)
      else if (phase === 'ratings') result = await client.getRatingsPage(page, PAGE_LIMIT)
      else if (phase === 'watchlist') result = await client.getWatchlistPage(page, PAGE_LIMIT)
      else result = await client.getHiddenPage('dropped', page, PAGE_LIMIT)

      if (page === 1 && result.itemCount != null) {
        state.itemsTotal = (state.itemsTotal ?? 0) + result.itemCount
      }

      for (const item of result.items) {
        // Match failures (bad/missing TMDB ids, TMDB itself 404ing) are
        // already turned into failure outcomes inside import/match.ts.
        // This catches everything else — a malformed Trakt response, a
        // transient DB error, anything not yet anticipated — so one item
        // can never crash the rest of the page. Without this, a crash here
        // skips the persistProgress() call below entirely: any inserts
        // already made earlier in this same page stay in the database (they
        // don't get rolled back) but never get reflected in the job's own
        // counters, so what actually happened and what the job reports can
        // silently drift apart.
        let outcome: 'imported' | 'skipped'
        try {
          outcome =
            phase === 'history'
              ? await processHistoryItem(item as TraktHistoryItem)
              : phase === 'ratings'
                ? await processRatingItem(item as TraktRatingItem)
                : phase === 'watchlist'
                  ? await processWatchlistItem(item as TraktWatchlistItem)
                  : await processDroppedItem(item as TraktHiddenItem)
        } catch (err) {
          pushFailure(phase, { reason: describeUnexpectedError(err) })
          outcome = 'skipped'
        }
        state.itemsProcessed += 1
        if (outcome === 'imported') state.itemsImported += 1
        else state.itemsSkipped += 1
      }

      const done = page >= result.pageCount
      await persistProgress(done ? null : { phase, page: page + 1 })

      if (await isCancelled(db, jobId)) return true
      if (done) return false
      page += 1
    }
  }

  try {
    for (let i = startIndex; i < enabledPhases.length; i++) {
      const phase = enabledPhases[i]!
      const cancelled = await runPhase(phase, i === startIndex ? startPage : 1)
      if (cancelled) return
    }
    await db
      .update(importJobs)
      .set({ status: 'completed', finishedAt: new Date(), cursor: null })
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
