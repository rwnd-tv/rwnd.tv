import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  UNKNOWN_WATCHED_AT,
  droppedStatusSchema,
  watchedStatusSchema,
  watchesSchema,
  listLibraryMoviesResponseSchema,
  listLibraryShowsResponseSchema,
  markShowWatchedRequestSchema,
  markShowWatchedResponseSchema,
  movieDetailSchema,
  onDeckResponseSchema,
  removeWatchesRequestSchema,
  removeShowWatchesResponseSchema,
  resolveMediaRequestSchema,
  resolveMediaResponseSchema,
  seasonDetailSchema,
  showDetailSchema,
  upNextResponseSchema,
} from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { droppedShows, episodes, externalIds, movies, plays, seasons, shows } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import type { MetadataProvider } from '../providers/types.js'
import { requireAuth } from '../middleware/auth.js'
import {
  findNextAiringEpisode,
  findNextUnwatchedEpisode,
  resolveMovie,
  resolveShow,
  resolveSeasonEpisodes,
  resolveShowEpisodes,
  type ResolvedEpisode,
} from '../lib/media.js'
import {
  pickRefreshTarget,
  pickRefreshTargets,
  refreshOneMovie,
  refreshOneShow,
} from '../metadata/refresh.js'
import { orderedProviders } from '../providers/priority.js'
import { isProviderSource } from '../lib/provider-source.js'

/**
 * Shared by the show- and season-level "Watched" button routes below.
 * `resolvedEpisodes` is every episode in scope (already resolved to local
 * rows) — this excludes ones that haven't aired yet (unknown or future
 * `firstAired` — never guess a watch for an episode that isn't out) and,
 * unless `body.additional` is set, ones the user has already watched too
 * (the default "fill in what's missing" mode). `additional` skips that
 * second filter — every aired episode gets a new play regardless of
 * current watched state, which is what the "log an additional watch"
 * button (ShowDetailPage.tsx/SeasonDetailPage.tsx) needs for a rewatch.
 * Either way, the new plays land at the same `watchedAt`, or (when
 * `useReleaseDate` is set) each at its own episode's release date. When
 * `watchedAt` is exactly the "unknown date" sentinel (UNKNOWN_WATCHED_AT),
 * an episode that already has an unknown-date watch is excluded too —
 * regardless of `additional` — since a second one would be indistinguishable
 * from the first and add nothing (see plays.ts's POST /plays, which
 * enforces the same rule for the single-episode flow). Returns how many
 * plays were actually logged.
 */
async function logMissingWatches(
  db: Database,
  userId: string,
  resolvedEpisodes: ResolvedEpisode[],
  body: { watchedAt?: string; useReleaseDate?: true; additional?: true },
): Promise<number> {
  if (resolvedEpisodes.length === 0) return 0

  const episodeIds = resolvedEpisodes.map((e) => e.id)
  const alreadyWatched = body.additional
    ? new Set<string>()
    : new Set(
        (
          await db
            .select({ episodeId: plays.episodeId })
            .from(plays)
            .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        ).map((row) => row.episodeId),
      )

  const alreadyHasUnknownWatch =
    body.watchedAt === UNKNOWN_WATCHED_AT
      ? new Set(
          (
            await db
              .select({ episodeId: plays.episodeId })
              .from(plays)
              .where(
                and(
                  eq(plays.userId, userId),
                  inArray(plays.episodeId, episodeIds),
                  eq(plays.watchedAt, new Date(UNKNOWN_WATCHED_AT)),
                ),
              )
          ).map((row) => row.episodeId),
        )
      : new Set<string>()

  const now = new Date()
  const targets = resolvedEpisodes.filter(
    (e): e is ResolvedEpisode & { firstAired: string } =>
      !alreadyWatched.has(e.id) &&
      !alreadyHasUnknownWatch.has(e.id) &&
      e.firstAired !== null &&
      new Date(e.firstAired) <= now,
  )

  const values = targets.map((e) => ({
    userId,
    episodeId: e.id,
    watchedAt: body.useReleaseDate ? new Date(e.firstAired) : new Date(body.watchedAt!),
    source: 'manual' as const,
  }))

  if (values.length > 0) await db.insert(plays).values(values)
  return values.length
}

export const libraryRoutes = new OpenAPIHono<AppEnv>()

