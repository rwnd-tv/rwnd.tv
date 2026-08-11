import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { resolveMovie, resolveShow } from '../lib/media.js'
import type { TraktEpisode, TraktIds, TraktMovie, TraktShow } from '../trakt/types.js'

/**
 * Matches Trakt-sourced items against rwnd.tv's local records, via
 * `external_ids` — this is the mechanism ADR 0002 was designed for. A hit
 * against a `trakt` row means a previous import already resolved this item
 * (no network call); otherwise it falls back to the item's `tmdb` id and
 * goes through the same resolveMovie/resolveShow path search already uses
 * (apps/api/src/lib/media.ts), then backfills the `trakt` (and `imdb`, when
 * present) rows so the next import — or a webhook — hits the fast path.
 *
 * Anything that can't be matched (no tmdb id and no prior local match, or a
 * Trakt item type rwnd.tv has no local entity for) is reported back to the
 * caller as a failure rather than silently dropped.
 */

export type MatchOutcome =
  | { ok: true; entityType: 'movie' | 'show' | 'episode'; entityId: string; title: string }
  | { ok: false; reason: string; title?: string }

interface ShowMatch {
  id: string
  title: string
  /** Needed to call provider.getSeason(); null if this show has no known
   * TMDB id (e.g. it was matched purely by a previously-backfilled trakt
   * id and TMDB never had a match for it), in which case episodes under it
   * can't be resolved. */
  tmdbExternalId: string | null
}

/** Per-job cache so a show with many watched episodes only triggers one
 * provider.getSeason() call per season, not one per episode. Keyed by
 * `${localShowId}:${seasonNumber}`. */
export type SeasonCache = Set<string>

async function lookupLocalIdByExternalId(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  source: 'trakt' | 'tmdb',
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, entityType),
        eq(externalIds.source, source),
        eq(externalIds.externalId, externalId),
      ),
    )
    .limit(1)
  return row?.id ?? null
}

async function lookupTmdbExternalId(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, entityType),
        eq(externalIds.entityId, entityId),
        eq(externalIds.source, 'tmdb'),
      ),
    )
    .limit(1)
  return row?.externalId ?? null
}

async function backfillExternalIds(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
  ids: TraktIds,
): Promise<void> {
  const rows: Array<{
    entityType: typeof entityType
    entityId: string
    source: 'trakt' | 'imdb'
    externalId: string
  }> = [{ entityType, entityId, source: 'trakt', externalId: String(ids.trakt) }]
  if (ids.imdb) rows.push({ entityType, entityId, source: 'imdb', externalId: ids.imdb })
  await db.insert(externalIds).values(rows).onConflictDoNothing()
}

export async function matchMovie(
  db: Database,
  provider: MetadataProvider,
  traktMovie: TraktMovie,
  locale: string,
): Promise<MatchOutcome> {
  const localId = await lookupLocalIdByExternalId(
    db,
    'movie',
    'trakt',
    String(traktMovie.ids.trakt),
  )
  if (localId) {
    const [movie] = await db.select().from(movies).where(eq(movies.id, localId)).limit(1)
    if (movie) return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
  }

  if (!traktMovie.ids.tmdb) {
    return { ok: false, reason: 'No TMDB id for this movie', title: traktMovie.title }
  }

  const movie = await resolveMovie(db, provider, String(traktMovie.ids.tmdb), locale)
  await backfillExternalIds(db, 'movie', movie.id, traktMovie.ids)
  return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
}

async function matchShow(
  db: Database,
  provider: MetadataProvider,
  traktShow: TraktShow,
  locale: string,
): Promise<{ ok: true; show: ShowMatch } | { ok: false; reason: string; title?: string }> {
  const localId = await lookupLocalIdByExternalId(db, 'show', 'trakt', String(traktShow.ids.trakt))
  if (localId) {
    const [show] = await db.select().from(shows).where(eq(shows.id, localId)).limit(1)
    if (show) {
      const tmdbExternalId = traktShow.ids.tmdb
        ? String(traktShow.ids.tmdb)
        : await lookupTmdbExternalId(db, 'show', show.id)
      return { ok: true, show: { id: show.id, title: show.title, tmdbExternalId } }
    }
  }

  if (!traktShow.ids.tmdb) {
    return { ok: false, reason: 'No TMDB id for this show', title: traktShow.title }
  }

  const show = await resolveShow(db, provider, String(traktShow.ids.tmdb), locale)
  await backfillExternalIds(db, 'show', show.id, traktShow.ids)
  return {
    ok: true,
    show: { id: show.id, title: show.title, tmdbExternalId: String(traktShow.ids.tmdb) },
  }
}

