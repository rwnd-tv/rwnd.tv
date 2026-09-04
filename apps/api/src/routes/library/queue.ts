import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { onDeckResponseSchema, upNextResponseSchema } from '@rwnd/shared'
import type { Database } from '@rwnd/db'
import type { AppEnv } from '../../types.js'
import type { MetadataProvider } from '../../providers/types.js'
import { findNextAiringEpisode, findNextUnwatchedEpisode } from '../../lib/media.js'
import {
  type FollowedShow,
  getFollowedShows,
  getRecentlyWatchedShows,
} from '../../lib/followed-shows.js'
import { pickRefreshTargets } from '../../metadata/refresh.js'
import { orderedProviders } from '../../providers/priority.js'

export const queueRoutes = new OpenAPIHono<AppEnv>()

/** Cap on how many cards the Dashboard's On Deck and Up Next rows show
 * (James, 2026-08-24) — applied after sorting, so it's always the 8
 * most-relevant-by-that-row's-own-ordering, not an arbitrary 8. */
const DASHBOARD_ROW_LIMIT = 8

interface RecentlyWatchedCandidate extends FollowedShow {
  /** Whichever configured provider actually has a recorded id for this
   * show (priority order — pickRefreshTargets), paired with that id. Not
   * necessarily the same provider for every candidate: a show resolved
   * via TVDB (no `tmdb` external_ids row at all) still belongs here, it
   * just needs episode/season lookups sent to TVDB instead of TMDB. */
  provider: MetadataProvider
  providerExternalId: string
}

/**
 * The provider-resolution half of what used to be one function per
 * candidate source here (see lib/followed-shows.ts for the other half,
 * "which shows does this user follow" — extracted so the calendar feed
 * can reuse that half without this one, since it never does a live
 * provider fetch). Drops any show with no id from *any* configured
 * provider — nothing can be looked up for those. One bulk query, not one
 * per show, same reasoning as the background refresher's own bulk lookup.
 */
async function hydrateProviderTargets(
  db: Database,
  shows: FollowedShow[],
  providers: MetadataProvider[],
): Promise<RecentlyWatchedCandidate[]> {
  const targets = await pickRefreshTargets(
    db,
    'show',
    shows.map((show) => show.id),
    providers,
  )
  return shows.flatMap((show) => {
    const target = targets.get(show.id)
    if (!target) return []
    return [{ ...show, provider: target.provider, providerExternalId: target.externalId }]
  })
}

/**
 * Backs the Dashboard's On Deck row (apps/web/src/routes/DashboardPage.tsx)
 * — one card per recently-watched, non-dropped show that hasn't finished,
 * each pointing at the next episode the viewer hasn't seen yet, sorted by
 * that episode's air date (oldest first — see the sort below).
 * findNextUnwatchedEpisode resolves each candidate's next episode from
 * whichever provider actually knows that show (hydrateProviderTargets'
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

    const candidates = await hydrateProviderTargets(
      db,
      await getRecentlyWatchedShows(db, user.id),
      providers,
    )

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
 * (James, 2026-08-27, when watchlisting was added): getFollowedShows
 * (lib/followed-shows.ts) does that merge, with the recently-watched
 * side's real maxWatchedSeason winning when both apply, since it lets
 * the scan below start further forward than a watchlisted-only
 * candidate's always-null one.
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

    const candidates = await hydrateProviderTargets(
      db,
      await getFollowedShows(db, user.id),
      providers,
    )

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
    // inherited from getRecentlyWatchedShows), the whole point of this
    // row is knowing what's coming up next, so it reads top-to-bottom as a
    // countdown rather than "what did I watch most recently".
    shownShows.sort((a, b) => a.firstAired.localeCompare(b.firstAired))

    return c.json({ shows: shownShows.slice(0, DASHBOARD_ROW_LIMIT) })
  },
)
