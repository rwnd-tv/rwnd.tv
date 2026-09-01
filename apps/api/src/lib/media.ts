import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, plays, seasons, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { generateUniqueMovieSlug, generateUniqueShowSlug } from './slug.js'

/** TMDB frequently has no episode title yet for very recent/unaired episodes. */
export function episodeDisplayTitle(
  title: string | null,
  seasonNumber: number | undefined,
  episodeNumber: number | undefined,
): string {
  return title ?? `S${seasonNumber} E${episodeNumber}`
}

/**
 * Shared `external_ids` upsert for a secondary id discovered alongside an
 * entity's primary provider id — today, always an `imdb` id found via
 * TMDB. `correct: false` (create paths below) bare no-ops on conflict:
 * there's nothing to correct on a row being created for the first time,
 * and it sidesteps a cross-entity unique violation entirely (see the
 * `correct: true` branch's comment). `correct: true` (refresh paths in
 * apps/api/src/metadata/refresh.ts) actively overwrites a stale id — worth
 * it because every *existing* imdb row today came from Trakt/Plex, a
 * lower-quality source than TMDB, and a silent no-op here would make the
 * manual "refresh metadata" button unable to ever fix a wrong one.
 */
export async function upsertExternalId(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
  source: 'tmdb' | 'tvdb' | 'imdb',
  externalId: string,
  { correct }: { correct: boolean },
): Promise<void> {
  if (!correct) {
    await db
      .insert(externalIds)
      .values({ entityType, entityId, source, externalId })
      .onConflictDoNothing()
    return
  }
  try {
    // external_ids carries a SECOND unique index besides the one this
    // targets — (entity_type, source, external_id) — which
    // onConflictDoUpdate can't also target. If this source's id already
    // points at a *different* entity, the insert throws a raw Postgres
    // unique violation instead of updating. Logged, not rethrown: we can't
    // tell which entity is actually right, and one bad id must not abort
    // an entire refresh pass.
    await db
      .insert(externalIds)
      .values({ entityType, entityId, source, externalId })
      .onConflictDoUpdate({
        target: [externalIds.entityType, externalIds.entityId, externalIds.source],
        set: { externalId: sql`excluded.external_id` },
      })
  } catch (err) {
    console.error(`upsertExternalId: ${entityType} ${entityId} ${source} conflict:`, err)
  }
}

/**
 * Finds the local row already mapped to (entityType, source, externalId), or
 * creates one by fetching from the provider. This is the join point between
 * provider-sourced search results and rwnd.tv's own IDs, and the mechanism
 * M2's Trakt importer will reuse to match imported history against existing
 * records instead of duplicating them.
 */
export async function resolveMovie(
  db: Database,
  provider: MetadataProvider,
  externalId: string,
  locale: string,
): Promise<{ id: string; slug: string; title: string; posterPath: string | null }> {
  const [existing] = await db
    .select({ id: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, 'movie'),
        eq(externalIds.source, provider.source),
        eq(externalIds.externalId, externalId),
      ),
    )
    .limit(1)

  if (existing) {
    const [movie] = await db.select().from(movies).where(eq(movies.id, existing.id)).limit(1)
    if (movie)
      return { id: movie.id, slug: movie.slug, title: movie.title, posterPath: movie.posterPath }
  }

  const fetched = await provider.getMovie(externalId, locale)
  const slug = await generateUniqueMovieSlug(db, fetched.title, fetched.year)
  const [movie] = await db
    .insert(movies)
    .values({
      title: fetched.title,
      slug,
      year: fetched.year,
      runtimeMinutes: fetched.runtimeMinutes,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
      genres: fetched.genres,
      voteAverage: fetched.voteAverage,
      metadataSource: provider.source,
    })
    .returning()
  if (!movie) throw new Error('Failed to insert movie')

  await db
    .insert(externalIds)
    .values({
      entityType: 'movie',
      entityId: movie.id,
      source: provider.source,
      externalId,
    })
    .onConflictDoNothing()

  // Free IMDb id for the "View on IMDb" deep link — TMDB returns this in
  // the same request getMovie() already made above.
  if (fetched.imdbId) {
    await upsertExternalId(db, 'movie', movie.id, 'imdb', fetched.imdbId, { correct: false })
  }

  return { id: movie.id, slug: movie.slug, title: movie.title, posterPath: movie.posterPath }
}

