import { eq, inArray } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
  droppedShows,
  episodes,
  movies,
  plays,
  ratings,
  seasons,
  shows,
  watchlistItems,
} from '@rwnd/db'
import {
  BACKUP_FORMAT_VERSION,
  type BackupDroppedShow,
  type BackupFile,
  type BackupMovie,
  type BackupRating,
  type BackupShow,
  type BackupWatch,
  type BackupWatchlistItem,
  type ExternalRef,
} from '@rwnd/shared'
import type { MetadataProvider } from '../providers/types.js'
import { orderedProviders } from '../providers/priority.js'
import { pickRefreshTargets } from '../metadata/refresh.js'

/**
 * Snapshots one user's watch history/ratings/watchlist/dropped shows into
 * the portable file format packages/shared/src/schemas/backups.ts defines
 * — see that file's doc comment for why entries are keyed by a
 * provider-tagged ref rather than rwnd.tv's own row ids, and why the file
 * carries its own movie/show/season/episode metadata.
 */
export async function buildBackupFile(
  db: Database,
  userId: string,
  description: string,
  now: Date,
  providers: MetadataProvider[],
): Promise<BackupFile> {
  const [playRows, ratingRows, watchlistRows, droppedRows] = await Promise.all([
    db.select().from(plays).where(eq(plays.userId, userId)),
    db.select().from(ratings).where(eq(ratings.userId, userId)),
    db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)),
    db.select().from(droppedShows).where(eq(droppedShows.userId, userId)),
  ])

  // Every episode any of the four categories reference, resolved once —
  // gives showId + season/episode number for plays (which only carry
  // episodeId) and for episode-level ratings/watchlist entries.
  const episodeIds = new Set<string>()
  for (const row of playRows) if (row.episodeId) episodeIds.add(row.episodeId)
  for (const row of ratingRows) if (row.entityType === 'episode') episodeIds.add(row.entityId)
  for (const row of watchlistRows) if (row.entityType === 'episode') episodeIds.add(row.entityId)

  const episodeRows =
    episodeIds.size > 0
      ? await db
          .select()
          .from(episodes)
          .where(inArray(episodes.id, [...episodeIds]))
      : []
  const episodeById = new Map(episodeRows.map((row) => [row.id, row]))

  const movieIds = new Set<string>()
  for (const row of playRows) if (row.movieId) movieIds.add(row.movieId)
  for (const row of ratingRows) if (row.entityType === 'movie') movieIds.add(row.entityId)
  for (const row of watchlistRows) if (row.entityType === 'movie') movieIds.add(row.entityId)

  const showIds = new Set<string>()
  for (const row of droppedRows) showIds.add(row.showId)
  for (const row of ratingRows) if (row.entityType === 'show') showIds.add(row.entityId)
  for (const row of watchlistRows) if (row.entityType === 'show') showIds.add(row.entityId)
  for (const episode of episodeRows) showIds.add(episode.showId)

  const ordered = await orderedProviders(db, providers)

  const [movieRows, showRows, seasonRows, movieTargets, showTargets] = await Promise.all([
    movieIds.size > 0
      ? db
          .select()
          .from(movies)
          .where(inArray(movies.id, [...movieIds]))
      : [],
    showIds.size > 0
      ? db
          .select()
          .from(shows)
          .where(inArray(shows.id, [...showIds]))
      : [],
    showIds.size > 0
      ? db
          .select()
          .from(seasons)
          .where(inArray(seasons.showId, [...showIds]))
      : [],
    pickRefreshTargets(db, 'movie', [...movieIds], ordered),
    pickRefreshTargets(db, 'show', [...showIds], ordered),
  ])

  const movieRef = new Map<string, ExternalRef>(
    [...movieTargets].map(([entityId, target]) => [
      entityId,
      { source: target.provider.source, externalId: target.externalId },
    ]),
  )
  const showRef = new Map<string, ExternalRef>(
    [...showTargets].map(([entityId, target]) => [
      entityId,
      { source: target.provider.source, externalId: target.externalId },
    ]),
  )

  const seasonsByShow = new Map<string, typeof seasonRows>()
  for (const season of seasonRows) {
    const list = seasonsByShow.get(season.showId) ?? []
    list.push(season)
    seasonsByShow.set(season.showId, list)
  }
  const episodesByShow = new Map<string, typeof episodeRows>()
  for (const episode of episodeRows) {
    const list = episodesByShow.get(episode.showId) ?? []
    list.push(episode)
    episodesByShow.set(episode.showId, list)
  }

  let skipped = 0

  /** An episode ref resolved down to its show's provider ref + season/
   * episode number, or null if the episode is unknown or its show has no id
   * from any configured provider — same "can't be represented" case as a
   * movie/show with no external_ids row at all. */
  function episodeRef(
    episodeId: string,
  ): { show: ExternalRef; season: number; episode: number } | null {
    const episode = episodeById.get(episodeId)
    if (!episode) return null
    const showRefValue = showRef.get(episode.showId)
    if (!showRefValue) return null
    return { show: showRefValue, season: episode.seasonNumber, episode: episode.episodeNumber }
  }

  const watchHistory: BackupWatch[] = []
  for (const row of playRows) {
    if (row.movieId) {
      const movieRefValue = movieRef.get(row.movieId)
      if (!movieRefValue) {
        skipped++
        continue
      }
      watchHistory.push({
        movie: movieRefValue,
        watchedAt: row.watchedAt.toISOString(),
        source: row.source,
        sourceRef: row.sourceRef,
      })
    } else if (row.episodeId) {
      const ref = episodeRef(row.episodeId)
      if (!ref) {
        skipped++
        continue
      }
      watchHistory.push({
        ...ref,
        watchedAt: row.watchedAt.toISOString(),
        source: row.source,
        sourceRef: row.sourceRef,
      })
    }
  }

  const ratingEntries: BackupRating[] = []
  for (const row of ratingRows) {
    if (row.entityType === 'movie') {
      const movieRefValue = movieRef.get(row.entityId)
      if (!movieRefValue) {
        skipped++
        continue
      }
      ratingEntries.push({
        movie: movieRefValue,
        rating: row.rating,
        ratedAt: row.ratedAt.toISOString(),
      })
    } else if (row.entityType === 'show') {
      const showRefValue = showRef.get(row.entityId)
      if (!showRefValue) {
        skipped++
        continue
      }
      ratingEntries.push({
        show: showRefValue,
        rating: row.rating,
        ratedAt: row.ratedAt.toISOString(),
      })
    } else {
      const ref = episodeRef(row.entityId)
      if (!ref) {
        skipped++
        continue
      }
      ratingEntries.push({ ...ref, rating: row.rating, ratedAt: row.ratedAt.toISOString() })
    }
  }

  const watchlist: BackupWatchlistItem[] = []
  for (const row of watchlistRows) {
    if (row.entityType === 'movie') {
      const movieRefValue = movieRef.get(row.entityId)
      if (!movieRefValue) {
        skipped++
        continue
      }
      watchlist.push({
        movie: movieRefValue,
        listedAt: row.listedAt.toISOString(),
        notes: row.notes,
      })
    } else if (row.entityType === 'show') {
      const showRefValue = showRef.get(row.entityId)
      if (!showRefValue) {
        skipped++
        continue
      }
      watchlist.push({ show: showRefValue, listedAt: row.listedAt.toISOString(), notes: row.notes })
    } else {
      const ref = episodeRef(row.entityId)
      if (!ref) {
        skipped++
        continue
      }
      watchlist.push({ ...ref, listedAt: row.listedAt.toISOString(), notes: row.notes })
    }
  }

  const droppedShowEntries: BackupDroppedShow[] = []
  for (const row of droppedRows) {
    const showRefValue = showRef.get(row.showId)
    if (!showRefValue) {
      skipped++
      continue
    }
    droppedShowEntries.push({
      show: showRefValue,
      traktDropped: row.traktDropped,
      traktDroppedAt: row.traktDroppedAt?.toISOString() ?? null,
      manualDropped: row.manualDropped,
      manualDroppedAt: row.manualDroppedAt?.toISOString() ?? null,
    })
  }

  const movieEntries: BackupMovie[] = []
  for (const row of movieRows) {
    const movieRefValue = movieRef.get(row.id)
    if (!movieRefValue) continue // no external_ids row from any provider — can't be referenced above either, so already excluded there
    movieEntries.push({
      ref: movieRefValue,
      title: row.title,
      year: row.year,
      runtimeMinutes: row.runtimeMinutes,
      overview: row.overview,
      posterPath: row.posterPath,
    })
  }

  const showEntries: BackupShow[] = []
  for (const row of showRows) {
    const showRefValue = showRef.get(row.id)
    if (!showRefValue) continue
    showEntries.push({
      ref: showRefValue,
      slug: row.slug,
      title: row.title,
      year: row.year,
      overview: row.overview,
      posterPath: row.posterPath,
      status: row.status,
      genres: row.genres,
      voteAverage: row.voteAverage,
      seasons: (seasonsByShow.get(row.id) ?? []).map((season) => ({
        seasonNumber: season.seasonNumber,
        name: season.name,
        episodeCount: season.episodeCount,
        airDate: season.airDate,
        posterPath: season.posterPath,
      })),
      episodes: (episodesByShow.get(row.id) ?? []).map((episode) => ({
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        runtimeMinutes: episode.runtimeMinutes,
        firstAired: episode.firstAired,
      })),
    })
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    description,
    counts: {
      watchHistory: watchHistory.length,
      ratings: ratingEntries.length,
      watchlist: watchlist.length,
      droppedShows: droppedShowEntries.length,
    },
    skipped,
    movies: movieEntries,
    shows: showEntries,
    watchHistory,
    ratings: ratingEntries,
    watchlist,
    droppedShows: droppedShowEntries,
  }
}