/**
 * Backs the TV Shows gallery (apps/web/src/routes/ShowsPage.tsx). Unlike
 * /plays, this returns the user's whole library in one response — the
 * gallery's filter/sort controls are client-side (real libraries are
 * ~500 shows, comfortably one small payload), so there's no cursor here.
 *
 * "Watched episodes" and "total episodes" come from two independent
 * aggregates (CTEs), joined together afterwards, rather than one query
 * that joins plays/episodes and seasons directly against shows: doing that
 * in one GROUP BY fans out every matching season row against every
 * matching play row for the same show, multiplying SUM(episode_count) by
 * however many plays that show has. Keeping the aggregates separate avoids
 * that entirely — see apps/api/src/test/library.test.ts's
 * "does not double-count" case, which is what this shape exists to pass.
 *
 * Season 0 (specials) is excluded from both halves of the fraction — see
 * the `case when` in `watched` and the `gt` filter in `totals` — but a
 * show watched *only* via specials still needs to appear (206 of this
 * project's own plays are against specials, across 48 shows). That's why
 * the query drives from `watched`, not `shows`: a show enters the result
 * the moment it has any play at all, and only the numerator/denominator
 * exclude season 0, not membership in the list.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows',
    summary: 'List every show the current user has watched, with watch progress',
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Shows library',
        content: { 'application/json': { schema: listLibraryShowsResponseSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const watched = db.$with('watched').as(
      db
        .select({
          showId: episodes.showId,
          // COUNT(DISTINCT ... CASE ...) rather than a WHERE clause: a
          // WHERE season_number > 0 here would drop specials-only shows
          // from this CTE (and therefore the whole result, since it drives
          // the query) instead of just excluding them from the count.
          watchedEpisodes:
            sql<number>`count(distinct case when ${episodes.seasonNumber} > 0 then ${episodes.id} end)`
              .mapWith(Number)
              .as('watched_episodes'),
          // postgres.js only auto-parses timestamptz into a JS Date for
          // typed columns — a raw aggregate like this comes back as a
          // string, so map it explicitly rather than relying on the `<Date>`
          // type parameter (which affects TS typing only, not runtime).
          lastWatchedAt: sql`max(${plays.watchedAt})`
            .mapWith((v: string) => new Date(v))
            .as('last_watched_at'),
        })
        .from(plays)
        .innerJoin(episodes, eq(plays.episodeId, episodes.id))
        .where(eq(plays.userId, userId))
        .groupBy(episodes.showId),
    )

    const totals = db.$with('totals').as(
      db
        .select({
          showId: seasons.showId,
          // SUM(integer) is `numeric` in Postgres, which the driver returns
          // as a string — .mapWith(Number) is load-bearing, not cosmetic.
          totalEpisodes: sql<number>`sum(${seasons.episodeCount})`
            .mapWith(Number)
            .as('total_episodes'),
        })
        .from(seasons)
        .where(gt(seasons.seasonNumber, 0))
        .groupBy(seasons.showId),
    )

    const rows = await db
      .with(watched, totals)
      .select({
        id: shows.id,
        slug: shows.slug,
        title: shows.title,
        year: shows.year,
        posterPath: shows.posterPath,
        status: shows.status,
        genres: shows.genres,
        voteAverage: shows.voteAverage,
        // Null when this user has no droppedShows row at all for this show
        // (never dropped) — joined (not a subquery) and scoped to userId in
        // the join condition itself, not a WHERE clause, so a show this
        // user hasn't dropped still gets a row instead of being excluded.
        // manualDropped (when set) always wins over traktDropped — see
        // droppedShows's doc comment in packages/db/src/schema.ts.
        traktDropped: droppedShows.traktDropped,
        manualDropped: droppedShows.manualDropped,
        watchedEpisodes: watched.watchedEpisodes,
        lastWatchedAt: watched.lastWatchedAt,
        // Absent (null) until the metadata refresher has cached this show's
        // seasons — see apps/api/src/metadata/refresh.ts. Not 0: the UI
        // needs to tell "not counted yet" apart from "counted, zero".
        totalEpisodes: totals.totalEpisodes,
      })
      .from(watched)
      .innerJoin(shows, eq(shows.id, watched.showId))
      .leftJoin(totals, eq(totals.showId, watched.showId))
      .leftJoin(
        droppedShows,
        and(eq(droppedShows.showId, watched.showId), eq(droppedShows.userId, userId)),
      )
      .orderBy(asc(shows.title))

    return c.json({
      shows: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        status: row.status,
        genres: row.genres,
        voteAverage: row.voteAverage,
        dropped: row.manualDropped ?? row.traktDropped ?? false,
        watchedEpisodes: row.watchedEpisodes,
        totalEpisodes: row.totalEpisodes ?? null,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)

/**
 * Backs the Dashboard search's show results (SearchResultCard.tsx) —
 * resolving a TMDB search hit to a local show is normally a side effect of
 * logging a watch (resolveShow, called from inside resolveEpisode etc.),
 * but a show result now links straight to its own page instead of logging
 * anything, so it needs a way to get (or create) that page's slug first.
 * Idempotent: resolveShow itself already no-ops into a lookup if the show
 * was resolved before, by anyone.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/resolve',
    summary: 'Resolve a show search result to its local page slug',
    middleware: [requireAuth] as const,
    request: { body: { content: { 'application/json': { schema: resolveMediaRequestSchema } } } },
    responses: {
      200: {
        description: 'Resolved',
        content: { 'application/json': { schema: resolveMediaResponseSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!

    const show = await resolveShow(db, provider, body.externalId, user.locale)
    return c.json({ slug: show.slug })
  },
)

/**
 * Movie counterpart of POST /library/shows/resolve above — same reasoning:
 * backs the Dashboard search's movie results, which now link straight to
 * their own page (SearchResultCard.tsx) instead of logging a watch inline.
 * Idempotent, same as resolveShow.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/movies/resolve',
    summary: 'Resolve a movie search result to its local page slug',
    middleware: [requireAuth] as const,
    request: { body: { content: { 'application/json': { schema: resolveMediaRequestSchema } } } },
    responses: {
      200: {
        description: 'Resolved',
        content: { 'application/json': { schema: resolveMediaResponseSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const provider = c.get('metadataProvider')
    const user = c.get('user')!

    const movie = await resolveMovie(db, provider, body.externalId, user.locale)
    return c.json({ slug: movie.slug })
  },
)

/** How far back a play counts toward "recently watched" for the Dashboard's
 * On Deck and Up Next rows below — TBD in the sense that this is a first
 * guess, not something James asked for by number; easy to retune later. */
const DASHBOARD_ROW_WINDOW_DAYS = 30

/** Cap on how many cards the Dashboard's On Deck and Up Next rows show
 * (James, 2026-08-24) — applied after sorting, so it's always the 8
 * most-relevant-by-that-row's-own-ordering, not an arbitrary 8. */
const DASHBOARD_ROW_LIMIT = 8

interface RecentlyWatchedCandidate {
  id: string
  slug: string
  title: string
  posterPath: string | null
  /** Whichever configured provider actually has a recorded id for this
   * show (priority order — pickRefreshTargets), paired with that id. Not
   * necessarily the same provider for every candidate: a show resolved
   * via TVDB (no `tmdb` external_ids row at all) still belongs here, it
   * just needs episode/season lookups sent to TVDB instead of TMDB. */
  provider: MetadataProvider
  providerExternalId: string
  /** Highest non-special season number this user has a watch in — where to
   * start scanning forward from (both On Deck and Up Next below want "from
   * wherever the viewer actually got to", not from season 1). Null if every
   * recent watch was a special. */
  maxWatchedSeason: number | null
  /** Highest episode number watched within `maxWatchedSeason` — "the latest
   * episode watched, in air order". Only On Deck uses this (Up Next only
   * cares about unaired episodes, which can't have a gap-vs-not distinction
   * — see findNextAiringEpisode). Null exactly when maxWatchedSeason is
   * null. */
  maxWatchedEpisodeInMaxSeason: number | null
}

/**
 * Shows the current user watched within `DASHBOARD_ROW_WINDOW_DAYS` days,
 * not dropped, with an id from *some* configured provider (a show with no
 * recorded id from any of them can't be resolved against anything —
 * excluded rather than kept as a candidate nothing can act on). Shared by
 * the On Deck and Up Next routes below: both start from the same "what has
 * this person been watching lately" set, they just look for a different
 * next episode from it.
 */
