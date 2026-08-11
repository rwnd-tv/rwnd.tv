import { eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
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
import { decryptSecret, encryptSecret } from '../lib/crypto.js'
import { TraktClient, type PagedResult } from '../trakt/client.js'
import { refreshAccessToken } from '../trakt/auth.js'
import type { TraktHistoryItem, TraktRatingItem, TraktWatchlistItem } from '../trakt/types.js'
import { matchEpisode, matchMovie, matchTraktMediaItem, type MatchOutcome } from './match.js'

/**
 * Runs (or resumes) one Trakt import job to completion. Exported so tests
 * can `await` it directly instead of racing the fire-and-forget call the
 * route handler makes, and so apps/api/src/index.ts can resume a job that
 * was mid-flight when the process last stopped.
 *
 * Phases run in order history -> ratings -> watchlist (history first means
 * the later phases mostly hit shows/episodes this job — or a previous
 * one — already resolved). Progress (counters + a {phase, page} cursor) is
 * persisted after every page, which is both what drives the UI's progress
 * bar and what makes resuming after a restart possible.
 */

const PAGE_LIMIT = 1000
const PHASES = ['history', 'ratings', 'watchlist'] as const
type Phase = (typeof PHASES)[number]
type JobStatus = (typeof importJobStatusEnum.enumValues)[number]
const MAX_FAILURES = 200
/** Refresh proactively rather than waiting for a request to 401 — Trakt
 * access tokens are valid 7 days, so refreshing inside the last day of
 * that window leaves comfortable margin for a long-running import. */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000

interface JobRow {
  id: string
  userId: string
  status: JobStatus
  includeHistory: boolean
  includeRatings: boolean
  includeWatchlist: boolean
  cursor: { phase: Phase; page: number } | null
  itemsTotal: number | null
  itemsProcessed: number
  itemsImported: number
  itemsSkipped: number
  failures: Array<{ phase: string; reason: string; title?: string }>
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
  provider: MetadataProvider,
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

  const enabledPhases = PHASES.filter(
    (phase) =>
      (phase === 'history' && job.includeHistory) ||
      (phase === 'ratings' && job.includeRatings) ||
      (phase === 'watchlist' && job.includeWatchlist),
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

  // Per-job cache: a show with many watched/rated/listed episodes should
  // only trigger one provider.getSeason() call per season, not one per
  // episode — see import/match.ts.
  const seasonCache = new Set<string>()

  const state = {
    itemsTotal: job.itemsTotal,
    itemsProcessed: job.itemsProcessed,
    itemsImported: job.itemsImported,
    itemsSkipped: job.itemsSkipped,
    failures: [...job.failures],
  }

  function pushFailure(phase: Phase, outcome: { reason: string; title?: string }) {
    if (state.failures.length < MAX_FAILURES) {
      state.failures.push({ phase, reason: outcome.reason, title: outcome.title })
    }
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
      match = await matchMovie(db, provider, item.movie, locale)
    } else if (item.type === 'episode' && item.show && item.episode) {
      match = await matchEpisode(db, provider, item.show, item.episode, locale, seasonCache)
    } else {
      match = { ok: false, reason: `Unsupported history item type: ${item.type}` }
    }
    if (!match.ok) {
      pushFailure('history', match)
      return 'skipped'
    }
    const inserted = await db
      .insert(plays)
      .values({
        userId,
        watchedAt: new Date(item.watched_at),
        source: 'import',
        sourceRef: String(item.id),
        ...(match.entityType === 'movie'
          ? { movieId: match.entityId }
          : { episodeId: match.entityId }),
      })
      .onConflictDoNothing()
      .returning({ id: plays.id })
    return inserted.length > 0 ? 'imported' : 'skipped'
  }

  async function processRatingItem(item: TraktRatingItem): Promise<'imported' | 'skipped'> {
    const match = await matchTraktMediaItem(db, provider, item, locale, seasonCache)
    if (!match.ok) {
      pushFailure('ratings', match)
      return 'skipped'
    }
    await db
      .insert(ratings)
      .values({
        userId,
        entityType: match.entityType,
        entityId: match.entityId,
        rating: item.rating,
        ratedAt: new Date(item.rated_at),
      })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.entityType, ratings.entityId],
        set: { rating: item.rating, ratedAt: new Date(item.rated_at) },
      })
    return 'imported'
  }

  async function processWatchlistItem(item: TraktWatchlistItem): Promise<'imported' | 'skipped'> {
    const match = await matchTraktMediaItem(db, provider, item, locale, seasonCache)
    if (!match.ok) {
      pushFailure('watchlist', match)
      return 'skipped'
    }
    await db
      .insert(watchlistItems)
      .values({
        userId,
        entityType: match.entityType,
        entityId: match.entityId,
        listedAt: new Date(item.listed_at),
      })
      .onConflictDoUpdate({
        target: [watchlistItems.userId, watchlistItems.entityType, watchlistItems.entityId],
        set: { listedAt: new Date(item.listed_at) },
      })
    return 'imported'
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

      let result: PagedResult<TraktHistoryItem | TraktRatingItem | TraktWatchlistItem>
      if (phase === 'history') result = await client.getHistoryPage(page, PAGE_LIMIT)
      else if (phase === 'ratings') result = await client.getRatingsPage(page, PAGE_LIMIT)
      else result = await client.getWatchlistPage(page, PAGE_LIMIT)

      if (page === 1 && result.itemCount != null) {
        state.itemsTotal = (state.itemsTotal ?? 0) + result.itemCount
      }

      for (const item of result.items) {
        const outcome =
          phase === 'history'
            ? await processHistoryItem(item as TraktHistoryItem)
            : phase === 'ratings'
              ? await processRatingItem(item as TraktRatingItem)
              : await processWatchlistItem(item as TraktWatchlistItem)
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
