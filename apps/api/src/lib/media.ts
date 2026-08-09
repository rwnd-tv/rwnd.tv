import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'

/** TMDB frequently has no episode title yet for very recent/unaired episodes. */
export function episodeDisplayTitle(
  title: string | null,
  seasonNumber: number | undefined,
  episodeNumber: number | undefined,
): string {
  return title ?? `S${seasonNumber}E${episodeNumber}`
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

async function resolveShow(
  db: Database,
  provider: MetadataProvider,
  showExternalId: string,
  locale: string,
): Promise<{ id: string; title: string }> {
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
    if (show) return { id: show.id, title: show.title }
  }

  const fetched = await provider.getShow(showExternalId, locale)
  const [show] = await db
    .insert(shows)
    .values({
      title: fetched.title,
      year: fetched.year,
      overview: fetched.overview,
      posterPath: fetched.posterPath,
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

  return { id: show.id, title: show.title }
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
    showTitle: show.title,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
  }
}
