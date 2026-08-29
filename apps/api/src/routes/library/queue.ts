import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { and, desc, eq, sql } from 'drizzle-orm'
import { onDeckResponseSchema, upNextResponseSchema } from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import { droppedShows, episodes, plays, shows, watchlistItems, watchlists } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import type { MetadataProvider } from '../../providers/types.js'
import { findNextAiringEpisode, findNextUnwatchedEpisode } from '../../lib/media.js'
import { pickRefreshTargets } from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'
import { watchedRangeFragments } from './shared.js'

export const queueRoutes = new OpenAPIHono<AppEnv>()

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
  // show page's own watchedRange query excludes it (watchedRangeFragments,
  // shared.ts).
  const recentWatch = db.$with('recent_watch').as(
    db
      .select({
        showId: episodes.showId,
        lastWatchedAt: watchedRangeFragments.lastWatchedAt
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
    // dropped-show CASE expression in shows.ts's dropped-toggle route.
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
 * Shows on any of the current user's watchlists, not dropped, with an id
 * from some configured provider — the Up Next row's second candidate
 * source below (getRecentlyWatchedCandidates above is the first), so a
 * watchlisted show still tells you when its next episode airs even with no
 * recent — or any — watch history. `maxWatchedSeason`/
 * `maxWatchedEpisodeInMaxSeason` are always null here (unlike a
 * recently-watched candidate, there's no "where the viewer got to" to
 * start from), which makes the Up Next route's existing `?? 1` fallback
 * scan from season 1 — findNextAiringEpisode already skips anything
 * already aired/watched as it scans forward, so starting from season 1
 * instead of a show's real last-watched season only costs a wider scan for
 * an old, already-watched-through show that's just been (re-)watchlisted,
 * never a wrong answer. Not restricted to the same
 * `DASHBOARD_ROW_WINDOW_DAYS` recency window `getRecentlyWatchedCandidates`
 * uses — a watchlisted show is an explicit, standing "I care about this",
 * not something that should fall out of the row after 30 days.
 */
async function getWatchlistedShowCandidates(
  db: Database,
  userId: string,
  providers: MetadataProvider[],
): Promise<RecentlyWatchedCandidate[]> {
  const rows = await db
    .selectDistinct({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      posterPath: shows.posterPath,
      // Null when this user has no droppedShows row at all for this show —
      // same join shape as getRecentlyWatchedCandidates above.
      traktDropped: droppedShows.traktDropped,
      manualDropped: droppedShows.manualDropped,
    })
    .from(watchlistItems)
    .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
    .innerJoin(shows, eq(watchlistItems.entityId, shows.id))
    .leftJoin(droppedShows, and(eq(droppedShows.showId, shows.id), eq(droppedShows.userId, userId)))
    .where(and(eq(watchlists.userId, userId), eq(watchlistItems.entityType, 'show')))

  const undropped = rows.filter((row) => !(row.manualDropped ?? row.traktDropped ?? false))
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
        maxWatchedSeason: null,
        maxWatchedEpisodeInMaxSeason: null,
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
queueRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/on-deck',
    summary: "The current user's On Deck row",
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
 * — one card per recently-watched or watchlisted, non-dropped show's next
 * *upcoming* episode (not yet aired), independent of On Deck above: a show
 * can be behind on already-aired episodes (On Deck) and still have
 * something upcoming (Up Next) at the same time, by design (James,
 * 2026-08-23) — they answer different questions, so neither excludes the
 * other. Two candidate sources, deduped by show id — a show can be both
 * recently watched and watchlisted at once, and shouldn't show up twice
 * (James, 2026-08-27, when watchlisting was added): getRecentlyWatchedCandidates'
 * real maxWatchedSeason wins when both apply, since it lets the scan below
 * start further forward than getWatchlistedShowCandidates' always-null one.
 */
queueRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/library/up-next',
    summary: "The current user's Up Next row",
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

    const recentlyWatched = await getRecentlyWatchedCandidates(db, user.id, providers)
    const watchlisted = await getWatchlistedShowCandidates(db, user.id, providers)
    const recentlyWatchedIds = new Set(recentlyWatched.map((candidate) => candidate.id))
    const candidates = [
      ...recentlyWatched,
      ...watchlisted.filter((candidate) => !recentlyWatchedIds.has(candidate.id)),
    ]

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
