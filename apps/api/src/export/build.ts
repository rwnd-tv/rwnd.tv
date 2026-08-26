import { and, eq, inArray, or } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import {
  droppedShows,
  episodes,
  externalIds,
  movies,
  plays,
  ratings,
  shows,
  watchlistItems,
} from '@rwnd/db'
import { UNKNOWN_WATCHED_AT, metadataProviderSourceSchema } from '@rwnd/shared'
import { writeCsv } from '../lib/csv.js'

/** Every real metadata provider's own id gets its own export column
 * (`tmdb_id`, `tvdb_id`, …) — driven by this schema rather than hardcoded,
 * so a future provider (see metadataProviderSourceSchema's own doc
 * comment) picks up an export column automatically, no edit needed here.
 * Deliberately narrower than `externalIdSourceEnum` in packages/db/src/
 * schema.ts, which also has `imdb`/`trakt` — those are cross-reference
 * tags on an entity resolved through a real provider, not providers
 * themselves, so they'd be noise as export columns. */
const PROVIDER_SOURCES = metadataProviderSourceSchema.options

/** `"unknown"` for Trakt's "I don't remember when" sentinel, otherwise a
 * plain UTC ISO 8601 string — sortable and unambiguous in a spreadsheet,
 * matching what the rest of the export uses for every other timestamp. */
function formatWatchedAt(watchedAt: Date): string {
  return watchedAt.toISOString() === UNKNOWN_WATCHED_AT ? 'unknown' : watchedAt.toISOString()
}

/**
 * The open-format full data export (Settings > Database — see
 * DatabasePanel.tsx) — a CSV per category (history/ratings/watchlist/
 * dropped shows), one of the project's stated aims since day one (see
 * docs/vision.md). Deliberately a separate, flatter shape from
 * apps/api/src/backup/build.ts's JSON: that format is restore-oriented
 * (provider-tagged refs, nested show/season/episode metadata, meant to be
 * read back into another rwnd.tv instance); this one is meant to be opened
 * directly in a spreadsheet or read by an entirely different tool, so each
 * row carries its own plain title/show title/season/episode inline rather
 * than needing a second file cross-referenced by id.
 */