/**
 * Exported for apps/api/src/import/match.ts, which needs to resolve a show
 * on its own (for a Trakt rating/watchlist entry of type 'show') as well as
 * before resolving individual episodes.
 */
async function lookupShowByExternalId(
  db: Database,
  source: MetadataProvider['source'],
  externalId: string,
): Promise<{ id: string; title: string; slug: string; externalId: string } | null> {
  const [existing] = await db
    .select({ id: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, 'show'),
        eq(externalIds.source, source),
        eq(externalIds.externalId, externalId),
      ),
    )
    .limit(1)
  if (!existing) return null

  const [show] = await db.select().from(shows).where(eq(shows.id, existing.id)).limit(1)
  return show ? { id: show.id, title: show.title, slug: show.slug, externalId } : null
}

export async function resolveShow(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  locale: string,
): Promise<{ id: string; title: string; slug: string; externalId: string }> {
  const existingByInput = await lookupShowByExternalId(db, provider.source, showExternalId)
  if (existingByInput) return existingByInput

  const fetched = await provider.getShow(showExternalId, locale)
  // fetched.externalId, not showExternalId, is this show's real canonical id
  // from here on — they can differ when the provider had to redirect
  // (TvdbProvider.getShow's own episode-id fallback is the live-verified
  // case for this: showExternalId identified an episode, not this series).
  // Every downstream call (episode/season lookups, the external_ids row
  // below) must key off the corrected id, or they 404 against an id that
  // was never actually this show's own.
  const canonicalExternalId = fetched.externalId

  // The redirect above can land on a show already known locally under its
  // *own* id, just not under showExternalId (whatever other id it arrived
  // as). Without this check, the insert below creates a genuine duplicate
  // show — its own external_ids insert silently no-ops against the
  // original's existing row (external_ids_source_lookup_idx conflicts on
  // (entityType, source, externalId) alone), but nothing then stops
  // backfillExternalIdBundle (apps/api/src/lib/external-match.ts) from
  // giving that duplicate a *wrong* external_ids row of its own — the raw,
  // uncorrected id, since entity_id differs so no unique index blocks it.
  // Confirmed live 2026-08-24: two duplicate "Formula 1" shows created
  // this exact way, each missing the real tvdb id entirely.
  if (canonicalExternalId !== showExternalId) {
    const existingByCanonical = await lookupShowByExternalId(
      db,
      provider.source,
      canonicalExternalId,
    )
    if (existingByCanonical) return existingByCanonical
  }

  const slug = await generateUniqueShowSlug(db, fetched.title, fetched.year)
  const [show] = await db
    .insert(shows)
    .values({
      title: fetched.title,
      slug,
      year: fetched.year,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
      status: fetched.status,
      genres: fetched.genres,
      voteAverage: fetched.voteAverage,
      metadataSource: provider.source,
    })
    .returning()
  if (!show) throw new Error('Failed to insert show')

  await db
    .insert(externalIds)
    .values({
      entityType: 'show',
      entityId: show.id,
      source: provider.source,
      externalId: canonicalExternalId,
    })
    .onConflictDoNothing()

  // Free IMDb id for the "View on IMDb" deep link — see resolveMovie's own
  // comment above. resolveSeason below never gets one: getSeason() can't
  // supply per-episode ids, and there's no show-level id to piggyback on
  // for episodes.
  if (fetched.imdbId) {
    await upsertExternalId(db, 'show', show.id, 'imdb', fetched.imdbId, { correct: false })
  }

  // Store season/episode-count data the provider already returned for free —
  // saves the metadata refresher (apps/api/src/metadata/refresh.ts) an
  // otherwise-immediate re-fetch for every newly-resolved show.
  if (fetched.seasons.length > 0) {
    await db
      .insert(seasons)
      .values(
        fetched.seasons.map((season) => ({
          showId: show.id,
          seasonNumber: season.seasonNumber,
          name: season.name,
          episodeCount: season.episodeCount,
          airDate: season.airDate,
          posterPath: season.posterPath,
        })),
      )
      .onConflictDoNothing()
  }

  return { id: show.id, title: show.title, slug: show.slug, externalId: canonicalExternalId }
}

