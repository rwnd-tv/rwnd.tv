import { and, eq, exists, gt, gte, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, instanceSettings, movies, seasons, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { orderedProviders } from '../providers/priority.js'
import { resolveSeason, upsertExternalId } from '../lib/media.js'
import { resolveEpisodeImdbId } from '../lib/episode-imdb.js'

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

// One-off drain of episodes that predate IMDb ids being fetched at all
// (~4,700 on the reference instance at time of writing). Capped per pass
// and self-terminating: every episode touched gets `imdbCheckedAt` set
// regardless of outcome (apps/api/src/lib/episode-imdb.ts), so the
// candidate set strictly shrinks pass over pass. Deliberately NOT a
// findStale*-style recurring clause — see those functions' own comments.
// At 250/pass and the existing REQUEST_STAGGER_MS, ~4,700 episodes drains
// in about 19 daily passes (~3 weeks).
const EPISODE_IMDB_BACKFILL_PER_PASS = 250

// One-off drain of seasons with at least one episode missing its overview
// (added after episodes.overview itself — see that column's doc comment,
// packages/db/src/schema.ts). Capped per pass like the IMDb backfill above,
// but keyed on season, not episode: `resolveSeason` fetches and writes a
// whole season's overviews in one provider call, so this is naturally far
// cheaper than a per-episode drain would be.
const EPISODE_OVERVIEW_BACKFILL_SEASONS_PER_PASS = 100

// One-off drain of seasons with at least one episode still missing a
// runtime after its primary provider's own chance to supply one (see
// fillSeasonRuntimesFromFallback's doc comment below). Capped and keyed on
// season like the overview backfill above, for the same reason.
const EPISODE_RUNTIME_BACKFILL_SEASONS_PER_PASS = 50

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

interface RefreshCandidate {
  id: string
}

/** Which provider actually has an id for `entityId`, walking `ordered`
 * (apps/api/src/providers/priority.ts) and stopping at the first hit — the
 * same "highest-priority provider with something to work with" choice
 * `pickRefreshTargets` below makes in bulk for the background sweep. Used
 * directly by the manual "refresh metadata" routes
 * (apps/api/src/routes/library/{shows,movies}.ts), which only ever need one
 * entity at a time. */
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

/** Bulk counterpart of pickRefreshTarget — one query for every entity's
 * external ids rather than one per entity. Originally just for the
 * background sweep below (which can cover hundreds of rows); also used by
 * the Dashboard's On Deck/Up Next candidate lookup
 * (apps/api/src/routes/library/queue.ts), which has the same "N shows, one
 * query" shape. */
export async function pickRefreshTargets(
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

/** A show's own stored `imdb` id, or null — same single-row read
 * `getExternalId` (apps/api/src/routes/library/shared.ts) does, reimplemented
 * locally rather than imported: that helper lives in `routes/`, and
 * apps/api/src/lib/episode-imdb.ts already establishes the convention of not
 * reaching into `routes/` from a non-route module. */
async function showImdbId(db: Database, showId: string): Promise<string | null> {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, 'show'),
        eq(externalIds.entityId, showId),
        eq(externalIds.source, 'imdb'),
      ),
    )
    .limit(1)
  return row?.externalId ?? null
}

/** Used by the runtime backfill below when `pickRefreshTarget` finds no
 * provider with its own id for this show — tries a reverse lookup by the
 * show's stored `imdb` id instead, the one id namespace every configured
 * provider's `findByExternalId` can search by (apps/api/src/providers/
 * types.ts only accepts 'imdb' | 'tvdb' as a source, and a show missing its
 * `tvdb` id has nothing to reverse-lookup *from* on that side either).
 *
 * A hit is persisted immediately (`upsertExternalId` with `correct: false`,
 * same non-throwing on-conflict-do-nothing semantics every other
 * opportunistic id write in this file uses) so the *next* pass finds it
 * through `pickRefreshTarget` directly, with no further provider call —
 * this makes the fix's total cost one-time per show, not recurring.
 *
 * apps/api/src/lib/external-match.ts's `findViaAlternateIds` already does
 * almost exactly this, but that file imports `pickRefreshTarget` *from*
 * this one — importing the reverse direction here would create a circular
 * module dependency, so this is a narrow, local reimplementation of just
 * the imdb branch rather than a shared import. */
