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
  watchlists,
} from '@rwnd/db'
import type { BackupCounts, BackupFile } from '@rwnd/shared'
import { generateUniqueMovieSlug, generateUniqueShowSlug } from '../lib/slug.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'

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
 * fetched from a provider — see packages/shared/src/schemas/backups.ts's
 * doc comment for why that's possible without a provider call.
 */
export async function restoreBackupFile(
  db: Database,
  userId: string,
  file: BackupFile,
): Promise<BackupCounts> {
  return db.transaction(async (tx) => {
    // --- Resolve every referenced movie/show to a local id, creating rows
    // from the file's metadata when the ref isn't already known here. Keyed
    // by `${source}:${externalId}` since a bare id alone can't distinguish
    // a TMDB id from a same-numbered TVDB id (see externalRefSchema's doc
    // comment in packages/shared/src/schemas/backups.ts).
    const refKey = (source: string, externalId: string) => `${source}:${externalId}`
    const movieRefs = file.movies.map((m) => m.ref)
    const showRefs = file.shows.map((s) => s.ref)

    const [existingMovies, existingShows] = await Promise.all([
      movieRefs.length > 0
        ? tx
            .select({
              source: externalIds.source,
              externalId: externalIds.externalId,
              id: externalIds.entityId,
            })
            .from(externalIds)
            .where(
              and(
                eq(externalIds.entityType, 'movie'),
                inArray(
                  externalIds.source,
                  movieRefs.map((r) => r.source),
                ),
                inArray(
                  externalIds.externalId,
                  movieRefs.map((r) => r.externalId),
                ),
              ),
            )
        : [],
      showRefs.length > 0
        ? tx
            .select({
              source: externalIds.source,
              externalId: externalIds.externalId,
              id: externalIds.entityId,
            })
            .from(externalIds)
            .where(
              and(
                eq(externalIds.entityType, 'show'),
                inArray(
                  externalIds.source,
                  showRefs.map((r) => r.source),
                ),
                inArray(
                  externalIds.externalId,
                  showRefs.map((r) => r.externalId),
                ),
              ),
            )
        : [],
    ])

    const movieIdByRef = new Map(
      existingMovies.map((row) => [refKey(row.source, row.externalId), row.id]),
    )
    const showIdByRef = new Map(
      existingShows.map((row) => [refKey(row.source, row.externalId), row.id]),
    )

    // Sequential, not parallel — generateUniqueMovieSlug()/
    // generateUniqueShowSlug()'s uniqueness check reads the current table
    // state, so two inserts racing inside the same transaction could both
    // compute the same slug. Applies to movies too now that they have one.
    for (const movie of file.movies) {
      const key = refKey(movie.ref.source, movie.ref.externalId)
      if (movieIdByRef.has(key)) continue
      const slug = await generateUniqueMovieSlug(tx, movie.title, movie.year)
      const [inserted] = await tx
        .insert(movies)
        .values({
          title: movie.title,
          slug,
          year: movie.year,
          runtimeMinutes: movie.runtimeMinutes,
          overview: movie.overview,
          posterPath: movie.posterPath,
          // Truthful by construction: the row below records the exact same
          // source for this entity's external id.
          metadataSource: movie.ref.source,
        })
        .returning({ id: movies.id })
      if (!inserted) throw new Error(`Failed to insert movie ${key}`)
      await tx
        .insert(externalIds)
        .values({
          entityType: 'movie',
          entityId: inserted.id,
          source: movie.ref.source,
          externalId: movie.ref.externalId,
        })
        .onConflictDoNothing()
      movieIdByRef.set(key, inserted.id)
    }

    // `${showId}:${seasonNumber}:${episodeNumber}` -> local episode id.
    const episodeIdByRef = new Map<string, string>()

    for (const show of file.shows) {
      const key = refKey(show.ref.source, show.ref.externalId)
      let showId = showIdByRef.get(key)
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
            // Same reasoning as the movie insert above.
            metadataSource: show.ref.source,
          })
          .returning({ id: shows.id })
        if (!inserted) throw new Error(`Failed to insert show ${key}`)
        showId = inserted.id
        await tx
          .insert(externalIds)
          .values({
            entityType: 'show',
            entityId: showId,
            source: show.ref.source,
            externalId: show.ref.externalId,
          })
          .onConflictDoNothing()
        showIdByRef.set(key, showId)

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

    function resolveEpisodeId(
      show: { source: string; externalId: string },
      season: number,
      episode: number,
    ): string | null {
      const showId = showIdByRef.get(refKey(show.source, show.externalId))
      if (!showId) return null
      return episodeIdByRef.get(`${showId}:${season}:${episode}`) ?? null
    }

    // --- Wipe, then rewrite. No merge — matches Clear database exactly.
    await tx.delete(plays).where(eq(plays.userId, userId))
    await tx.delete(ratings).where(eq(ratings.userId, userId))
    await tx.delete(droppedShows).where(eq(droppedShows.userId, userId))
    // Every custom watchlist (ON DELETE CASCADE takes its items with it),
    // but never the Default list itself — only its contents. Same
    // "structure survives, data doesn't" reasoning Clear database uses for
    // this category (James, 2026-08-27 — see docs/TODO_ARCHIVE.md).
    await tx
      .delete(watchlists)
      .where(and(eq(watchlists.userId, userId), eq(watchlists.isDefault, false)))
    const defaultWatchlistId = await ensureDefaultWatchlist(tx, userId)
    await tx.delete(watchlistItems).where(eq(watchlistItems.watchlistId, defaultWatchlistId))

    // Recreate every custom list from the file's roster before the items
    // loop below needs to resolve a `list` name to an id — see
    // backupWatchlistSchema's doc comment for why Default isn't in here.
    const watchlistIdByName = new Map<string, string>([['Default', defaultWatchlistId]])
    if (file.watchlists.length > 0) {
      const createdLists = await tx
        .insert(watchlists)
        .values(file.watchlists.map((w) => ({ userId, name: w.name })))
        .returning({ id: watchlists.id, name: watchlists.name })
      for (const row of createdLists) watchlistIdByName.set(row.name, row.id)
    }

    const playValues = file.watchHistory
      .map((entry) => {
        if (entry.movie) {
          const movieId = movieIdByRef.get(refKey(entry.movie.source, entry.movie.externalId))
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
          const entityId = movieIdByRef.get(refKey(entry.movie.source, entry.movie.externalId))
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
          const entityId = showIdByRef.get(refKey(entry.show!.source, entry.show!.externalId))
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
        // Falls back to Default for a name the roster doesn't have —
        // shouldn't happen for a file this codebase wrote (every `list`
        // value it writes has a matching roster entry, or is "Default"
        // itself, which isn't in the roster at all), but a hand-edited or
        // otherwise foreign file shouldn't lose the entry entirely over it.
        const watchlistId = watchlistIdByName.get(entry.list) ?? defaultWatchlistId
        if (entry.movie) {
          const entityId = movieIdByRef.get(refKey(entry.movie.source, entry.movie.externalId))
          if (!entityId) return null
          return {
            userId,
            watchlistId,
            entityType: 'movie' as const,
            entityId,
            listedAt: new Date(entry.listedAt),
            notes: entry.notes,
          }
        }
        if (entry.season === undefined) {
          const entityId = showIdByRef.get(refKey(entry.show!.source, entry.show!.externalId))
          if (!entityId) return null
          return {
            userId,
            watchlistId,
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
          watchlistId,
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
        const showId = showIdByRef.get(refKey(entry.show.source, entry.show.externalId))
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