/** One episode resolved to a local row, with just the fields the "Watched"
 * button's release-date mode and findNextUnwatchedEpisode below need on top
 * of the id itself (see resolveShowEpisodes/resolveSeasonEpisodes below). */
export interface ResolvedEpisode {
  id: string
  episodeNumber: number
  firstAired: string | null
}

/**
 * Resolves every episode of one season to a local episode id, fetching the
 * season's full episode list from the provider in one call — the same
 * "one provider call per season, not per episode" shape as
 * apps/api/src/import/match.ts's matchEpisode. Shared by
 * resolveShowEpisodes (every non-special season), resolveSeasonEpisodes
 * (one season, specials included), and findNextUnwatchedEpisode below.
 */
export async function resolveSeason(
  db: Database,
  provider: MetadataProvider,
  showId: string,
  showExternalId: string,
  seasonNumber: number,
  locale: string,
): Promise<ResolvedEpisode[]> {
  // Writes no `imdb` external_ids rows, unlike resolveMovie/resolveShow/
  // resolveEpisode above — provider.getSeason() never populates an
  // episode's imdbId (see TmdbProvider.getSeason's own comment), so
  // there's nothing here to write. Per-episode IMDb ids are filled lazily
  // by apps/api/src/lib/episode-imdb.ts instead.
  const { episodes: seasonEpisodes } = await provider.getSeason(
    showExternalId,
    seasonNumber,
    locale,
  )
  if (seasonEpisodes.length > 0) {
    await db
      .insert(episodes)
      .values(
        seasonEpisodes.map((e) => ({
          showId,
          seasonNumber: e.seasonNumber,
          episodeNumber: e.episodeNumber,
          title: e.title,
          runtimeMinutes: e.runtimeMinutes,
          firstAired: e.firstAired,
        })),
      )
      .onConflictDoNothing()
  }
  return db
    .select({
      id: episodes.id,
      episodeNumber: episodes.episodeNumber,
      firstAired: episodes.firstAired,
    })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, seasonNumber)))
}

/**
 * Resolves every non-special (season > 0) episode of a show to a local
 * episode id. Used by the show page's "Watched" button
 * (apps/api/src/routes/library/shows.ts), where every episode needs a local row
 * regardless of whether it's ever been individually logged before.
 */
export async function resolveShowEpisodes(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  locale: string,
): Promise<ResolvedEpisode[]> {
  const show = await resolveShow(db, provider, showExternalId, locale)

  const seasonRows = await db
    .select({ seasonNumber: seasons.seasonNumber })
    .from(seasons)
    .where(and(eq(seasons.showId, show.id), gt(seasons.seasonNumber, 0)))

  const perSeason = await Promise.all(
    seasonRows.map(({ seasonNumber }) =>
      resolveSeason(db, provider, show.id, show.externalId, seasonNumber, locale),
    ),
  )

  return perSeason.flat()
}

/**
 * Resolves every episode of one season (specials included — unlike
 * resolveShowEpisodes, there's no whole-show "exclude specials" reasoning
 * at this scope) to a local episode id. Used by the season page's
 * "Watched" button (apps/api/src/routes/library/seasons.ts).
 */
export async function resolveSeasonEpisodes(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  seasonNumber: number,
  locale: string,
): Promise<ResolvedEpisode[]> {
  const show = await resolveShow(db, provider, showExternalId, locale)
  return resolveSeason(db, provider, show.id, show.externalId, seasonNumber, locale)
}