async function reverseLookupFallbackTarget(
  db: Database,
  showId: string,
  remaining: MetadataProvider[],
  locale: string,
): Promise<{ provider: MetadataProvider; externalId: string } | null> {
  const imdbId = await showImdbId(db, showId)
  if (!imdbId) return null
  for (const provider of remaining) {
    try {
      const found = await provider.findByExternalId('show', 'imdb', imdbId, locale)
      if (found) {
        await upsertExternalId(db, 'show', showId, provider.source, found, { correct: false })
        return { provider, externalId: found }
      }
    } catch (err) {
      console.error(`Reverse lookup failed for show ${showId} against ${provider.source}:`, err)
    }
  }
  return null
}

async function findStaleShows(db: Database): Promise<RefreshCandidate[]> {
  const airingCutoff = new Date(Date.now() - AIRING_REFRESH_INTERVAL_MS)
  const complianceCutoff = new Date(Date.now() - COMPLIANCE_MAX_AGE_MS)
  const today = new Date().toISOString().slice(0, 10)

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
        // Has an announced season that hasn't aired yet (no air date at all
        // yet, or one in the future — the same "upcoming" definition
        // refreshOneShow uses below), on the same 7-day cadence as an
        // airing show — regardless of `shows.status`. Without this, a show
        // TMDB still calls 'Ended'/'Canceled' at the time its renewal was
        // announced only gets re-checked on the ~5-month compliance clock
        // below, so a real airing season can sit unresolved (no `episodes`
        // rows, silently missing from the TV Shows calendar feed —
        // docs/TODO_ARCHIVE.md) for months after it started airing. Keyed
        // on the already-cached `seasons.airDate`, so evaluating this costs
        // no extra provider calls; only actually refreshing a match does.
        and(
          lt(shows.metadataRefreshedAt, airingCutoff),
          exists(
            db
              .select({ one: sql`1` })
              .from(seasons)
              .where(
                and(
                  eq(seasons.showId, shows.id),
                  gt(seasons.seasonNumber, 0),
                  or(isNull(seasons.airDate), gte(seasons.airDate, today)),
                ),
              ),
          ),
        ),
        // Everyone else, on the compliance clock regardless of status.
        lt(shows.metadataRefreshedAt, complianceCutoff),
      ),
    )
  return rows
}

// Deliberately NO "never populated imdb id" clause here, despite the
// genres/voteAverage clauses above suggesting every future cached field
// needs one. At the time this was added, 483/494 shows on the reference
// instance already had one (from past Trakt imports) — unlike genres,
// where the set genuinely shrank to zero after one sweep, the ~2%
// residual here mostly lacks an id because TMDB has none, or the show
// resolved via TVDB only. A clause would match that same handful of rows
// forever, not just once. They self-heal within the existing compliance
// window (~5 months) or immediately via the manual "refresh metadata"
// button — acceptable for a supplementary deep link on a small fraction
// of the library. See docs/adr/0005-metadata-refresh.md's update.

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

// Same deliberate omission as findStaleShows' own comment above: no
// "never populated imdb id" clause, for the same reasoning (563/580
// movies already covered at the time this was added).