async function getRecentlyWatchedCandidates(
  db: Database,
  userId: string,
  providers: MetadataProvider[],
): Promise<RecentlyWatchedCandidate[]> {
  const cutoff = new Date(Date.now() - DASHBOARD_ROW_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // A play dated exactly 1900-01-01 is Trakt's "I don't remember when"
  // backfill sentinel (see showDetailSchema's doc comment), not real
  // recent activity — excluded from both aggregates the same way the
  // show page's own watchedRange query excludes it.
  const recentWatch = db.$with('recent_watch').as(
    db
      .select({
        showId: episodes.showId,
        lastWatchedAt:
          sql`max(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`
            .mapWith((v: string) => new Date(v))
            .as('last_watched_at'),
        maxWatchedSeason: sql<
          number | null
        >`max(case when ${episodes.seasonNumber} > 0 then ${episodes.seasonNumber} end)`.as(
          'max_watched_season',
        ),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(eq(plays.userId, userId))
      .groupBy(episodes.showId),
  )

  // Per (show, season), the highest episode number this user has watched —
  // joined below against recentWatch.maxWatchedSeason to get "the latest
  // episode watched, in air order" without a nested aggregate (Postgres
  // doesn't allow one aggregate's result to feed another within the same
  // GROUP BY).
  const watchedEpisodesBySeason = db.$with('watched_episodes_by_season').as(
    db
      .select({
        showId: episodes.showId,
        seasonNumber: episodes.seasonNumber,
        maxWatchedEpisode: sql<number>`max(${episodes.episodeNumber})`.as('max_watched_episode'),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(eq(plays.userId, userId))
      .groupBy(episodes.showId, episodes.seasonNumber),
  )

  const rows = await db
    .with(recentWatch, watchedEpisodesBySeason)
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      posterPath: shows.posterPath,
      maxWatchedSeason: recentWatch.maxWatchedSeason,
      maxWatchedEpisodeInMaxSeason: watchedEpisodesBySeason.maxWatchedEpisode,
      // Null when this user has no droppedShows row at all for this show —
      // same join shape as /library/shows above.
      traktDropped: droppedShows.traktDropped,
      manualDropped: droppedShows.manualDropped,
    })
    .from(recentWatch)
    .innerJoin(shows, eq(shows.id, recentWatch.showId))
    .leftJoin(droppedShows, and(eq(droppedShows.showId, shows.id), eq(droppedShows.userId, userId)))
    // Left, not inner — recentWatch.maxWatchedSeason is null whenever every
    // recent watch was a special, and NULL never equality-matches NULL in
    // SQL, so this naturally yields no row (maxWatchedEpisodeInMaxSeason
    // stays null) exactly when there's nothing meaningful to report.
    .leftJoin(
      watchedEpisodesBySeason,
      and(
        eq(watchedEpisodesBySeason.showId, recentWatch.showId),
        eq(watchedEpisodesBySeason.seasonNumber, recentWatch.maxWatchedSeason),
      ),
    )
    // A bare Date doesn't survive being bound as a parameter against a
    // raw-sql-derived CTE column the way it does against a real typed
    // column (postgres.js has no type hint to serialize it by) — needs
    // `.toISOString()` plus an explicit cast, same gotcha as the
    // dropped-show CASE expression in library.ts's toggleDropped route.
    .where(sql`${recentWatch.lastWatchedAt} > ${cutoff.toISOString()}::timestamptz`)
    .orderBy(desc(recentWatch.lastWatchedAt))

  const undropped = rows.filter((row) => !(row.manualDropped ?? row.traktDropped ?? false))
  // One query for every candidate's external ids rather than one per show
  // — same reasoning as the background refresher's own bulk lookup.
  const targets = await pickRefreshTargets(
    db,
    'show',
    undropped.map((row) => row.id),
    providers,
  )
  return undropped.flatMap((row) => {
    const target = targets.get(row.id)
    if (!target) return []
    return [
      {
        id: row.id,
        slug: row.slug,
        title: row.title,
        posterPath: row.posterPath,
        maxWatchedSeason: row.maxWatchedSeason,
        maxWatchedEpisodeInMaxSeason: row.maxWatchedEpisodeInMaxSeason,
        provider: target.provider,
        providerExternalId: target.externalId,
      },
    ]
  })
}

/**
 * Backs the Dashboard's On Deck row (apps/web/src/routes/DashboardPage.tsx)
 * — one card per recently-watched, non-dropped show that hasn't finished,
 * each pointing at the next episode the viewer hasn't seen yet, sorted by
 * that episode's air date (oldest first — see the sort below).
 * findNextUnwatchedEpisode resolves each candidate's next episode from
 * whichever provider actually knows that show (getRecentlyWatchedCandidates'
 * own `provider` field, not a single fixed one) — that part can't be done
 * in SQL, since an unwatched episode has no local row to query until
 * someone actually resolves it (see resolveEpisode's doc comment).
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/on-deck',
    summary: "The current user's On Deck row",
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'On Deck shows',
        content: { 'application/json': { schema: onDeckResponseSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const candidates = await getRecentlyWatchedCandidates(db, user.id, providers)

    const shownShows = []
    for (const candidate of candidates) {
      const next = await findNextUnwatchedEpisode(
        db,
        candidate.provider,
        user.id,
        candidate.id,
        candidate.providerExternalId,
        // No non-special watch yet (e.g. only specials watched recently) —
        // start from season 1 rather than treating season 0 as the
        // furthest point reached.
        candidate.maxWatchedSeason ?? 1,
        user.locale,
        // Off by default (see users.onDeckFillGaps's doc comment): an
        // aired-but-unwatched episode earlier than the latest one this user
        // has watched doesn't count as "next" unless they've opted into
        // gap-filling.
        user.onDeckFillGaps ? null : candidate.maxWatchedEpisodeInMaxSeason,
      )
      if (next) {
        shownShows.push({
          slug: candidate.slug,
          title: candidate.title,
          posterPath: candidate.posterPath,
          seasonNumber: next.seasonNumber,
          episodeNumber: next.episodeNumber,
          firstAired: next.firstAired,
        })
      }
    }

    // Oldest next-episode air date first — the longer something's been
    // sitting there aired-but-unwatched, the further behind you are on it,
    // which reads as more urgent than a show you're only one day behind on.
    shownShows.sort((a, b) => a.firstAired.localeCompare(b.firstAired))

    return c.json({ shows: shownShows.slice(0, DASHBOARD_ROW_LIMIT) })
  },
)

/**
 * Backs the Dashboard's Up Next row (apps/web/src/routes/DashboardPage.tsx)
 * — one card per recently-watched, non-dropped show's next *upcoming*
 * episode (not yet aired), independent of On Deck above: a show can be
 * behind on already-aired episodes (On Deck) and still have something
 * upcoming (Up Next) at the same time, by design (James, 2026-08-23) —
 * they answer different questions, so neither excludes the other.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/up-next',
    summary: "The current user's Up Next row",
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Up Next shows',
        content: { 'application/json': { schema: upNextResponseSchema } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const candidates = await getRecentlyWatchedCandidates(db, user.id, providers)

    const shownShows = []
    for (const candidate of candidates) {
      const next = await findNextAiringEpisode(
        db,
        candidate.provider,
        user.id,
        candidate.id,
        candidate.providerExternalId,
        candidate.maxWatchedSeason ?? 1,
        user.locale,
      )
      if (next) {
        shownShows.push({
          slug: candidate.slug,
          title: candidate.title,
          posterPath: candidate.posterPath,
          seasonNumber: next.seasonNumber,
          episodeNumber: next.episodeNumber,
          firstAired: next.firstAired,
        })
      }
    }

    // Soonest-airing first — unlike On Deck (ordered by watch recency,
    // inherited from getRecentlyWatchedCandidates), the whole point of this
    // row is knowing what's coming up next, so it reads top-to-bottom as a
    // countdown rather than "what did I watch most recently".
    shownShows.sort((a, b) => a.firstAired.localeCompare(b.firstAired))

    return c.json({ shows: shownShows.slice(0, DASHBOARD_ROW_LIMIT) })
  },
)

/**
 * Backs the per-show page (apps/web/src/routes/ShowDetailPage.tsx), linked
 * to from the shows gallery and History. Not scoped to "shows this user has
 * watched" the way /library/shows is — the show itself is shared metadata,
 * not per-user data, so any authenticated user can look up any show that
 * exists locally; only the per-season/total watched counts are scoped to
 * the current user (and default to 0 for a show they haven't touched).
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}',
    summary: "Get a show, with the current user's watch progress",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show detail',
        content: { 'application/json': { schema: showDetailSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Backs the TMDB rating badge's link to the show's TMDB page (see
    // ShowDetailPage.tsx) — null for a show resolved before TMDB was the
    // only provider, or (in principle) a future non-TMDB provider match.
    const [tmdbExternalId] = await db
      .select({ externalId: externalIds.externalId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, 'show'),
          eq(externalIds.entityId, show.id),
          eq(externalIds.source, 'tmdb'),
        ),
      )
      .limit(1)

    // Backs the TVDB link on the same page — see the tmdbExternalId query
    // above for the identical convention. Independent of `tmdbExternalId`:
    // a show can have either id, both, or neither on record.
    const [tvdbExternalId] = await db
      .select({ externalId: externalIds.externalId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, 'show'),
          eq(externalIds.entityId, show.id),
          eq(externalIds.source, 'tvdb'),
        ),
      )
      .limit(1)

    const [droppedRow] = await db
      .select({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })
      .from(droppedShows)
      .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, show.id)))
      .limit(1)
    // manualDropped (when set) always wins over traktDropped — see
    // droppedShows's doc comment in packages/db/src/schema.ts.
    const dropped = droppedRow?.manualDropped ?? droppedRow?.traktDropped ?? false
    const droppedAt =
      droppedRow?.manualDropped != null ? droppedRow.manualDroppedAt : droppedRow?.traktDroppedAt

    const seasonRows = await db
      .select()
      .from(seasons)
      .where(eq(seasons.showId, show.id))
      .orderBy(asc(seasons.seasonNumber))

    // Real per-season counts, specials included — unlike the gallery-style
    // totals below, nothing here excludes season 0.
    const watchedBySeason = await db
      .select({
        seasonNumber: episodes.seasonNumber,
        watchedEpisodes: sql<number>`count(distinct ${episodes.id})`
          .mapWith(Number)
          .as('watched_episodes'),
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))
      .groupBy(episodes.seasonNumber)
    const watchedMap = new Map(
      watchedBySeason.map((row) => [row.seasonNumber, row.watchedEpisodes]),
    )

    // First/most recent watch, across every season (specials included) —
    // this is "when did I watch this show", not the gallery-style totals
    // below, so nothing here excludes season 0. MIN/MAX over zero matching
    // rows still returns one row (both columns null), not zero rows.
    //
    // A play dated exactly 1900-01-01 is Trakt's "I don't remember when"
    // sentinel, not a real date — the FILTER clauses exclude it from both
    // aggregates so it can't drag firstWatchedAt back to a bogus 1900;
    // `hasUnknownWatchDate` separately says whether one exists at all, so
    // the frontend can show "Watched: unknown" when that's *all* there is.
    const [watchedRange] = await db
      .select({
        firstWatchedAt: sql<
          string | null
        >`min(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        lastWatchedAt: sql<
          string | null
        >`max(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        hasUnknownWatchDate: sql<boolean>`coalesce(bool_or(extract(year from ${plays.watchedAt}) = 1900), false)`,
      })
      .from(plays)
      .innerJoin(episodes, eq(plays.episodeId, episodes.id))
      .where(and(eq(plays.userId, userId), eq(episodes.showId, show.id)))

    // Header summary mirrors /library/shows' convention exactly (season 0
    // excluded from both halves, null total when no regular season is
    // cached yet) so it reads consistently with the gallery card the user
    // likely just clicked through from.
    const regularSeasons = seasonRows.filter((season) => season.seasonNumber > 0)
    const totalEpisodes =
      regularSeasons.length > 0
        ? regularSeasons.reduce((sum, season) => sum + season.episodeCount, 0)
        : null
    // Null until every regular season has an aired-episode count cached —
    // see showDetailSchema's doc comment on `airedEpisodes` and the
    // metadata refresher (apps/api/src/metadata/refresh.ts), which is what
    // actually computes it. Only summed once complete, same as
    // totalEpisodes' own null-until-cached convention, so the button never
    // reads "fully watched" off a partial count.
    const airedEpisodes =
      regularSeasons.length > 0 && regularSeasons.every((s) => s.airedEpisodeCount !== null)
        ? regularSeasons.reduce((sum, season) => sum + (season.airedEpisodeCount ?? 0), 0)
        : null
    const watchedEpisodes = [...watchedMap.entries()]
      .filter(([seasonNumber]) => seasonNumber > 0)
      .reduce((sum, [, count]) => sum + count, 0)

    return c.json({
      id: show.id,
      slug: show.slug,
      title: show.title,
      year: show.year,
      overview: show.overview,
      posterPath: show.posterPath,
      status: show.status,
      genres: show.genres,
      voteAverage: show.voteAverage,
      tmdbId: tmdbExternalId?.externalId ?? null,
      tvdbId: tvdbExternalId?.externalId ?? null,
      metadataSource:
        show.metadataSource && isProviderSource(show.metadataSource) ? show.metadataSource : null,
      metadataRefreshedAt: show.metadataRefreshedAt.toISOString(),
      dropped,
      droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null,
      watchedEpisodes,
      totalEpisodes,
      airedEpisodes,
      firstWatchedAt: watchedRange?.firstWatchedAt
        ? new Date(watchedRange.firstWatchedAt).toISOString()
        : null,
      lastWatchedAt: watchedRange?.lastWatchedAt
        ? new Date(watchedRange.lastWatchedAt).toISOString()
        : null,
      hasUnknownWatchDate: watchedRange?.hasUnknownWatchDate ?? false,
      seasons: seasonRows.map((season) => ({
        seasonNumber: season.seasonNumber,
        name: season.name,
        episodeCount: season.episodeCount,
        posterPath: season.posterPath,
        airDate: season.airDate,
        watchedEpisodes: watchedMap.get(season.seasonNumber) ?? 0,
      })),
    })
  },
)

/**
 * Manual "refresh metadata" button (ShowDetailPage.tsx) — re-fetches this
 * one show from the provider right now, for the case TMDB itself has
 * something wrong (a bad poster, a stale status/episode count on a show
 * the automatic sweep won't re-check for months) rather than waiting on
 * apps/api/src/metadata/refresh.ts's own schedule. Reuses that module's
 * refreshOneShow — same fetch-and-upsert as the background sweep, not a
 * separate/lesser code path. No response body: the caller already has a
 * GET /library/shows/{slug} query to invalidate and refetch instead of
 * this route re-serializing the same show a second way.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/refresh',
    summary: "Refresh a show's cached metadata from the provider now",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      204: { description: 'Refreshed' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const ordered = await orderedProviders(db, c.get('metadataProviders'))
    const target = await pickRefreshTarget(db, 'show', show.id, ordered)
    // No configured provider has any id for this show — same 404 as "show
    // not found" itself, since there's nothing this route can refresh it
    // from either way.
    if (!target) return c.json({ error: 'Show not found' }, 404)

    await refreshOneShow(
      db,
      target.provider,
      { id: show.id, externalId: target.externalId },
      user.locale,
    )

    return c.body(null, 204)
  },
)

/**
 * Backs the season detail page (apps/web/src/routes/SeasonDetailPage.tsx),
 * linked to from a season card on the show page. Episode metadata (title,
 * overview, still image, runtime, air date) is fetched live from the
 * provider on every request rather than cached locally — unlike the show
 * itself, there's no local table of every episode a show has, only ones
 * the current user has actually logged a play against (see
 * apps/api/src/lib/media.ts's resolveEpisode), so there's nothing cached
 * to serve instead of asking the provider.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}',
    summary: 'Get one season of a show, with the current user’s per-episode watch status',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
    },
    responses: {
      200: {
        description: 'Season detail',
        content: { 'application/json': { schema: seasonDetailSchema } },
      },
      404: { description: 'Show or season not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Only reachable via a season card already rendered from show.seasons
    // (see ShowDetailPage.tsx), so a season not yet cached here shouldn't
    // normally happen — treated as 404 rather than falling through to a
    // provider call for a season number nobody linked to.
    const [seasonRow] = await db
      .select()
      .from(seasons)
      .where(and(eq(seasons.showId, show.id), eq(seasons.seasonNumber, seasonNumber)))
      .limit(1)
    if (!seasonRow) return c.json({ error: 'Season not found' }, 404)

    // Whichever configured provider actually has a recorded id for this
    // show — not necessarily the primary/first-priority one (found live:
    // a show resolved entirely via TVDB, with no `tmdb` external_ids row
    // at all, 404'd here when this was still hardcoded to the primary
    // provider — apps/api/src/import/match.ts's cross-provider fallback
    // means that's now a real, not just theoretical, case).
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Season not found' }, 404)

    // TVDB's own season/episode ids for the "view on TVDB" links —
    // deliberately independent of `target` above, which is whichever
    // provider actually has this show's season/episode *content* (TMDB,
    // usually) — this is specifically about the TVDB deep link, wanted
    // even when TVDB isn't the provider serving the page's own data. A
    // live, best-effort side lookup: only attempted when TVDB is
    // configured and this show has a recorded `tvdb` external id, and
    // never lets a failed/slow TVDB call break the rest of the page — the
    // link is just absent. When `target.provider` already *is* TVDB, this
    // ends up asking it the same question twice — a minor redundancy, not
    // worth special-casing away.
    const tvdbProvider = providers.find((p) => p.source === 'tvdb')
    let tvdbSeasonId: string | null = null
    const tvdbEpisodeIdByNumber = new Map<number, string>()
    if (tvdbProvider) {
      const [tvdbExternalId] = await db
        .select({ externalId: externalIds.externalId })
        .from(externalIds)
        .where(
          and(
            eq(externalIds.entityType, 'show'),
            eq(externalIds.entityId, show.id),
            eq(externalIds.source, 'tvdb'),
          ),
        )
        .limit(1)
      if (tvdbExternalId) {
        try {
          const tvdbSeason = await tvdbProvider.getSeason(
            tvdbExternalId.externalId,
            seasonNumber,
            user.locale,
          )
          tvdbSeasonId = tvdbSeason.externalId
          for (const episode of tvdbSeason.episodes) {
            if (episode.externalId)
              tvdbEpisodeIdByNumber.set(episode.episodeNumber, episode.externalId)
          }
        } catch {
          // Network hiccup or no matching season on TVDB's side — leave
          // both maps empty rather than failing the whole page over a
          // supplementary link.
        }
      }
    }

    const {
      overview: seasonOverview,
      voteAverage: seasonVoteAverage,
      episodes: providerEpisodes,
    } = await target.provider.getSeason(target.externalId, seasonNumber, user.locale)

    // Scoped to the current user in the join condition (not a WHERE
    // clause) so an episode with no plays from this user still gets a row
    // — same reasoning as the droppedShows join in the gallery query
    // above.
    const watchRows = await db
      .select({
        episodeNumber: episodes.episodeNumber,
        watchedCount: sql<number>`count(${plays.id})`.mapWith(Number),
        lastWatchedAt: sql<string | null>`max(${plays.watchedAt})`,
        // Same "extract the year" check the show route's hasUnknownWatchDate
        // uses above — cheaper than an exact-timestamp comparison and just
        // as correct, since nothing else is ever dated in 1900.
        hasUnknownWatch: sql<boolean>`coalesce(bool_or(extract(year from ${plays.watchedAt}) = 1900), false)`,
      })
      .from(episodes)
      .leftJoin(plays, and(eq(plays.episodeId, episodes.id), eq(plays.userId, user.id)))
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
      .groupBy(episodes.episodeNumber)

    const watchedByEpisode = new Map(watchRows.map((row) => [row.episodeNumber, row]))

    return c.json({
      seasonNumber: seasonRow.seasonNumber,
      name: seasonRow.name,
      // Live from the provider, not cached locally — same reasoning as the
      // episode list itself (see this route's doc comment above).
      overview: seasonOverview,
      // Also live from the provider on every request, same reasoning as
      // `overview` — see showDetailSchema's `voteAverage` doc comment for
      // the zero-votes convention (season responses carry no vote_count to
      // disambiguate, so a genuine 0 and "unrated" are indistinguishable —
      // treated as unrated).
      voteAverage: seasonVoteAverage,
      posterPath: seasonRow.posterPath,
      airDate: seasonRow.airDate,
      episodes: providerEpisodes
        .slice()
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((episode) => {
          // Absent entirely (not just zero) when the episode has never been
          // logged locally at all — resolveEpisode only ever creates a row
          // on the first watch.
          const watch = watchedByEpisode.get(episode.episodeNumber)
          const watchedCount = watch?.watchedCount ?? 0
          return {
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            stillPath: episode.stillPath,
            runtimeMinutes: episode.runtimeMinutes,
            firstAired: episode.firstAired,
            watched: watchedCount > 0,
            watchedCount,
            lastWatchedAt: watch?.lastWatchedAt
              ? new Date(watch.lastWatchedAt).toISOString()
              : null,
            hasUnknownWatch: watch?.hasUnknownWatch ?? false,
            voteAverage: episode.voteAverage,
            tvdbEpisodeId: tvdbEpisodeIdByNumber.get(episode.episodeNumber) ?? null,
          }
        }),
      tvdbSeasonId,
    })
  },
)

/**
 * Every one of the current user's individual watches for one episode,
 * newest first — backs the "are you sure?" confirmation shown before the
 * DELETE route below, which lets the user tick which of these to remove
 * (UnwatchConfirmDialog.tsx). Fetched on demand only when that
 * confirmation dialog opens, not part of the season list response above —
 * see watchesSchema's doc comment.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "List the current user's individual watches for one episode",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
    },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: watchesSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // No local episode row at all means it's never been logged — nothing
    // to list, same "harmless empty result" precedent as the DELETE route
    // below's no-op.
    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
          eq(episodes.episodeNumber, episodeNumber),
        ),
      )
      .limit(1)
    if (!episodeRow) return c.json({ watches: [] })

    // Tie-broken by id, not just watchedAt — two rewatches can share the
    // exact same timestamp (e.g. Trakt's 1900-01-01 "unknown date"
    // sentinel is common across several plays), and ORDER BY watchedAt
    // alone gives Postgres no guarantee of returning ties in the same
    // relative order on a later call. UnwatchConfirmDialog.tsx relies on
    // this list being stable across repeated fetches of the same data —
    // an unstable order looks like "the list changed" to it.
    const rows = await db
      .select({ id: plays.id, watchedAt: plays.watchedAt })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({ id: row.id, watchedAt: row.watchedAt.toISOString() })),
    })
  },
)

/**
 * Un-watch an episode (apps/web/src/routes/SeasonDetailPage.tsx) — clears
 * the current user's logged plays named in the request body, not
 * necessarily every one of them (UnwatchConfirmDialog.tsx lets the user
 * tick individual watches; "remove all" is just every id ticked, not a
 * separate mode). `ids` is scoped to this episode/user in the WHERE clause
 * below regardless of what the caller sends — a stray id for a different
 * episode or another user's play can't be deleted through this route.
 * Individual watch events for a rewatched episode otherwise stay
 * manageable on the History page instead of here.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/episodes/{episodeNumber}/plays',
    summary: "Remove some or all of the current user's watches for one episode",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({
        slug: z.string(),
        seasonNumber: z.coerce.number().int().min(0),
        episodeNumber: z.coerce.number().int().min(1),
      }),
      body: { content: { 'application/json': { schema: removeWatchesRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Episode watch status',
        content: { 'application/json': { schema: watchedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber, episodeNumber } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // A no-op if this episode was never logged locally at all — nothing to
    // clear, same "harmless no-op" precedent as undropping a never-dropped
    // show above.
    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.seasonNumber, seasonNumber),
          eq(episodes.episodeNumber, episodeNumber),
        ),
      )
      .limit(1)

    if (episodeRow) {
      await db
        .delete(plays)
        .where(
          and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id), inArray(plays.id, ids)),
        )
    }

    const remaining = episodeRow
      ? await db
          .select({ watchedAt: plays.watchedAt })
          .from(plays)
          .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeRow.id)))
          .orderBy(desc(plays.watchedAt), asc(plays.id))
      : []

    return c.json({
      watched: remaining.length > 0,
      watchedCount: remaining.length,
      lastWatchedAt: remaining[0] ? remaining[0].watchedAt.toISOString() : null,
    })
  },
)

/**
 * The season page's "Watched" button (apps/web/src/routes/SeasonDetailPage.tsx)
 * — the season-scoped equivalent of the show page's own "Watched" button
 * above. Logs one new play for every episode of this one season (specials
 * included, unlike the show-level route — a season *is* the unit here, so
 * there's no "exclude specials" question) that isn't already watched — see
 * logMissingWatches's doc comment for the watchedAt/useReleaseDate choice.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: 'Log a new watch for every episode of one season',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
      body: { content: { 'application/json': { schema: markShowWatchedRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Watches logged',
        content: { 'application/json': { schema: markShowWatchedResponseSchema } },
      },
      400: { description: 'watchedAt is in the future' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const body = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    // Same backstop as POST /plays — a client-picked "Other date" is
    // already clamped to "now" (WatchDateDialog.tsx), but nothing here
    // trusts that a client did its job.
    if (body.watchedAt && new Date(body.watchedAt).getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Same "any configured provider, not just the primary" reasoning as
    // the season detail route above.
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveSeasonEpisodes(
      db,
      target.provider,
      target.externalId,
      seasonNumber,
      user.locale,
    )

    const count = await logMissingWatches(db, user.id, resolvedEpisodes, body)
    return c.json({ count }, 201)
  },
)

/**
 * Clicking the season page's "Watched" button again once it's already
 * showing every episode of the season watched opens a "remove all
 * watches?" confirmation instead — the season-scoped equivalent of the
 * show page's own remove-all-watches route above. Only ever touches
 * locally-known episode rows, same reasoning as that route.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/seasons/{seasonNumber}/watched',
    summary: "Remove every one of the current user's watches for one season",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string(), seasonNumber: z.coerce.number().int().min(0) }),
    },
    responses: {
      200: {
        description: 'Watches removed',
        content: { 'application/json': { schema: removeShowWatchesResponseSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug, seasonNumber } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, seasonNumber)))
    const episodeIds = episodeRows.map((row) => row.id)

    let count = 0
    if (episodeIds.length > 0) {
      const removed = await db
        .delete(plays)
        .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        .returning({ id: plays.id })
      count = removed.length
    }

    return c.json({ count })
  },
)

/**
 * Manual drop/undrop toggle (apps/web/src/routes/ShowDetailPage.tsx) — the
 * in-app counterpart to importing Trakt's own "Dropped" list
 * (apps/api/src/import/trakt.ts). Returns just `droppedStatusSchema`
 * (dropped + droppedAt), not the full show detail: the frontend patches
 * those two fields into its already-cached ShowDetail rather than
 * refetching, so this route doesn't need to rebuild seasons/watched counts
 * just to toggle a boolean.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/dropped',
    summary: 'Mark a show as dropped for the current user',
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show marked as dropped',
        content: { 'application/json': { schema: droppedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // manualDropped is only an *override* — if Trakt's own state for this
    // show is already "dropped", there's nothing to override, so it's left
    // (or cleared back to) null rather than pinned to true forever. See
    // droppedShows's doc comment in packages/db/src/schema.ts.
    const manualDroppedAt = new Date()
    const [row] = await db
      .insert(droppedShows)
      .values({
        userId,
        showId: show.id,
        traktDropped: null,
        traktDroppedAt: null,
        manualDropped: true,
        manualDroppedAt,
      })
      .onConflictDoUpdate({
        target: [droppedShows.userId, droppedShows.showId],
        set: {
          manualDropped: sql`case when ${droppedShows.traktDropped} = true then null else true end`,
          manualDroppedAt: sql`case when ${droppedShows.traktDropped} = true then null else ${manualDroppedAt.toISOString()}::timestamptz end`,
        },
      })
      .returning({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })

    const dropped = row!.manualDropped ?? row!.traktDropped ?? false
    const droppedAt = row!.manualDropped != null ? row!.manualDroppedAt : row!.traktDroppedAt
    return c.json({ dropped, droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null })
  },
)

libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/dropped',
    summary: 'Un-drop a show for the current user',
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Show no longer marked as dropped',
        content: { 'application/json': { schema: droppedStatusSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // A no-op (0 rows affected) if the show was never dropped in the first
    // place — nothing to undo, no row worth creating. Otherwise, same
    // override-vs-clear logic as the drop route above: manualDropped only
    // needs to record `false` while Trakt still disagrees (still thinks
    // this show is dropped); once Trakt agrees it isn't, the override
    // clears back to null rather than staying pinned to false forever.
    const manualDroppedAt = new Date()
    const [row] = await db
      .update(droppedShows)
      .set({
        manualDropped: sql`case when ${droppedShows.traktDropped} = true then false else null end`,
        manualDroppedAt: sql`case when ${droppedShows.traktDropped} = true then ${manualDroppedAt.toISOString()}::timestamptz else null end`,
      })
      .where(and(eq(droppedShows.userId, userId), eq(droppedShows.showId, show.id)))
      .returning({
        traktDropped: droppedShows.traktDropped,
        traktDroppedAt: droppedShows.traktDroppedAt,
        manualDropped: droppedShows.manualDropped,
        manualDroppedAt: droppedShows.manualDroppedAt,
      })

    if (!row) return c.json({ dropped: false, droppedAt: null })

    const dropped = row.manualDropped ?? row.traktDropped ?? false
    const droppedAt = row.manualDropped != null ? row.manualDroppedAt : row.traktDroppedAt
    return c.json({ dropped, droppedAt: dropped && droppedAt ? droppedAt.toISOString() : null })
  },
)

/**
 * The show page's "Watched" button (apps/web/src/routes/ShowDetailPage.tsx)
 * — the show-level equivalent of marking one episode watched from the
 * season grid. Logs one new play for every non-special episode that isn't
 * already watched — see logMissingWatches's doc comment for the
 * watchedAt/useReleaseDate choice. Episodes not yet resolved locally are
 * created from the provider first — see resolveShowEpisodes's doc comment
 * (apps/api/src/lib/media.ts) for why that's one call per season rather
 * than per episode.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/shows/{slug}/watched',
    summary: 'Log a new watch for every non-special episode of a show',
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: markShowWatchedRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Watches logged',
        content: { 'application/json': { schema: markShowWatchedResponseSchema } },
      },
      400: { description: 'watchedAt is in the future' },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const body = c.req.valid('json')
    const user = c.get('user')!
    const db = c.get('db')
    const providers = await orderedProviders(db, c.get('metadataProviders'))

    // Same backstop as POST /plays — a client-picked "Other date" is
    // already clamped to "now" (WatchDateDialog.tsx), but nothing here
    // trusts that a client did its job.
    if (body.watchedAt && new Date(body.watchedAt).getTime() > Date.now()) {
      return c.json({ error: 'watchedAt cannot be in the future' }, 400)
    }

    const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    // Same "any configured provider, not just the primary" reasoning as
    // the season detail route above — without an id from *some* provider
    // there's nothing to resolve episodes from.
    const target = await pickRefreshTarget(db, 'show', show.id, providers)
    if (!target) return c.json({ error: 'Show not found' }, 404)

    const resolvedEpisodes = await resolveShowEpisodes(
      db,
      target.provider,
      target.externalId,
      user.locale,
    )

    const count = await logMissingWatches(db, user.id, resolvedEpisodes, body)
    return c.json({ count }, 201)
  },
)

/**
 * Clicking the "Watched" button again once it's already showing every
 * non-special episode watched (see ShowDetailPage.tsx) opens a "remove all
 * watches?" confirmation instead of the watch-date dialog — this is what it
 * calls. Removes every play the current user has logged against a
 * non-special episode of the show. Only ever touches locally-known episode
 * rows (a play can't reference an episode that doesn't have one), so unlike
 * the POST route above there's nothing to resolve from the provider.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/shows/{slug}/watched',
    summary: "Remove every one of the current user's watches for a show (specials excluded)",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Watches removed',
        content: { 'application/json': { schema: removeShowWatchesResponseSchema } },
      },
      404: { description: 'Show not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [show] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.slug, slug))
      .limit(1)
    if (!show) return c.json({ error: 'Show not found' }, 404)

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), gt(episodes.seasonNumber, 0)))
    const episodeIds = episodeRows.map((row) => row.id)

    let count = 0
    if (episodeIds.length > 0) {
      const removed = await db
        .delete(plays)
        .where(and(eq(plays.userId, userId), inArray(plays.episodeId, episodeIds)))
        .returning({ id: plays.id })
      count = removed.length
    }

    return c.json({ count })
  },
)

/** Backs the Movies gallery (apps/web/src/routes/MoviesPage.tsx). Only one
 * aggregate is needed — there's no second table to fan out against — so
 * this doesn't need the CTE split the shows query does. */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies',
    summary: 'List every movie the current user has watched, with play count',
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: 'Movies library',
        content: { 'application/json': { schema: listLibraryMoviesResponseSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('user')!.id
    const db = c.get('db')

    const rows = await db
      .select({
        id: movies.id,
        slug: movies.slug,
        title: movies.title,
        year: movies.year,
        posterPath: movies.posterPath,
        genres: movies.genres,
        voteAverage: movies.voteAverage,
        playCount: sql<number>`count(${plays.id})`.mapWith(Number).as('play_count'),
        lastWatchedAt: sql`max(${plays.watchedAt})`
          .mapWith((v: string) => new Date(v))
          .as('last_watched_at'),
      })
      .from(plays)
      .innerJoin(movies, eq(plays.movieId, movies.id))
      .where(eq(plays.userId, userId))
      .groupBy(movies.id)
      .orderBy(asc(movies.title))

    return c.json({
      movies: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        year: row.year,
        posterPath: row.posterPath,
        genres: row.genres,
        voteAverage: row.voteAverage,
        playCount: row.playCount,
        lastWatchedAt: row.lastWatchedAt.toISOString(),
      })),
    })
  },
)

