import { and, eq, exists, gt, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { externalIds, instanceSettings, movies, seasons, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { orderedProviders } from '../providers/priority.js'

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
  return row?.defaultLocale ?? 'en-US'
}

export interface RefreshCandidate {
  id: string
}

/** Which provider actually has an id for `entityId`, walking `ordered`
 * (apps/api/src/providers/priority.ts) and stopping at the first hit — the
 * same "highest-priority provider with something to work with" choice
 * `pickRefreshTargets` below makes in bulk for the background sweep. Used
 * directly by the manual "refresh metadata" routes
 * (apps/api/src/routes/library.ts), which only ever need one entity at a
 * time. */
export async function pickRefreshTarget(
  db: Database,
  entityType: 'movie' | 'show',
  entityId: string,
  ordered: MetadataProvider[],
): Promise<{ provider: MetadataProvider; externalId: string } | null> {
  const rows = await db
    .select({ source: externalIds.source, externalId: externalIds.externalId })
    .from(externalIds)
    .where(and(eq(externalIds.entityType, entityType), eq(externalIds.entityId, entityId)))
  const idsBySource = new Map(rows.map((row) => [row.source, row.externalId]))
  for (const provider of ordered) {
    const externalId = idsBySource.get(provider.source)
    if (externalId) return { provider, externalId }
  }
  return null
}

/** Bulk counterpart of pickRefreshTarget, for the background sweep below —
 * one query for every stale entity's external ids rather than one per
 * entity, since a sweep can cover hundreds of rows. */
async function pickRefreshTargets(
  db: Database,
  entityType: 'movie' | 'show',
  entityIds: string[],
  ordered: MetadataProvider[],
): Promise<Map<string, { provider: MetadataProvider; externalId: string }>> {
  const result = new Map<string, { provider: MetadataProvider; externalId: string }>()
  if (entityIds.length === 0) return result

  const rows = await db
    .select({
      entityId: externalIds.entityId,
      source: externalIds.source,
      externalId: externalIds.externalId,
    })
    .from(externalIds)
    .where(and(eq(externalIds.entityType, entityType), inArray(externalIds.entityId, entityIds)))

  const idsByEntity = new Map<string, Map<string, string>>()
  for (const row of rows) {
    let idsBySource = idsByEntity.get(row.entityId)
    if (!idsBySource) {
      idsBySource = new Map()
      idsByEntity.set(row.entityId, idsBySource)
    }
    idsBySource.set(row.source, row.externalId)
  }

  for (const entityId of entityIds) {
    const idsBySource = idsByEntity.get(entityId)
    if (!idsBySource) continue
    for (const provider of ordered) {
      const externalId = idsBySource.get(provider.source)
      if (externalId) {
        result.set(entityId, { provider, externalId })
        break
      }
    }
  }
  return result
}

async function findStaleShows(db: Database): Promise<RefreshCandidate[]> {
  const airingCutoff = new Date(Date.now() - AIRING_REFRESH_INTERVAL_MS)
  const complianceCutoff = new Date(Date.now() - COMPLIANCE_MAX_AGE_MS)

  const rows = await db
    .select({ id: shows.id })
    .from(shows)
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
        // Never had an aired-episode count computed for at least one
        // regular season — same "never populated" backfill reasoning as
        // the genres/voteAverage clauses above. Needed as its own clause
        // because resolveShow (apps/api/src/lib/media.ts) already creates
        // `seasons` rows at show-creation time, so the no-seasons-yet
        // clause above wouldn't catch a show that predates this column.
        exists(
          db
            .select({ one: sql`1` })
            .from(seasons)
            .where(
              and(
                eq(seasons.showId, shows.id),
                gt(seasons.seasonNumber, 0),
                isNull(seasons.airedEpisodeCount),
              ),
            ),
        ),
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
    .select({ id: movies.id })
    .from(movies)
    .where(
      or(
        // Never had genres fetched — same "never populated" reasoning as
        // findStaleShows' own genres clause above, and the same accepted
        // tradeoff: a genuinely genre-less movie matches forever and gets a
        // harmless extra refetch each sweep. Without this, every movie that
        // predates the genres column would wait out the compliance clock
        // below (~5 months) before the detail page has anything to show —
        // exactly the gap the shows version was caught having on
        // 2026-08-19.
        sql`cardinality(${movies.genres}) = 0`,
        // Never had a rating fetched — same reasoning/tradeoff.
        isNull(movies.voteAverage),
        // Everyone else, on the compliance clock. No `slug` clause is
        // needed here — unlike genres/voteAverage, a movie's slug is
        // backfilled once by migration 0009 and never refetched (see
        // refreshOneMovie below), so there's nothing for a sweep to catch.
        // No airing-status clause either — movies have no `status` and
        // never gain new episodes.
        lt(movies.metadataRefreshedAt, complianceCutoff),
      ),
    )
  return rows
}

/**
 * Exported for the manual "refresh metadata" button
 * (apps/api/src/routes/library.ts's POST /library/shows/{slug}/refresh) —
 * same fetch-and-upsert logic the background sweep above uses per show, so
 * a user fixing a show TMDB itself has wrong doesn't get different/lesser
 * results than waiting for the next automatic pass. Callers have already
 * resolved which provider and which of its ids to use (pickRefreshTarget
 * above) — there's nothing left for this function to skip on.
 */
export async function refreshOneShow(
  db: Database,
  provider: MetadataProvider,
  candidate: { id: string; externalId: string },
  locale: string,
): Promise<void> {
  const fetched = await provider.getShow(candidate.externalId, locale)

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
    const regularSeasons = fetched.seasons.filter((s) => s.seasonNumber > 0)
    const latestSeasonNumber =
      regularSeasons.length > 0 ? Math.max(...regularSeasons.map((s) => s.seasonNumber)) : null
    const isAiring = fetched.status !== null && AIRING_STATUSES.includes(fetched.status)

    // A past season, or any season once the show itself has finished, has
    // necessarily aired in full — only the current season of a still-
    // airing show might have unaired episodes left, so that's the one case
    // worth an extra per-episode fetch for (see showDetailSchema's
    // `airedEpisodes` doc comment for why this number exists at all).
    let latestSeasonAiredCount: number | null = null
    if (isAiring && latestSeasonNumber !== null) {
      const { episodes: latestEpisodes } = await provider.getSeason(
        candidate.externalId,
        latestSeasonNumber,
        locale,
      )
      const now = new Date()
      latestSeasonAiredCount = latestEpisodes.filter(
        (e) => e.firstAired !== null && new Date(e.firstAired) <= now,
      ).length
      await sleep(REQUEST_STAGGER_MS)
    }

    await db
      .insert(seasons)
      .values(
        fetched.seasons.map((season) => ({
          showId: candidate.id,
          seasonNumber: season.seasonNumber,
          name: season.name,
          episodeCount: season.episodeCount,
          airedEpisodeCount:
            season.seasonNumber === 0
              ? null
              : isAiring && season.seasonNumber === latestSeasonNumber
                ? latestSeasonAiredCount
                : season.episodeCount,
          airDate: season.airDate,
          posterPath: season.posterPath,
        })),
      )
      .onConflictDoUpdate({
        target: [seasons.showId, seasons.seasonNumber],
        set: {
          name: sql`excluded.name`,
          episodeCount: sql`excluded.episode_count`,
          airedEpisodeCount: sql`excluded.aired_episode_count`,
          airDate: sql`excluded.air_date`,
          posterPath: sql`excluded.poster_path`,
        },
      })
  }
}