/**
 * Exported for the manual "refresh metadata" button
 * (apps/api/src/routes/library/shows.ts's POST /library/shows/{slug}/refresh) —
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
      metadataSource: provider.source,
      metadataRefreshedAt: new Date(),
    })
    .where(eq(shows.id, candidate.id))

  // Correcting, not just filling: existing imdb rows mostly came from
  // Trakt/Plex, a lower-quality source than TMDB — see upsertExternalId's
  // own doc comment for why refresh paths use `correct: true` and create
  // paths (apps/api/src/lib/media.ts) don't.
  if (fetched.imdbId) {
    await upsertExternalId(db, 'show', candidate.id, 'imdb', fetched.imdbId, { correct: true })
  }

  if (fetched.seasons.length > 0) {
    const regularSeasons = fetched.seasons.filter((s) => s.seasonNumber > 0)
    // TMDB can list an announced-but-not-yet-populated future season
    // (episodeCount 0, no air date) alongside the season that's actually
    // still airing — confirmed live against Silo, which had such a season
    // 4 placeholder while season 3 was the one airing. Excluding
    // episodeCount-0 seasons here means a genuinely empty placeholder is
    // never mistaken for "current" or "upcoming" below.
    const seasonsWithEpisodes = regularSeasons.filter((s) => s.episodeCount > 0)
    const isAiring = fetched.status !== null && AIRING_STATUSES.includes(fetched.status)
    const today = new Date().toISOString().slice(0, 10)

    // The highest-numbered season that's actually started airing —
    // "latest by season number" isn't good enough on its own, because TMDB
    // can list a still-empty next-season stub with a higher number and no
    // (or future) air date alongside the season that's genuinely mid-run.
    // Confirmed live against Professor T and The Pitt, both of which had a
    // placeholder next season outranking their real current one.
    const startedSeasonNumbers = seasonsWithEpisodes
      .filter((s) => s.airDate !== null && s.airDate <= today)
      .map((s) => s.seasonNumber)
    const currentSeasonNumber =
      startedSeasonNumbers.length > 0 ? Math.max(...startedSeasonNumbers) : null

    // Every season TMDB has announced episodes for but that hasn't started
    // airing yet (null or future air date) — resolved regardless of
    // `isAiring`, unlike the current season below. This is what closes the
    // gap for a show TMDB still calls 'Ended'/'Canceled' at the moment its
    // renewal is announced: the current-season check alone would never
    // fetch a season TMDB hasn't marked the show as airing for yet.
    const upcomingSeasonNumbers = seasonsWithEpisodes
      .filter((s) => s.airDate === null || s.airDate >= today)
      .map((s) => s.seasonNumber)

    // A past season, or any season once the show itself has finished, has
    // necessarily aired in full — only a still-airing show's current season,
    // plus any season announced but not yet aired, might have episodes this
    // instance doesn't know about yet (see showDetailSchema's
    // `airedEpisodes` doc comment for why this number exists at all). Goes
    // through resolveSeason (apps/api/src/lib/media.ts) rather than calling
    // provider.getSeason() directly so this data actually lands in the
    // local `episodes` table instead of being fetched and discarded —
    // otherwise a show nobody's opened a season/episode page for recently
    // never gets per-episode rows at all, no matter how long it airs for
    // (see docs/TODO_ARCHIVE.md). A Set dedupes the case where the current
    // season and an upcoming one are the same (an air date of exactly
    // today).
    const seasonNumbersToResolve = new Set(upcomingSeasonNumbers)
    if (isAiring && currentSeasonNumber !== null) seasonNumbersToResolve.add(currentSeasonNumber)

    const airedCountBySeason = new Map<number, number>()
    for (const seasonNumber of [...seasonNumbersToResolve].sort((a, b) => a - b)) {
      const resolvedEpisodes = await resolveSeason(
        db,
        provider,
        candidate.id,
        candidate.externalId,
        seasonNumber,
        locale,
      )
      const now = new Date()
      airedCountBySeason.set(
        seasonNumber,
        resolvedEpisodes.filter((e) => e.firstAired !== null && new Date(e.firstAired) <= now)
          .length,
      )
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
              : (airedCountBySeason.get(season.seasonNumber) ?? season.episodeCount),
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
 * (apps/api/src/routes/library/movies.ts's POST /library/movies/{slug}/refresh) —
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
      metadataSource: provider.source,
      metadataRefreshedAt: new Date(),
    })
    .where(eq(movies.id, candidate.id))

  // See refreshOneShow's identical comment above.
  if (fetched.imdbId) {
    await upsertExternalId(db, 'movie', candidate.id, 'imdb', fetched.imdbId, { correct: true })
  }
}

/** Up to EPISODE_IMDB_BACKFILL_PER_PASS episodes never checked for an IMDb
 * id, oldest first for stable, resumable paging across passes. The
 * notExists clause is belt-and-suspenders with imdbCheckedAt IS NULL —
 * resolveEpisodeImdbId always sets imdbCheckedAt when it writes a hit, but
 * this guards against ever re-selecting a row that somehow has an imdb
 * external_ids row without the checked flag set. */