export interface NextEpisode {
  seasonNumber: number
  episodeNumber: number
  firstAired: string
}

/**
 * Shared scan behind findNextUnwatchedEpisode/findNextAiringEpisode below —
 * both walk seasons forward from `startSeasonNumber`, resolve each one
 * (skipping any the provider has nothing for), build the set of this
 * user's already-watched episode ids for that season, sort by episode
 * number, and return the first one `matches` accepts — stopping at the
 * first hit rather than resolving the whole show up front, so a many-
 * season show only costs a provider call per season near the caller's
 * actual progress. `matches` is the one thing that differs between the two
 * callers — see each's own doc comment for why its predicate looks the way
 * it does.
 */
async function scanSeasonsForEpisode(
  db: Database,
  provider: MetadataProvider,
  userId: string,
  showId: string,
  showExternalId: string,
  startSeasonNumber: number,
  locale: string,
  matches: (
    episode: ResolvedEpisode & { firstAired: string },
    seasonNumber: number,
    // Set<string | null>, not Set<string>: plays.episodeId (drizzle) is
    // nullable — a play can reference a movie instead — even though every
    // id actually landing in this particular set is a real episode id.
    watchedIds: Set<string | null>,
  ) => boolean,
): Promise<NextEpisode | null> {
  const seasonRows = await db
    .select({ seasonNumber: seasons.seasonNumber })
    .from(seasons)
    .where(and(eq(seasons.showId, showId), gte(seasons.seasonNumber, startSeasonNumber)))
    .orderBy(seasons.seasonNumber)

  for (const { seasonNumber } of seasonRows) {
    const resolved = await resolveSeason(db, provider, showId, showExternalId, seasonNumber, locale)
    if (resolved.length === 0) continue

    const watchedIds = new Set(
      (
        await db
          .select({ episodeId: plays.episodeId })
          .from(plays)
          .where(
            and(
              eq(plays.userId, userId),
              inArray(
                plays.episodeId,
                resolved.map((e) => e.id),
              ),
            ),
          )
      ).map((row) => row.episodeId),
    )

    const next = resolved
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .find((e): e is ResolvedEpisode & { firstAired: string } => {
        if (e.firstAired === null) return false
        return matches({ ...e, firstAired: e.firstAired }, seasonNumber, watchedIds)
      })
    if (next)
      return { seasonNumber, episodeNumber: next.episodeNumber, firstAired: next.firstAired }
  }
  return null
}

/**
 * The next episode a user should watch for a show they're partway
 * through — the earliest aired-but-unwatched episode from
 * `startSeasonNumber` onward (specials excluded, same convention
 * resolveShowEpisodes uses), or null if there isn't one (nothing new has
 * aired since they caught up). Powers the Dashboard's On Deck row
 * (apps/api/src/routes/library/queue.ts).
 *
 * `minEpisodeNumberInStartSeason` excludes an earlier, aired-but-unwatched
 * episode the viewer skipped over — a "gap" — from counting as the next
 * one, within `startSeasonNumber` only (every later season is already
 * guaranteed to be "after" it, since `startSeasonNumber` is by construction
 * the highest season with any watch at all — see
 * apps/api/src/routes/library/queue.ts's `maxWatchedSeason`). Pass null to
 * disable this and fall back to the plain "earliest unwatched" behaviour —
 * the user's own `onDeckFillGaps` preference (packages/db/src/schema.ts).
 */
export async function findNextUnwatchedEpisode(
  db: Database,
  provider: MetadataProvider,
  userId: string,
  showId: string,
  showExternalId: string,
  startSeasonNumber: number,
  locale: string,
  minEpisodeNumberInStartSeason: number | null,
): Promise<NextEpisode | null> {
  const now = new Date()
  return scanSeasonsForEpisode(
    db,
    provider,
    userId,
    showId,
    showExternalId,
    startSeasonNumber,
    locale,
    (episode, seasonNumber, watchedIds) => {
      const minEpisodeNumber =
        seasonNumber === startSeasonNumber ? (minEpisodeNumberInStartSeason ?? 0) : 0
      return (
        new Date(episode.firstAired) <= now &&
        !watchedIds.has(episode.id) &&
        episode.episodeNumber > minEpisodeNumber
      )
    },
  )
}