export async function buildExportFiles(
  db: Database,
  userId: string,
): Promise<Record<string, string>> {
  const [playRows, ratingRows, watchlistRows, droppedRows] = await Promise.all([
    db.select().from(plays).where(eq(plays.userId, userId)),
    db.select().from(ratings).where(eq(ratings.userId, userId)),
    db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)),
    db.select().from(droppedShows).where(eq(droppedShows.userId, userId)),
  ])

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

  const [movieRows, showRows, providerIdRows] = await Promise.all([
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
    // Every real provider's id for every referenced movie/show, in one
    // query — a movie id and a show id can never collide (separate uuid
    // columns), so entityId alone is a safe map key below without also
    // carrying entityType.
    movieIds.size > 0 || showIds.size > 0
      ? db
          .select({
            entityId: externalIds.entityId,
            source: externalIds.source,
            externalId: externalIds.externalId,
          })
          .from(externalIds)
          .where(
            and(
              inArray(externalIds.source, PROVIDER_SOURCES),
              or(
                movieIds.size > 0
                  ? and(
                      eq(externalIds.entityType, 'movie'),
                      inArray(externalIds.entityId, [...movieIds]),
                    )
                  : undefined,
                showIds.size > 0
                  ? and(
                      eq(externalIds.entityType, 'show'),
                      inArray(externalIds.entityId, [...showIds]),
                    )
                  : undefined,
              ),
            ),
          )
      : [],
  ])
  const movieById = new Map(movieRows.map((row) => [row.id, row]))
  const showById = new Map(showRows.map((row) => [row.id, row]))

  const idsByEntity = new Map<string, Map<string, string>>()
  for (const row of providerIdRows) {
    let bySource = idsByEntity.get(row.entityId)
    if (!bySource) {
      bySource = new Map()
      idsByEntity.set(row.entityId, bySource)
    }
    bySource.set(row.source, row.externalId)
  }
  /** One value per PROVIDER_SOURCES entry, in that fixed order — appended
   * to every row so the CSV's `tmdb_id`/`tvdb_id`/… columns line up with
   * the header regardless of which providers this particular entity
   * actually has an id from. */
  function providerIdColumns(entityId: string): string[] {
    const bySource = idsByEntity.get(entityId)
    return PROVIDER_SOURCES.map((source) => bySource?.get(source) ?? '')
  }

  const historyRows: (string | number | null)[][] = []
  for (const row of playRows) {
    if (row.movieId) {
      const movie = movieById.get(row.movieId)
      if (!movie) continue
      historyRows.push([
        'movie',
        movie.title,
        '',
        '',
        '',
        formatWatchedAt(row.watchedAt),
        row.source,
        ...providerIdColumns(movie.id),
      ])
    } else if (row.episodeId) {
      const episode = episodeById.get(row.episodeId)
      const show = episode && showById.get(episode.showId)
      if (!episode || !show) continue
      historyRows.push([
        'episode',
        episode.title,
        show.title,
        episode.seasonNumber,
        episode.episodeNumber,
        formatWatchedAt(row.watchedAt),
        row.source,
        ...providerIdColumns(show.id),
      ])
    }
  }

  const ratingsRows: (string | number | null)[][] = []
  for (const row of ratingRows) {
    if (row.entityType === 'movie') {
      const movie = movieById.get(row.entityId)
      if (!movie) continue
      ratingsRows.push([
        'movie',
        movie.title,
        '',
        '',
        '',
        row.rating,
        row.ratedAt.toISOString(),
        ...providerIdColumns(movie.id),
      ])
    } else if (row.entityType === 'show') {
      const show = showById.get(row.entityId)
      if (!show) continue
      ratingsRows.push([
        'show',
        show.title,
        '',
        '',
        '',
        row.rating,
        row.ratedAt.toISOString(),
        ...providerIdColumns(show.id),
      ])
    } else {
      const episode = episodeById.get(row.entityId)
      const show = episode && showById.get(episode.showId)
      if (!episode || !show) continue
      ratingsRows.push([
        'episode',
        episode.title,
        show.title,
        episode.seasonNumber,
        episode.episodeNumber,
        row.rating,
        row.ratedAt.toISOString(),
        ...providerIdColumns(show.id),
      ])
    }
  }

  const watchlistRowsOut: (string | number | null)[][] = []
  for (const row of watchlistRows) {
    if (row.entityType === 'movie') {
      const movie = movieById.get(row.entityId)
      if (!movie) continue
      watchlistRowsOut.push([
        'movie',
        movie.title,
        '',
        '',
        '',
        row.listedAt.toISOString(),
        row.notes,
        ...providerIdColumns(movie.id),
      ])
    } else if (row.entityType === 'show') {
      const show = showById.get(row.entityId)
      if (!show) continue
      watchlistRowsOut.push([
        'show',
        show.title,
        '',
        '',
        '',
        row.listedAt.toISOString(),
        row.notes,
        ...providerIdColumns(show.id),
      ])
    } else {
      const episode = episodeById.get(row.entityId)
      const show = episode && showById.get(episode.showId)
      if (!episode || !show) continue
      watchlistRowsOut.push([
        'episode',
        episode.title,
        show.title,
        episode.seasonNumber,
        episode.episodeNumber,
        row.listedAt.toISOString(),
        row.notes,
        ...providerIdColumns(show.id),
      ])
    }
  }

  // Only rows currently *effectively* dropped — a dropped_shows row can
  // exist without meaning "dropped" (e.g. traktDropped=false, no manual
  // override), same "manualDropped wins, falls back to traktDropped"
  // determination used everywhere else (apps/api/src/routes/library.ts).
  const droppedRowsOut: (string | number | null)[][] = []
  for (const row of droppedRows) {
    const dropped = row.manualDropped ?? row.traktDropped ?? false
    if (!dropped) continue
    const show = showById.get(row.showId)
    if (!show) continue
    const droppedAt = row.manualDropped !== null ? row.manualDroppedAt : row.traktDroppedAt
    droppedRowsOut.push([
      show.title,
      ...providerIdColumns(show.id),
      droppedAt ? droppedAt.toISOString() : '',
    ])
  }

  const providerIdHeaders = PROVIDER_SOURCES.map((source) => `${source}_id`)

  return {
    'history.csv': writeCsv(
      [
        'type',
        'title',
        'show_title',
        'season_number',
        'episode_number',
        'watched_at',
        'source',
        ...providerIdHeaders,
      ],
      historyRows,
    ),
    'ratings.csv': writeCsv(
      [
        'type',
        'title',
        'show_title',
        'season_number',
        'episode_number',
        'rating',
        'rated_at',
        ...providerIdHeaders,
      ],
      ratingsRows,
    ),
    'watchlist.csv': writeCsv(
      [
        'type',
        'title',
        'show_title',
        'season_number',
        'episode_number',
        'listed_at',
        'notes',
        ...providerIdHeaders,
      ],
      watchlistRowsOut,
    ),
    'dropped-shows.csv': writeCsv(
      ['show_title', ...providerIdHeaders, 'dropped_at'],
      droppedRowsOut,
    ),
  }
}