async function findEpisodesNeedingImdbCheck(
  db: Database,
): Promise<{ id: string; showId: string; seasonNumber: number; episodeNumber: number }[]> {
  return db
    .select({
      id: episodes.id,
      showId: episodes.showId,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
    })
    .from(episodes)
    .where(
      and(
        isNull(episodes.imdbCheckedAt),
        notExists(
          db
            .select()
            .from(externalIds)
            .where(
              and(
                eq(externalIds.entityType, 'episode'),
                eq(externalIds.entityId, episodes.id),
                eq(externalIds.source, 'imdb'),
              ),
            ),
        ),
      ),
    )
    .orderBy(episodes.createdAt)
    .limit(EPISODE_IMDB_BACKFILL_PER_PASS)
}

/**
 * One-off drain of episodes that predate IMDb ids being fetched at all —
 * see EPISODE_IMDB_BACKFILL_PER_PASS's own comment. Self-terminating:
 * resolveEpisodeImdbId sets imdbCheckedAt on every episode it actually
 * asks a provider about, regardless of outcome, so the candidate set
 * strictly shrinks pass over pass. A show with no configured provider at
 * all is skipped without being marked checked — the same "nothing an
 * admin could act on, try again next pass" tradeoff
 * findStaleShows/runMetadataRefresh already make for the identical case.
 */
async function backfillEpisodeImdbIds(
  db: Database,
  ordered: MetadataProvider[],
  locale: string,
): Promise<number> {
  const candidates = await findEpisodesNeedingImdbCheck(db)
  if (candidates.length === 0) return 0

  const targets = await pickRefreshTargets(
    db,
    'show',
    [...new Set(candidates.map((c) => c.showId))],
    ordered,
  )

  let filled = 0
  for (const candidate of candidates) {
    const target = targets.get(candidate.showId)
    if (!target) continue
    try {
      const imdbId = await resolveEpisodeImdbId(
        db,
        target.provider,
        target.externalId,
        {
          id: candidate.id,
          seasonNumber: candidate.seasonNumber,
          episodeNumber: candidate.episodeNumber,
          imdbCheckedAt: null,
        },
        locale,
      )
      if (imdbId) filled += 1
    } catch (err) {
      console.error(`Episode IMDb backfill failed for episode ${candidate.id}:`, err)
    }
    await sleep(REQUEST_STAGGER_MS)
  }
  return filled
}

/** Distinct (show, season) pairs with at least one episode never checked
 * for `overview` — `overviewCheckedAt IS NULL`, not `overview IS NULL`,
 * for exactly the reason `findEpisodesNeedingImdbCheck` above checks
 * `imdbCheckedAt` rather than the id column itself: a season with a
 * genuinely synopsis-less unaired episode must still drop out of this
 * candidate set once resolved, or it would look like a candidate forever
 * and get needlessly re-fetched every pass — including the very pass
 * that just resolved it (`resolveSeason` sets `overviewCheckedAt` on
 * every episode it touches, so this shrinks the same way the IMDb
 * candidate set does). */