/**
 * The next *upcoming* (not yet available to watch) episode of a show a user
 * is following, from `startSeasonNumber` onward — or null if nothing's
 * scheduled yet. Powers the Dashboard's Up Next row
 * (apps/api/src/routes/library/queue.ts). Includes an episode airing *today*
 * (`firstAired` is date-only, with no time-of-day — see schema.ts — so
 * "today" is the earliest point the app can call an episode available at
 * all, same convention findNextUnwatchedEpisode/`POST /plays` already use
 * for the opposite question of what's loggable), which means, unlike a
 * strictly-future episode, it *can* already have a logged watch — so this
 * needs the same watched-status check findNextUnwatchedEpisode does, unlike
 * before this included today.
 */
export async function findNextAiringEpisode(
  db: Database,
  provider: MetadataProvider,
  userId: string,
  showId: string,
  showExternalId: string,
  startSeasonNumber: number,
  locale: string,
): Promise<NextEpisode | null> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return scanSeasonsForEpisode(
    db,
    provider,
    userId,
    showId,
    showExternalId,
    startSeasonNumber,
    locale,
    (episode, _seasonNumber, watchedIds) =>
      new Date(episode.firstAired) >= startOfToday && !watchedIds.has(episode.id),
  )
}

export async function resolveEpisode(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  seasonNumber: number,
  episodeNumber: number,
  locale: string,
): Promise<{
  id: string
  title: string | null
  posterPath: string | null
  showSlug: string
  showTitle: string
  seasonNumber: number
  episodeNumber: number
  firstAired: string | null
}> {
  const show = await resolveShow(db, provider, showExternalId, locale)

  const [existing] = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, show.id),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber),
      ),
    )
    .limit(1)

  if (existing) {
    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id)).limit(1)
    return {
      id: existing.id,
      title: existing.title,
      posterPath: showRow?.posterPath ?? null,
      showSlug: show.slug,
      showTitle: show.title,
      seasonNumber: existing.seasonNumber,
      episodeNumber: existing.episodeNumber,
      firstAired: existing.firstAired,
    }
  }

  const fetched = await provider.getEpisode(show.externalId, seasonNumber, episodeNumber, locale)
  const [episode] = await db
    .insert(episodes)
    .values({
      showId: show.id,
      seasonNumber: fetched.seasonNumber,
      episodeNumber: fetched.episodeNumber,
      title: fetched.title,
      runtimeMinutes: fetched.runtimeMinutes,
      firstAired: fetched.firstAired,
    })
    .returning()
  if (!episode) throw new Error('Failed to insert episode')

  await db
    .insert(externalIds)
    .values({
      entityType: 'episode',
      entityId: episode.id,
      source: provider.source,
      externalId: `${show.externalId}:${seasonNumber}:${episodeNumber}`,
    })
    .onConflictDoNothing()

  // Free IMDb id for the "View on IMDb" deep link, when this episode was
  // resolved via a real getEpisode() call (the branch above, not the
  // early-return for an already-known episode) — see resolveMovie's own
  // comment. This is a bonus write, not the episode-imdb route's only
  // source: routes/library/seasons.ts's dedicated .../imdb route (backed
  // by apps/api/src/lib/episode-imdb.ts) is what actually serves pages for
  // the far more common case where an episode row already exists without
  // ever having gone through this fetch path.
  if (fetched.imdbId) {
    await upsertExternalId(db, 'episode', episode.id, 'imdb', fetched.imdbId, { correct: false })
  }

  const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id)).limit(1)

  return {
    id: episode.id,
    title: episode.title,
    posterPath: showRow?.posterPath ?? null,
    showSlug: show.slug,
    showTitle: show.title,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    firstAired: episode.firstAired,
  }
}