/**
 * Backs the per-movie page (apps/web/src/routes/MovieDetailPage.tsx),
 * linked to from the movies gallery, Dashboard search, and History. Same
 * "not scoped to this user's watches" reasoning as GET /library/shows/
 * {slug} above — the movie itself is shared metadata, any authenticated
 * user can look up any movie that exists locally, only the watch fields
 * below are scoped to the current user.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies/{slug}',
    summary: "Get a movie, with the current user's watch status",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Movie detail',
        content: { 'application/json': { schema: movieDetailSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [movie] = await db.select().from(movies).where(eq(movies.slug, slug)).limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    // Backs the TMDB rating badge's link to the movie's TMDB page — same
    // convention as the show route's tmdbExternalId lookup above.
    const [tmdbExternalId] = await db
      .select({ externalId: externalIds.externalId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, 'movie'),
          eq(externalIds.entityId, movie.id),
          eq(externalIds.source, 'tmdb'),
        ),
      )
      .limit(1)

    // Backs the TVDB link — same convention as the show route's own
    // tvdbExternalId query.
    const [tvdbExternalId] = await db
      .select({ externalId: externalIds.externalId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.entityType, 'movie'),
          eq(externalIds.entityId, movie.id),
          eq(externalIds.source, 'tvdb'),
        ),
      )
      .limit(1)

    // Same 1900-01-01 Trakt-sentinel exclusion as the show route's
    // watchedRange query above — see that query's doc comment.
    const [watchedRange] = await db
      .select({
        watchedCount: sql<number>`count(*)`.mapWith(Number),
        firstWatchedAt: sql<
          string | null
        >`min(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        lastWatchedAt: sql<
          string | null
        >`max(${plays.watchedAt}) FILTER (WHERE extract(year from ${plays.watchedAt}) <> 1900)`,
        hasUnknownWatchDate: sql<boolean>`coalesce(bool_or(extract(year from ${plays.watchedAt}) = 1900), false)`,
      })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))

    return c.json({
      id: movie.id,
      slug: movie.slug,
      title: movie.title,
      year: movie.year,
      runtimeMinutes: movie.runtimeMinutes,
      overview: movie.overview,
      posterPath: movie.posterPath,
      genres: movie.genres,
      voteAverage: movie.voteAverage,
      tmdbId: tmdbExternalId?.externalId ?? null,
      tvdbId: tvdbExternalId?.externalId ?? null,
      metadataSource:
        movie.metadataSource && isProviderSource(movie.metadataSource)
          ? movie.metadataSource
          : null,
      metadataRefreshedAt: movie.metadataRefreshedAt.toISOString(),
      watched: (watchedRange?.watchedCount ?? 0) > 0,
      watchedCount: watchedRange?.watchedCount ?? 0,
      firstWatchedAt: watchedRange?.firstWatchedAt
        ? new Date(watchedRange.firstWatchedAt).toISOString()
        : null,
      lastWatchedAt: watchedRange?.lastWatchedAt
        ? new Date(watchedRange.lastWatchedAt).toISOString()
        : null,
      hasUnknownWatchDate: watchedRange?.hasUnknownWatchDate ?? false,
    })
  },
)

/**
 * Manual "refresh metadata" button (MovieDetailPage.tsx) — movie
 * counterpart of POST /library/shows/{slug}/refresh above. Same reasoning
 * and same "no response body, refetch the detail route instead" shape.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/library/movies/{slug}/refresh',
    summary: "Refresh a movie's cached metadata from the provider now",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      204: { description: 'Refreshed' },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const user = c.get('user')!
    const db = c.get('db')

    const [movie] = await db.select().from(movies).where(eq(movies.slug, slug)).limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    const ordered = await orderedProviders(db, c.get('metadataProviders'))
    const target = await pickRefreshTarget(db, 'movie', movie.id, ordered)
    // Same reasoning as the show refresh route above.
    if (!target) return c.json({ error: 'Movie not found' }, 404)

    await refreshOneMovie(
      db,
      target.provider,
      { id: movie.id, externalId: target.externalId },
      user.locale,
    )
    return c.body(null, 204)
  },
)

/**
 * Every one of the current user's individual watches for one movie, newest
 * first — movie counterpart of the episode plays-list route above. Same
 * "fetched on demand only when the unwatch confirmation dialog opens"
 * reasoning — see watchesSchema's doc comment.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/movies/{slug}/plays',
    summary: "List the current user's individual watches for one movie",
    middleware: [requireAuth] as const,
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: 'Watches, newest first',
        content: { 'application/json': { schema: watchesSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [movie] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, slug))
      .limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    // Same tie-break-by-id reasoning as the episode plays-list route above
    // — UnwatchConfirmDialog.tsx relies on this list being stable across
    // repeated fetches of the same data.
    const rows = await db
      .select({ id: plays.id, watchedAt: plays.watchedAt })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watches: rows.map((row) => ({ id: row.id, watchedAt: row.watchedAt.toISOString() })),
    })
  },
)

/**
 * Un-watch a movie (MovieDetailPage.tsx) — movie counterpart of the episode
 * plays DELETE route above. Same "scoped to this movie/user regardless of
 * what the caller sends" safety and same UnwatchConfirmDialog.tsx ticking
 * behaviour.
 */
libraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/library/movies/{slug}/plays',
    summary: "Remove some or all of the current user's watches for one movie",
    middleware: [requireAuth] as const,
    request: {
      params: z.object({ slug: z.string() }),
      body: { content: { 'application/json': { schema: removeWatchesRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Movie watch status',
        content: { 'application/json': { schema: watchedStatusSchema } },
      },
      404: { description: 'Movie not found' },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param')
    const { ids } = c.req.valid('json')
    const userId = c.get('user')!.id
    const db = c.get('db')

    const [movie] = await db
      .select({ id: movies.id })
      .from(movies)
      .where(eq(movies.slug, slug))
      .limit(1)
    if (!movie) return c.json({ error: 'Movie not found' }, 404)

    await db
      .delete(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id), inArray(plays.id, ids)))

    const remaining = await db
      .select({ watchedAt: plays.watchedAt })
      .from(plays)
      .where(and(eq(plays.userId, userId), eq(plays.movieId, movie.id)))
      .orderBy(desc(plays.watchedAt), asc(plays.id))

    return c.json({
      watched: remaining.length > 0,
      watchedCount: remaining.length,
      lastWatchedAt: remaining[0] ? remaining[0].watchedAt.toISOString() : null,
    })
  },
)