async function findSeasonsNeedingOverviewBackfill(
  db: Database,
): Promise<{ showId: string; seasonNumber: number }[]> {
  return db
    .selectDistinct({ showId: episodes.showId, seasonNumber: episodes.seasonNumber })
    .from(episodes)
    .where(isNull(episodes.overviewCheckedAt))
    .orderBy(episodes.showId, episodes.seasonNumber)
    .limit(EPISODE_OVERVIEW_BACKFILL_SEASONS_PER_PASS)
}

/**
 * One-off drain of episodes that predate `overview` being cached at all
 * (see that column's own doc comment) — the calendar feed
 * (apps/api/src/calendar/build.ts) needs it locally rather than fetched
 * live per event. `resolveSeason` (apps/api/src/lib/media.ts) does the
 * actual fetch-and-upsert; this just walks every season still missing
 * it, oldest-added-show first, the same per-item try/catch-and-skip
 * shape as the IMDb backfill above.
 */
async function backfillEpisodeOverviews(
  db: Database,
  ordered: MetadataProvider[],
  locale: string,
): Promise<number> {
  const candidates = await findSeasonsNeedingOverviewBackfill(db)
  if (candidates.length === 0) return 0

  const targets = await pickRefreshTargets(
    db,
    'show',
    [...new Set(candidates.map((c) => c.showId))],
    ordered,
  )

  let seasonsFilled = 0
  for (const candidate of candidates) {
    const target = targets.get(candidate.showId)
    if (!target) continue
    try {
      await resolveSeason(
        db,
        target.provider,
        candidate.showId,
        target.externalId,
        candidate.seasonNumber,
        locale,
      )
      seasonsFilled += 1
    } catch (err) {
      console.error(
        `Episode overview backfill failed for show ${candidate.showId} season ${candidate.seasonNumber}:`,
        err,
      )
    }
    await sleep(REQUEST_STAGGER_MS)
  }
  return seasonsFilled
}

// How far apart two providers' air dates for the same episode are allowed
// to be and still count as agreeing (Gate B below) — confirmed live
// against Keep Your Hands Off Eizouken!: TMDB recorded every episode one
// calendar day earlier than TVDB *and* IMDb, who agree with each other,
// most likely a JST-midnight rounding difference in how TMDB normalizes a
// Japan broadcast date. A real disagreement (wrong season, wrong show)
// shows up as a mismatch of weeks or months, not exactly one day, so this
// stays tight enough to still catch that.
const AIR_DATE_TOLERANCE_DAYS = 1

/** Absolute difference between two 'YYYY-MM-DD' dates, in whole days. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const diffMs = Date.UTC(ay!, am! - 1, ad) - Date.UTC(by!, bm! - 1, bd)
  return Math.abs(diffMs) / (24 * 60 * 60 * 1000)
}

/** Distinct (show, season) pairs with at least one episode missing a
 * runtime that's never been checked against a fallback provider —
 * `runtimeCheckedAt IS NULL`, not `runtimeMinutes IS NULL` alone, for the
 * same "checked, provider genuinely has none" reasoning as
 * findSeasonsNeedingOverviewBackfill above: without it, a season with an
 * episode no configured provider has a runtime for would look like a
 * candidate forever. */
async function findSeasonsNeedingRuntimeBackfill(
  db: Database,
): Promise<{ showId: string; seasonNumber: number }[]> {
  return db
    .selectDistinct({ showId: episodes.showId, seasonNumber: episodes.seasonNumber })
    .from(episodes)
    .where(and(isNull(episodes.runtimeMinutes), isNull(episodes.runtimeCheckedAt)))
    .orderBy(episodes.showId, episodes.seasonNumber)
    .limit(EPISODE_RUNTIME_BACKFILL_SEASONS_PER_PASS)
}

