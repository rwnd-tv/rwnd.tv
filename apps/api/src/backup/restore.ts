import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
  droppedShows,
  episodes,
  externalIds,
  movies,
  plays,
  ratings,
  seasons,
  shows,
  watchlistItems,
} from '@rwnd/db'
import type { BackupCounts, BackupFile } from '@rwnd/shared'
import { generateUniqueShowSlug } from '../lib/slug.js'

/** Postgres caps a single statement at 65535 bound parameters — chunking
 * keeps every insert well under that regardless of row width, and matches
 * the page size the Trakt importer already batches network calls by (see
 * PAGE_LIMIT in apps/api/src/import/trakt.ts). */
const CHUNK_SIZE = 1000

async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await insert(rows.slice(i, i + CHUNK_SIZE))
  }
}

/**
 * Wipes and rewrites one user's watch history/ratings/watchlist/dropped
 * shows from a backup file — no merge, matching Clear database's own
 * all-or-nothing semantics (apps/api/src/routes/account.ts). Runs in one
 * transaction so a failure partway through leaves the user's existing data
 * untouched rather than half-cleared.
 *
 * Any movie/show/episode the file references but this database doesn't
 * already know is created from the file's own metadata section, never
 * fetched from TMDB — see packages/shared/src/schemas/backups.ts's doc
 * comment for why that's possible without a provider call.
 */