async function findLocalEpisode(db: Database, showId: string, season: number, number: number) {
  const [row] = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        eq(episodes.seasonNumber, season),
        eq(episodes.episodeNumber, number),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function matchEpisode(
  db: Database,
  provider: MetadataProvider,
  traktShow: TraktShow,
  traktEpisode: TraktEpisode,
  locale: string,
  seasonCache: SeasonCache,
): Promise<MatchOutcome> {
  const showResult = await matchShow(db, provider, traktShow, locale)
  if (!showResult.ok) return { ok: false, reason: showResult.reason, title: showResult.title }
  const { show } = showResult

  const label = `${show.title} S${traktEpisode.season}E${traktEpisode.number}`

  const existing = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (existing) {
    await backfillExternalIds(db, 'episode', existing.id, traktEpisode.ids)
    return { ok: true, entityType: 'episode', entityId: existing.id, title: label }
  }

  if (!show.tmdbExternalId) {
    return { ok: false, reason: 'Show has no TMDB id, cannot resolve episode', title: label }
  }

  const seasonKey = `${show.id}:${traktEpisode.season}`
  if (!seasonCache.has(seasonKey)) {
    const seasonEpisodes = await provider.getSeason(
      show.tmdbExternalId,
      traktEpisode.season,
      locale,
    )
    if (seasonEpisodes.length > 0) {
      await db
        .insert(episodes)
        .values(
          seasonEpisodes.map((e) => ({
            showId: show.id,
            seasonNumber: e.seasonNumber,
            episodeNumber: e.episodeNumber,
            title: e.title,
            runtimeMinutes: e.runtimeMinutes,
            firstAired: e.firstAired,
          })),
        )
        .onConflictDoNothing()
    }
    seasonCache.add(seasonKey)
  }

  const resolved = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (!resolved) {
    return { ok: false, reason: 'Episode not found in TMDB season data', title: label }
  }
  await backfillExternalIds(db, 'episode', resolved.id, traktEpisode.ids)
  return { ok: true, entityType: 'episode', entityId: resolved.id, title: label }
}

/**
 * Dispatches a ratings/watchlist item (which, unlike history, can be any of
 * movie/show/season/episode) to the right matcher. `season`-type entries
 * have no local entity (`metadata_entity_type` has no 'season' value) and
 * are always reported unmatched.
 */
export async function matchTraktMediaItem(
  db: Database,
  provider: MetadataProvider,
  item: { type: string; movie?: TraktMovie; show?: TraktShow; episode?: TraktEpisode },
  locale: string,
  seasonCache: SeasonCache,
): Promise<MatchOutcome> {
  switch (item.type) {
    case 'movie':
      if (!item.movie) return { ok: false, reason: 'Missing movie payload' }
      return matchMovie(db, provider, item.movie, locale)
    case 'show': {
      if (!item.show) return { ok: false, reason: 'Missing show payload' }
      const result = await matchShow(db, provider, item.show, locale)
      if (!result.ok) return result
      return { ok: true, entityType: 'show', entityId: result.show.id, title: result.show.title }
    }
    case 'episode':
      if (!item.show || !item.episode) return { ok: false, reason: 'Missing episode payload' }
      return matchEpisode(db, provider, item.show, item.episode, locale, seasonCache)
    case 'season':
      return {
        ok: false,
        reason: 'Season-level ratings/watchlist entries are not yet supported',
        title: item.show?.title,
      }
    default:
      return { ok: false, reason: `Unknown Trakt item type: ${item.type}` }
  }
}