/**
 * Attempts to fill one season's still-null episode runtimes from a
 * fallback provider — the primary provider (TMDB, on every show this was
 * written for) already had its chance via resolveSeason's own
 * same-provider coalesce (apps/api/src/lib/media.ts).
 *
 * Guarded against TMDB/TVDB's well-known episode-numbering disagreements
 * (an OVA or recap one provider files inside a season that the other
 * treats as a special, shifting every later episodeNumber): naively
 * merging by (seasonNumber, episodeNumber) alone risks attaching the
 * wrong runtime to the wrong episode — invisibly so for anime, where
 * episode lengths are near-uniform and a swapped value looks fine on
 * inspection.
 *
 * Gate A (season shape): the fallback's episode count for this season
 * must match what the primary provider already cached locally
 * (`seasons.episodeCount`) — catches a split/merged season with no extra
 * provider call. A mismatch fills nothing for the whole season. Gate B
 * (per-episode air date): an individual episode only fills when both
 * sides have a `firstAired` and it agrees within AIR_DATE_TOLERANCE_DAYS
 * (see that constant's own comment — a real per-provider quirk, not a
 * loosening for its own sake); when either side lacks a date, Gate A's
 * season-shape check is the only corroboration available, and is accepted
 * as sufficient. Title similarity was considered and rejected: TVDB
 * frequently carries a romaji/alternate title where TMDB carries a
 * localized one for the very same episode, so a title gate would produce
 * false rejections on exactly the anime-heavy shows this exists for.
 *
 * Every episode this function considers gets `runtimeCheckedAt` set
 * regardless of outcome, same "we asked, not we found" convention as
 * `overviewCheckedAt`/`imdbCheckedAt` — this is what makes a season drop
 * out of findSeasonsNeedingRuntimeBackfill's candidate set once checked,
 * whether or not anything was actually filled.
 *
 * Gate B compares the *local* `firstAired`, which `resolveSeason`
 * (apps/api/src/lib/media.ts) now corrects on every resolve rather than
 * freezing at first insert. Accepted, narrow edge case: an episode whose
 * runtime is still null gets its local date corrected by the primary
 * provider right as (or just before) this runs, the fallback provider
 * hasn't caught up to the same correction yet, Gate B now sees a
 * disagreement it wouldn't have against the old frozen date, and rejects
 * the fill — permanently, since a checked episode never re-enters the
 * candidate set. Not guarded against: it needs an unfilled runtime, a
 * reschedule, and the two providers being out of sync at exactly the
 * right moment, and an already-filled runtime is unaffected regardless
 * (this function's own candidate set requires `runtimeMinutes IS NULL`).
 */
async function fillSeasonRuntimesFromFallback(
  db: Database,
  showId: string,
  seasonNumber: number,
  fallbackProvider: MetadataProvider,
  fallbackExternalId: string,
  locale: string,
): Promise<number> {
  const [localSeason] = await db
    .select({ episodeCount: seasons.episodeCount })
    .from(seasons)
    .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, seasonNumber)))
    .limit(1)

  const localEpisodes = await db
    .select({
      id: episodes.id,
      episodeNumber: episodes.episodeNumber,
      firstAired: episodes.firstAired,
      runtimeMinutes: episodes.runtimeMinutes,
    })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, seasonNumber)))

  const needFilling = localEpisodes.filter((e) => e.runtimeMinutes === null)
  if (needFilling.length === 0) return 0

  const { episodes: fallbackEpisodes } = await fallbackProvider.getSeason(
    fallbackExternalId,
    seasonNumber,
    locale,
  )

  const now = new Date()

  // Gate A. A mismatch means the two providers disagree about how this
  // season is split up, so no per-episode numbering from it can be
  // trusted — mark every still-null episode checked without filling any.
  if (!localSeason || fallbackEpisodes.length !== localSeason.episodeCount) {
    await db
      .update(episodes)
      .set({ runtimeCheckedAt: now })
      .where(
        inArray(
          episodes.id,
          needFilling.map((e) => e.id),
        ),
      )
    return 0
  }

  const fallbackByNumber = new Map(fallbackEpisodes.map((e) => [e.episodeNumber, e]))
  let filled = 0
  for (const local of needFilling) {
    const fallback = fallbackByNumber.get(local.episodeNumber)
    const airDatesDisagree =
      fallback?.firstAired &&
      local.firstAired &&
      daysBetween(fallback.firstAired, local.firstAired) > AIR_DATE_TOLERANCE_DAYS
    if (fallback && !airDatesDisagree && fallback.runtimeMinutes !== null) {
      await db
        .update(episodes)
        .set({ runtimeMinutes: fallback.runtimeMinutes, runtimeCheckedAt: now })
        .where(eq(episodes.id, local.id))
      filled += 1
    } else {
      await db.update(episodes).set({ runtimeCheckedAt: now }).where(eq(episodes.id, local.id))
    }
  }
  return filled
}

