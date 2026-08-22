import { and, eq, gt } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, seasons, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { generateUniqueShowSlug } from './slug.js'

/** TMDB frequently has no episode title yet for very recent/unaired episodes. */
export function episodeDisplayTitle(
  title: string | null,
  seasonNumber: number | undefined,
  episodeNumber: number | undefined,
): string {
  return title ?? `S${seasonNumber} E${episodeNumber}`
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
): Promise<{ id: string; title: string; posterPath: string | null }> {
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
    if (movie) return { id: movie.id, title: movie.title, posterPath: movie.posterPath }
  }

  const fetched = await provider.getMovie(externalId, locale)
  const [movie] = await db
    .insert(movies)
    .values({
      title: fetched.title,
      year: fetched.year,
      runtimeMinutes: fetched.runtimeMinutes,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
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

  return { id: movie.id, title: movie.title, posterPath: movie.posterPath }
}

/**
 * Exported for apps/api/src/import/match.ts, which needs to resolve a show
 * on its own (for a Trakt rating/watchlist entry of type 'show') as well as
 * before resolving individual episodes.
 */
export async function resolveShow(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  locale: string,
): Promise<{ id: string; title: string; slug: string }> {
  const [existing] = await db
    .select({ id: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, 'show'),
        eq(externalIds.source, provider.source),
        eq(externalIds.externalId, showExternalId),
      ),
    )
    .limit(1)

  if (existing) {
    const [show] = await db.select().from(shows).where(eq(shows.id, existing.id)).limit(1)
    if (show) return { id: show.id, title: show.title, slug: show.slug }
  }

  const fetched = await provider.getShow(showExternalId, locale)
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
    })
    .returning()
  if (!show) throw new Error('Failed to insert show')

  await db
    .insert(externalIds)
    .values({
      entityType: 'show',
      entityId: show.id,
      source: provider.source,
      externalId: showExternalId,
    })
    .onConflictDoNothing()

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

  return { id: show.id, title: show.title, slug: show.slug }
}

/** One episode resolved to a local row, with just the fields the "Watched"
 * button's release-date mode needs on top of the id itself (see
 * resolveShowEpisodes/resolveSeasonEpisodes below). */
export interface ResolvedEpisode {
  id: string
  firstAired: string | null
}

/**
 * Resolves every episode of one season to a local episode id, fetching the
 * season's full episode list from the provider in one call — the same
 * "one provider call per season, not per episode" shape as
 * apps/api/src/import/match.ts's matchEpisode. Shared by
 * resolveShowEpisodes (every non-special season) and resolveSeasonEpisodes
 * (one season, specials included) below.
 */
async function resolveSeason(
  db: Database,
  provider: MetadataProvider,
  showId: string,
  showExternalId: string,
  seasonNumber: number,
  locale: string,
): Promise<ResolvedEpisode[]> {
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
    .select({ id: episodes.id, firstAired: episodes.firstAired })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, seasonNumber)))
}

/**
 * Resolves every non-special (season > 0) episode of a show to a local
 * episode id. Used by the show page's "Watched" button
 * (apps/api/src/routes/library.ts), where every episode needs a local row
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
      resolveSeason(db, provider, show.id, showExternalId, seasonNumber, locale),
    ),
  )

  return perSeason.flat()
}

/**
 * Resolves every episode of one season (specials included — unlike
 * resolveShowEpisodes, there's no whole-show "exclude specials" reasoning
 * at this scope) to a local episode id. Used by the season page's
 * "Watched" button (apps/api/src/routes/library.ts).
 */
export async function resolveSeasonEpisodes(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  seasonNumber: number,
  locale: string,
): Promise<ResolvedEpisode[]> {
  const show = await resolveShow(db, provider, showExternalId, locale)
  return resolveSeason(db, provider, show.id, showExternalId, seasonNumber, locale)
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
    }
  }

  const fetched = await provider.getEpisode(showExternalId, seasonNumber, episodeNumber, locale)
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
      externalId: `${showExternalId}:${seasonNumber}:${episodeNumber}`,
    })
    .onConflictDoNothing()

  const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id)).limit(1)

  return {
    id: episode.id,
    title: episode.title,
    posterPath: showRow?.posterPath ?? null,
    showSlug: show.slug,
    showTitle: show.title,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
  }
}