export async function restoreBackupFile(
  db: Database,
  userId: string,
  file: BackupFile,
): Promise<BackupCounts> {
  return db.transaction(async (tx) => {
    // --- Resolve every referenced movie/show to a local id, creating rows
    // from the file's metadata when the tmdb id isn't already known here.
    const movieTmdbIds = file.movies.map((m) => m.tmdbId)
    const showTmdbIds = file.shows.map((s) => s.tmdbId)

    const [existingMovies, existingShows] = await Promise.all([
      movieTmdbIds.length > 0
        ? tx
            .select({ tmdbId: externalIds.externalId, id: externalIds.entityId })
            .from(externalIds)
            .where(
              and(
                eq(externalIds.entityType, 'movie'),
                eq(externalIds.source, 'tmdb'),
                inArray(externalIds.externalId, movieTmdbIds),
              ),
            )
        : [],
      showTmdbIds.length > 0
        ? tx
            .select({ tmdbId: externalIds.externalId, id: externalIds.entityId })
            .from(externalIds)
            .where(
              and(
                eq(externalIds.entityType, 'show'),
                eq(externalIds.source, 'tmdb'),
                inArray(externalIds.externalId, showTmdbIds),
              ),
            )
        : [],
    ])

    const movieIdByTmdbId = new Map(existingMovies.map((row) => [row.tmdbId, row.id]))
    const showIdByTmdbId = new Map(existingShows.map((row) => [row.tmdbId, row.id]))

    // Sequential, not parallel — generateUniqueShowSlug()'s uniqueness
    // check reads the `shows` table's current state, so two inserts
    // racing inside the same transaction could both compute the same slug.
    for (const movie of file.movies) {
      if (movieIdByTmdbId.has(movie.tmdbId)) continue
      const [inserted] = await tx
        .insert(movies)
        .values({
          title: movie.title,
          year: movie.year,
          runtimeMinutes: movie.runtimeMinutes,
          overview: movie.overview,
          posterPath: movie.posterPath,
        })
        .returning({ id: movies.id })
      if (!inserted) throw new Error(`Failed to insert movie ${movie.tmdbId}`)
      await tx
        .insert(externalIds)
        .values({
          entityType: 'movie',
          entityId: inserted.id,
          source: 'tmdb',
          externalId: movie.tmdbId,
        })
        .onConflictDoNothing()
      movieIdByTmdbId.set(movie.tmdbId, inserted.id)
    }

    // `${showId}:${seasonNumber}:${episodeNumber}` -> local episode id.
    const episodeIdByRef = new Map<string, string>()

    for (const show of file.shows) {
      let showId = showIdByTmdbId.get(show.tmdbId)
      if (!showId) {
        const slug = await generateUniqueShowSlug(tx, show.title, show.year)
        const [inserted] = await tx
          .insert(shows)
          .values({
            title: show.title,
            slug,
            year: show.year,
            overview: show.overview,
            posterPath: show.posterPath,
            status: show.status,
            genres: show.genres,
            voteAverage: show.voteAverage,
          })
          .returning({ id: shows.id })
        if (!inserted) throw new Error(`Failed to insert show ${show.tmdbId}`)
        showId = inserted.id
        await tx
          .insert(externalIds)
          .values({
            entityType: 'show',
            entityId: showId,
            source: 'tmdb',
            externalId: show.tmdbId,
          })
          .onConflictDoNothing()
        showIdByTmdbId.set(show.tmdbId, showId)

        if (show.seasons.length > 0) {
          // Rebound to a fresh const: `showId` above is a reassigned `let`,
          // and TS can't carry its narrowing (definitely a string past this
          // point) into the closure below.
          const insertedShowId = showId
          await tx
            .insert(seasons)
            .values(
              show.seasons.map((season) => ({
                showId: insertedShowId,
                seasonNumber: season.seasonNumber,
                name: season.name,
                episodeCount: season.episodeCount,
                airDate: season.airDate,
                posterPath: season.posterPath,
              })),
            )
            .onConflictDoNothing()
        }
      }

      // The show may already exist locally with some episodes already
      // resolved (e.g. from another user's activity), so look those up
      // rather than assume every episode in the file is missing.
      const existingEpisodes = await tx
        .select({
          id: episodes.id,
          seasonNumber: episodes.seasonNumber,
          episodeNumber: episodes.episodeNumber,
        })
        .from(episodes)
        .where(eq(episodes.showId, showId))
      const existingEpisodeKeys = new Set(
        existingEpisodes.map((e) => `${e.seasonNumber}:${e.episodeNumber}`),
      )
      for (const e of existingEpisodes) {
        episodeIdByRef.set(`${showId}:${e.seasonNumber}:${e.episodeNumber}`, e.id)
      }

      const missingEpisodes = show.episodes.filter(
        (e) => !existingEpisodeKeys.has(`${e.seasonNumber}:${e.episodeNumber}`),
      )
      if (missingEpisodes.length > 0) {
        const insertedEpisodes = await tx
          .insert(episodes)
          .values(
            missingEpisodes.map((e) => ({
              showId,
              seasonNumber: e.seasonNumber,
              episodeNumber: e.episodeNumber,
              title: e.title,
              runtimeMinutes: e.runtimeMinutes,
              firstAired: e.firstAired,
            })),
          )
          .onConflictDoNothing()
          .returning({
            id: episodes.id,
            seasonNumber: episodes.seasonNumber,
            episodeNumber: episodes.episodeNumber,
          })
        for (const e of insertedEpisodes) {
          episodeIdByRef.set(`${showId}:${e.seasonNumber}:${e.episodeNumber}`, e.id)
        }
      }
    }

    function resolveEpisodeId(tmdbShowId: string, season: number, episode: number): string | null {
      const showId = showIdByTmdbId.get(tmdbShowId)
      if (!showId) return null
      return episodeIdByRef.get(`${showId}:${season}:${episode}`) ?? null
    }

    // --- Wipe, then rewrite. No merge — matches Clear database exactly.
    await tx.delete(plays).where(eq(plays.userId, userId))
    await tx.delete(ratings).where(eq(ratings.userId, userId))
    await tx.delete(watchlistItems).where(eq(watchlistItems.userId, userId))
    await tx.delete(droppedShows).where(eq(droppedShows.userId, userId))

    const playValues = file.watchHistory
      .map((entry) => {
        if (entry.movie) {
          const movieId = movieIdByTmdbId.get(entry.movie)
          if (!movieId) return null
          return {
            userId,
            movieId,
            watchedAt: new Date(entry.watchedAt),
            source: entry.source,
            sourceRef: entry.sourceRef,
          }
        }
        const episodeId = resolveEpisodeId(entry.show!, entry.season!, entry.episode!)
        if (!episodeId) return null
        return {
          userId,
          episodeId,
          watchedAt: new Date(entry.watchedAt),
          source: entry.source,
          sourceRef: entry.sourceRef,
        }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
    await insertInChunks(playValues, (chunk) => tx.insert(plays).values(chunk))

    const ratingValues = file.ratings
      .map((entry) => {
        if (entry.movie) {
          const entityId = movieIdByTmdbId.get(entry.movie)
          if (!entityId) return null
          return {
            userId,
            entityType: 'movie' as const,
            entityId,
            rating: entry.rating,
            ratedAt: new Date(entry.ratedAt),
          }
        }
        if (entry.season === undefined) {
          const entityId = showIdByTmdbId.get(entry.show!)
          if (!entityId) return null
          return {
            userId,
            entityType: 'show' as const,
            entityId,
            rating: entry.rating,
            ratedAt: new Date(entry.ratedAt),
          }
        }
        const entityId = resolveEpisodeId(entry.show!, entry.season, entry.episode!)
        if (!entityId) return null
        return {
          userId,
          entityType: 'episode' as const,
          entityId,
          rating: entry.rating,
          ratedAt: new Date(entry.ratedAt),
        }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
    await insertInChunks(ratingValues, (chunk) => tx.insert(ratings).values(chunk))

    const watchlistValues = file.watchlist
      .map((entry) => {
        if (entry.movie) {
          const entityId = movieIdByTmdbId.get(entry.movie)
          if (!entityId) return null
          return {
            userId,
            entityType: 'movie' as const,
            entityId,
            listedAt: new Date(entry.listedAt),
            notes: entry.notes,
          }
        }
        if (entry.season === undefined) {
          const entityId = showIdByTmdbId.get(entry.show!)
          if (!entityId) return null
          return {
            userId,
            entityType: 'show' as const,
            entityId,
            listedAt: new Date(entry.listedAt),
            notes: entry.notes,
          }
        }
        const entityId = resolveEpisodeId(entry.show!, entry.season, entry.episode!)
        if (!entityId) return null
        return {
          userId,
          entityType: 'episode' as const,
          entityId,
          listedAt: new Date(entry.listedAt),
          notes: entry.notes,
        }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
    await insertInChunks(watchlistValues, (chunk) => tx.insert(watchlistItems).values(chunk))

    const droppedValues = file.droppedShows
      .map((entry) => {
        const showId = showIdByTmdbId.get(entry.show)
        if (!showId) return null
        return {
          userId,
          showId,
          traktDropped: entry.traktDropped,
          traktDroppedAt: entry.traktDroppedAt ? new Date(entry.traktDroppedAt) : null,
          manualDropped: entry.manualDropped,
          manualDroppedAt: entry.manualDroppedAt ? new Date(entry.manualDroppedAt) : null,
        }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
    await insertInChunks(droppedValues, (chunk) => tx.insert(droppedShows).values(chunk))

    return {
      watchHistory: playValues.length,
      ratings: ratingValues.length,
      watchlist: watchlistValues.length,
      droppedShows: droppedValues.length,
    }
  })
}