/**
 * Every season of one show still missing an episode runtime, backfilled
 * from a fallback provider right now — used by the manual "refresh
 * metadata" button (apps/api/src/routes/library/shows.ts) so pressing it
 * fixes this show's missing runtimes immediately, the same way it already
 * fixes a stale poster or status, rather than waiting for the drain below
 * to happen to reach it. Not staggered like the background sweep: bounded
 * by one show's own season count, same "manual and user-initiated" shape
 * as refreshOneShow itself.
 */
export async function backfillShowEpisodeRuntimes(
  db: Database,
  showId: string,
  ordered: MetadataProvider[],
  locale: string,
): Promise<number> {
  const seasonsNeeded = await db
    .selectDistinct({ seasonNumber: episodes.seasonNumber })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        isNull(episodes.runtimeMinutes),
        isNull(episodes.runtimeCheckedAt),
      ),
    )
  if (seasonsNeeded.length === 0) return 0

  // Exclude whichever provider this show's primary metadata comes from —
  // it already had its chance via resolveSeason's own same-provider
  // coalesce (apps/api/src/lib/media.ts).
  const primary = await pickRefreshTarget(db, 'show', showId, ordered)
  const remaining = primary ? ordered.filter((p) => p.source !== primary.provider.source) : ordered
  const fallback =
    (await pickRefreshTarget(db, 'show', showId, remaining)) ??
    (await reverseLookupFallbackTarget(db, showId, remaining, locale))
  if (!fallback) {
    // No fallback provider has this show under any id, even after a
    // reverse lookup by its stored imdb id — mark every still-null episode
    // checked so the background drain doesn't immediately re-attempt the
    // same doomed lookup (findSeasonsNeedingRuntimeBackfill below).
    await db
      .update(episodes)
      .set({ runtimeCheckedAt: new Date() })
      .where(
        and(
          eq(episodes.showId, showId),
          isNull(episodes.runtimeMinutes),
          isNull(episodes.runtimeCheckedAt),
        ),
      )
    return 0
  }

  let seasonsFilled = 0
  for (const { seasonNumber } of seasonsNeeded) {
    try {
      const filled = await fillSeasonRuntimesFromFallback(
        db,
        showId,
        seasonNumber,
        fallback.provider,
        fallback.externalId,
        locale,
      )
      if (filled > 0) seasonsFilled += 1
    } catch (err) {
      console.error(
        `Episode runtime backfill failed for show ${showId} season ${seasonNumber}:`,
        err,
      )
    }
  }
  return seasonsFilled
}

/**
 * One-off drain of seasons with an episode runtime the primary provider
 * doesn't have — see fillSeasonRuntimesFromFallback's own doc comment for
 * the cross-provider numbering guard. Same per-item try/catch-and-skip
 * shape as the backfills above, with the fallback provider resolved once
 * per show and cached across that show's other candidate seasons within
 * this pass. A show with no fallback provider id on file gets one reverse-
 * lookup attempt by its stored imdb id (reverseLookupFallbackTarget above);
 * if even that finds nothing, its still-null episodes are marked checked so
 * they stop consuming a candidate slot every pass forever (see
 * findSeasonsNeedingRuntimeBackfill's `LIMIT 50`).
 */