/**
 * Exported for the manual "refresh metadata" button
 * (apps/api/src/routes/library.ts's POST /library/movies/{slug}/refresh) —
 * same fetch-and-upsert logic the background sweep above uses per movie, so
 * a user fixing a movie TMDB itself has wrong doesn't get different/lesser
 * results than waiting for the next automatic pass. Deliberately does NOT
 * set `slug` — a title change must not change the movie's URL, same as
 * refreshOneShow above never touches `shows.slug`. Same "caller already
 * resolved the provider/id" reasoning as refreshOneShow.
 */
export async function refreshOneMovie(
  db: Database,
  provider: MetadataProvider,
  candidate: { id: string; externalId: string },
  locale: string,
): Promise<void> {
  const fetched = await provider.getMovie(candidate.externalId, locale)
  await db
    .update(movies)
    .set({
      title: fetched.title,
      year: fetched.year,
      runtimeMinutes: fetched.runtimeMinutes,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
      genres: fetched.genres,
      voteAverage: fetched.voteAverage,
      metadataRefreshedAt: new Date(),
    })
    .where(eq(movies.id, candidate.id))
}

/**
 * Runs one full pass: finds every stale show/movie and refetches it from
 * whichever configured provider has an id for it, in admin-configured
 * priority order (apps/api/src/providers/priority.ts) — re-read here, not
 * once at boot, so a priority change takes effect on the very next sweep
 * with no restart needed. Staggered to stay well clear of rate limits. Safe
 * to call concurrently with a Trakt import — both paths only ever
 * insert/update via `onConflictDoUpdate`/plain `UPDATE ... WHERE id = ...`,
 * never delete. Errors on one item (a since-removed provider id, a
 * transient 5xx) are logged and skipped rather than aborting the whole
 * pass — mirrors the import job's per-item failure handling in
 * apps/api/src/import/match.ts.
 */
export async function runMetadataRefresh(
  db: Database,
  providers: MetadataProvider[],
): Promise<{ showsRefreshed: number; moviesRefreshed: number }> {
  const [locale, ordered, staleShows, staleMovies] = await Promise.all([
    currentLocale(db),
    orderedProviders(db, providers),
    findStaleShows(db),
    findStaleMovies(db),
  ])

  const showTargets = await pickRefreshTargets(
    db,
    'show',
    staleShows.map((s) => s.id),
    ordered,
  )
  let showsRefreshed = 0
  for (const candidate of staleShows) {
    // No configured provider has any id for this show at all — a no-op
    // skip, not a failed refresh, so it's neither counted nor logged as an
    // error (there's nothing an admin could act on here).
    const target = showTargets.get(candidate.id)
    if (!target) continue
    try {
      await refreshOneShow(
        db,
        target.provider,
        { id: candidate.id, externalId: target.externalId },
        locale,
      )
      showsRefreshed += 1
    } catch (err) {
      console.error(`Metadata refresh failed for show ${candidate.id}:`, err)
    }
    await sleep(REQUEST_STAGGER_MS)
  }

  const movieTargets = await pickRefreshTargets(
    db,
    'movie',
    staleMovies.map((m) => m.id),
    ordered,
  )
  let moviesRefreshed = 0
  for (const candidate of staleMovies) {
    const target = movieTargets.get(candidate.id)
    if (!target) continue
    try {
      await refreshOneMovie(
        db,
        target.provider,
        { id: candidate.id, externalId: target.externalId },
        locale,
      )
      moviesRefreshed += 1
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
export function scheduleMetadataRefresh(db: Database, providers: MetadataProvider[]): void {
  const DAY_MS = 24 * 60 * 60 * 1000
  const run = () =>
    runMetadataRefresh(db, providers)
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
