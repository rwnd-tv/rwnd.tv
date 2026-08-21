import { and, eq, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { externalIds, instanceSettings, movies, seasons, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'

/**
 * Keeps cached show/movie metadata (apps/api/src/lib/media.ts's
 * resolveShow/resolveMovie) fresh, for two distinct reasons that happen to
 * share one mechanism:
 *
 *  1. The shows library gallery needs real episode totals to show watched
 *     progress ("154 / 212 episodes"), cached in the `seasons` table rather
 *     than fetched per page view (packages/db/src/schema.ts). The ~480
 *     shows imported before this existed need a one-time backfill.
 *  2. TMDB's terms forbid caching their data longer than 6 months
 *     (docs/adr/0002) — a compliance obligation `metadata_refreshed_at`
 *     was added for at launch but never enforced (see that ADR's note that
 *     "the refresh job itself is not yet built").
 *
 * Both are the same query shape — "which rows are stale?" — so one job
 * covers first-run backfill, ongoing airing-show updates, and the 6-month
 * compliance sweep. Deliberately NOT a silent background rewrite of
 * anything a user is actively looking at: it only ever touches cached
 * provider fields (title/year/overview/poster/status/seasons), never a
 * user's own plays/ratings/watchlist data.
 */

// How often an airing show's episode count is allowed to go stale before
// it's worth another TMDB call. Shows that have finished (status
// Ended/Canceled) skip this clause entirely and only refresh via the
// 6-month compliance sweep below, or the manual "refresh metadata" button.
const AIRING_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// TMDB forbids caching longer than 6 months (docs/adr/0002). Kept a little
// under that so a slow/paused refresher run doesn't tip a row over the
// line before its next pass.
const COMPLIANCE_MAX_AGE_MS = 150 * 24 * 60 * 60 * 1000 // ~5 months

// Statuses TMDB uses for a show that's still airing. Anything else
// ('Ended', 'Canceled', or a status this list doesn't know about yet)
// gets treated as finished and only refreshed by the compliance sweep.
const AIRING_STATUSES = ['Returning Series', 'In Production', 'Planned', 'Pilot']

// Sequential with a short stagger rather than unbounded concurrency — TMDB's
// real ceiling is roughly 50 req/s and 20 connections/IP with no daily cap,
// so this is deliberately conservative for a job nobody is watching rather
// than an attempt to run at the limit.
const REQUEST_STAGGER_MS = 150

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function currentLocale(db: Database): Promise<string> {
  const [row] = await db
    .select({ defaultLocale: instanceSettings.defaultLocale })
    .from(instanceSettings)
    .limit(1)
  return row?.defaultLocale ?? 'en-GB'
}

interface RefreshCandidate {
  id: string
  tmdbExternalId: string | null
}

async function findStaleShows(db: Database): Promise<RefreshCandidate[]> {
  const airingCutoff = new Date(Date.now() - AIRING_REFRESH_INTERVAL_MS)
  const complianceCutoff = new Date(Date.now() - COMPLIANCE_MAX_AGE_MS)

  const rows = await db
    .select({ id: shows.id, tmdbExternalId: externalIds.externalId })
    .from(shows)
    .leftJoin(
      externalIds,
      sql`${externalIds.entityType} = 'show' AND ${externalIds.entityId} = ${shows.id} AND ${externalIds.source} = 'tmdb'`,
    )
    .where(
      or(
        // Never had a season breakdown fetched — covers both the one-time
        // backfill and any show that predates this column existing.
        notExists(db.select().from(seasons).where(eq(seasons.showId, shows.id))),
        // Never had genres fetched. A separate clause from the seasons one
        // above rather than folded into it: `seasons` backfilled first, so
        // by the time `genres` was added most shows already had seasons
        // rows and would otherwise never be reselected for a backfill of
        // just this one new field — caught for real on 2026-08-19, shows
        // sat with genres: [] until their next airing/compliance refresh,
        // which for an Ended show is up to ~5 months away. Whenever a
        // future field is added to what gets cached per show, it needs the
        // same kind of explicit "never populated" clause here, or it has
        // this same silent-gap problem. A genuinely genre-less show in
        // TMDB (rare, but real) matches this forever and gets a harmless
        // extra refetch every sweep — accepted, same tradeoff as a show
        // with no TMDB id below.
        sql`cardinality(${shows.genres}) = 0`,
        // Never had a rating fetched — same "never populated" reasoning
        // and same accepted tradeoff as the genres clause above: a show
        // TMDB genuinely has no votes for matches this forever and gets a
        // harmless extra refetch every sweep.
        isNull(shows.voteAverage),
        // Still airing and due for a check-in. An inclusion list (rather
        // than e.g. `status NOT IN ('Ended','Canceled')`) is deliberate: a
        // NULL status would make a NOT-IN predicate evaluate to NULL (i.e.
        // false) in SQL, silently exempting it from this clause forever.
        // With inArray a NULL status just never matches, which is what we
        // want — it still gets picked up by the compliance clause below.
        and(inArray(shows.status, AIRING_STATUSES), lt(shows.metadataRefreshedAt, airingCutoff)),
        // Everyone else, on the compliance clock regardless of status.
        lt(shows.metadataRefreshedAt, complianceCutoff),
      ),
    )
  return rows
}

async function findStaleMovies(db: Database): Promise<RefreshCandidate[]> {
  const complianceCutoff = new Date(Date.now() - COMPLIANCE_MAX_AGE_MS)
  const rows = await db
    .select({ id: movies.id, tmdbExternalId: externalIds.externalId })
    .from(movies)
    .leftJoin(
      externalIds,
      sql`${externalIds.entityType} = 'movie' AND ${externalIds.entityId} = ${movies.id} AND ${externalIds.source} = 'tmdb'`,
    )
    .where(lt(movies.metadataRefreshedAt, complianceCutoff))
  return rows
}

async function refreshOneShow(
  db: Database,
  provider: MetadataProvider,
  candidate: RefreshCandidate,
  locale: string,
): Promise<boolean> {
  if (!candidate.tmdbExternalId) return false // no known TMDB id — nothing to refetch against
  const fetched = await provider.getShow(candidate.tmdbExternalId, locale)

  await db
    .update(shows)
    .set({
      title: fetched.title,
      year: fetched.year,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
      status: fetched.status,
      genres: fetched.genres,
      voteAverage: fetched.voteAverage,
      metadataRefreshedAt: new Date(),
    })
    .where(eq(shows.id, candidate.id))

  if (fetched.seasons.length > 0) {
    await db
      .insert(seasons)
      .values(
        fetched.seasons.map((season) => ({
          showId: candidate.id,
          seasonNumber: season.seasonNumber,
          name: season.name,
          episodeCount: season.episodeCount,
          airDate: season.airDate,
          posterPath: season.posterPath,
        })),
      )
      .onConflictDoUpdate({
        target: [seasons.showId, seasons.seasonNumber],
        set: {
          name: sql`excluded.name`,
          episodeCount: sql`excluded.episode_count`,
          airDate: sql`excluded.air_date`,
          posterPath: sql`excluded.poster_path`,
        },
      })
  }
  return true
}

async function refreshOneMovie(
  db: Database,
  provider: MetadataProvider,
  candidate: RefreshCandidate,
  locale: string,
): Promise<boolean> {
  if (!candidate.tmdbExternalId) return false
  const fetched = await provider.getMovie(candidate.tmdbExternalId, locale)
  await db
    .update(movies)
    .set({
      title: fetched.title,
      year: fetched.year,
      runtimeMinutes: fetched.runtimeMinutes,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
      metadataRefreshedAt: new Date(),
    })
    .where(eq(movies.id, candidate.id))
  return true
}

/**
 * Runs one full pass: finds every stale show/movie and refetches it from
 * the provider, staggered to stay well clear of rate limits. Safe to call
 * concurrently with a Trakt import — both paths only ever insert/update via
 * `onConflictDoUpdate`/plain `UPDATE ... WHERE id = ...`, never delete.
 * Errors on one item (a since-removed TMDB id, a transient 5xx) are logged
 * and skipped rather than aborting the whole pass — mirrors the import
 * job's per-item failure handling in apps/api/src/import/match.ts.
 */
export async function runMetadataRefresh(
  db: Database,
  provider: MetadataProvider,
): Promise<{ showsRefreshed: number; moviesRefreshed: number }> {
  const locale = await currentLocale(db)
  const [staleShows, staleMovies] = await Promise.all([findStaleShows(db), findStaleMovies(db)])

  let showsRefreshed = 0
  for (const candidate of staleShows) {
    try {
      // Both refresh functions return false (not just "resolve") for a
      // candidate with no known TMDB id — a no-op skip is not the same
      // thing as a successful refresh, and must not be counted as one.
      if (await refreshOneShow(db, provider, candidate, locale)) showsRefreshed += 1
    } catch (err) {
      console.error(`Metadata refresh failed for show ${candidate.id}:`, err)
    }
    await sleep(REQUEST_STAGGER_MS)
  }

  let moviesRefreshed = 0
  for (const candidate of staleMovies) {
    try {
      if (await refreshOneMovie(db, provider, candidate, locale)) moviesRefreshed += 1
    } catch (err) {
      console.error(`Metadata refresh failed for movie ${candidate.id}:`, err)
    }
    await sleep(REQUEST_STAGGER_MS)
  }

  return { showsRefreshed, moviesRefreshed }
}

/**
 * Starts the recurring refresh: one pass immediately (covers the initial
 * backfill and anything that went stale while the process was down), then
 * every 24h after. Deliberately not inside createApp() — see
 * apps/api/src/index.ts's resumeInterruptedImports for why background work
 * lives at the boot entrypoint instead: testApp() calls createApp() in
 * every test, and this must not fire there.
 */
export function scheduleMetadataRefresh(db: Database, provider: MetadataProvider): void {
  const DAY_MS = 24 * 60 * 60 * 1000
  const run = () =>
    runMetadataRefresh(db, provider)
      .then(({ showsRefreshed, moviesRefreshed }) => {
        if (showsRefreshed || moviesRefreshed) {
          console.log(
            `Metadata refresh: ${showsRefreshed} show(s), ${moviesRefreshed} movie(s) updated.`,
          )
        }
      })
      .catch((err: unknown) => console.error('Metadata refresh pass failed:', err))
  void run()
  setInterval(() => void run(), DAY_MS)
}