async function backfillEpisodeRuntimes(
  db: Database,
  ordered: MetadataProvider[],
  locale: string,
): Promise<number> {
  const candidates = await findSeasonsNeedingRuntimeBackfill(db)
  if (candidates.length === 0) return 0

  const showIds = [...new Set(candidates.map((c) => c.showId))]
  const primaryTargets = await pickRefreshTargets(db, 'show', showIds, ordered)

  const fallbackByShow = new Map<
    string,
    { provider: MetadataProvider; externalId: string } | null
  >()
  async function fallbackFor(showId: string) {
    const cached = fallbackByShow.get(showId)
    if (cached !== undefined) return cached
    const primary = primaryTargets.get(showId)
    const remaining = primary
      ? ordered.filter((p) => p.source !== primary.provider.source)
      : ordered
    let target = await pickRefreshTarget(db, 'show', showId, remaining)
    if (!target) {
      target = await reverseLookupFallbackTarget(db, showId, remaining, locale)
      await sleep(REQUEST_STAGGER_MS)
    }
    fallbackByShow.set(showId, target)
    return target
  }

  let seasonsFilled = 0
  for (const candidate of candidates) {
    const fallback = await fallbackFor(candidate.showId)
    if (!fallback) {
      // Reverse lookup was already tried inside fallbackFor and found
      // nothing — see this function's own doc comment.
      await db
        .update(episodes)
        .set({ runtimeCheckedAt: new Date() })
        .where(
          and(
            eq(episodes.showId, candidate.showId),
            eq(episodes.seasonNumber, candidate.seasonNumber),
            isNull(episodes.runtimeMinutes),
          ),
        )
      continue
    }
    try {
      const filled = await fillSeasonRuntimesFromFallback(
        db,
        candidate.showId,
        candidate.seasonNumber,
        fallback.provider,
        fallback.externalId,
        locale,
      )
      if (filled > 0) seasonsFilled += 1
    } catch (err) {
      console.error(
        `Episode runtime backfill failed for show ${candidate.showId} season ${candidate.seasonNumber}:`,
        err,
      )
    }
    await sleep(REQUEST_STAGGER_MS)
  }
  return seasonsFilled
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
): Promise<{
  showsRefreshed: number
  moviesRefreshed: number
  episodeImdbIdsFilled: number
  episodeOverviewSeasonsFilled: number
  episodeRuntimeSeasonsFilled: number
}> {
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

  const episodeImdbIdsFilled = await backfillEpisodeImdbIds(db, ordered, locale)
  const episodeOverviewSeasonsFilled = await backfillEpisodeOverviews(db, ordered, locale)
  const episodeRuntimeSeasonsFilled = await backfillEpisodeRuntimes(db, ordered, locale)

  return {
    showsRefreshed,
    moviesRefreshed,
    episodeImdbIdsFilled,
    episodeOverviewSeasonsFilled,
    episodeRuntimeSeasonsFilled,
  }
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
      .then(
        ({
          showsRefreshed,
          moviesRefreshed,
          episodeImdbIdsFilled,
          episodeOverviewSeasonsFilled,
          episodeRuntimeSeasonsFilled,
        }) => {
          if (
            showsRefreshed ||
            moviesRefreshed ||
            episodeImdbIdsFilled ||
            episodeOverviewSeasonsFilled ||
            episodeRuntimeSeasonsFilled
          ) {
            console.log(
              `Metadata refresh: ${showsRefreshed} show(s), ${moviesRefreshed} movie(s) updated, ` +
                `${episodeImdbIdsFilled} episode IMDb id(s) filled, ` +
                `${episodeOverviewSeasonsFilled} episode overview season(s) filled, ` +
                `${episodeRuntimeSeasonsFilled} episode runtime season(s) filled.`,
            )
          }
        },
      )
      .catch((err: unknown) => console.error('Metadata refresh pass failed:', err))
  void run()
  setInterval(() => void run(), DAY_MS)
}
