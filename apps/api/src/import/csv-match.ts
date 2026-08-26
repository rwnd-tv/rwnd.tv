import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { resolveSeason } from '../lib/media.js'
import {
  resolveMovieFromExternalIds,
  resolveShowFromExternalIds,
  type ExternalIdBundle,
} from '../lib/external-match.js'

/**
 * Matches rwnd.tv's own exported CSV rows against local records — the CSV
 * counterpart of apps/api/src/import/match.ts's Trakt matchers, built
 * directly on the same external-id resolution `apps/api/src/lib/
 * external-match.ts` already uses for Plex webhook ingestion, rather than
 * on match.ts itself.
 *
 * Deliberately NOT reusing match.ts: its fast paths and per-job caches all
 * assume a Trakt numeric id is present (`String(ids.trakt)` written/looked-
 * up unconditionally, `showFailures` keyed by `trakt: number`) — a CSV row
 * only ever has `tmdb`/`tvdb`, so `ids.trakt` would be `undefined`,
 * `String(undefined)` is the literal string `"undefined"`, and every CSV
 * row would end up sharing (and poisoning) that one `external_ids` row and
 * cache key. Safer to build a small parallel matcher on the primitives that
 * were already Trakt-agnostic than to make match.ts's Trakt-shaped
 * internals handle a case they were never designed for.
 */

export type CsvMatchOutcome =
  | { ok: true; entityType: 'movie' | 'show' | 'episode'; entityId: string; title: string }
  | {
      ok: false
      reason: string
      title?: string
      show?: string
      season?: number
      episode?: number
    }

interface ShowResolution {
  id: string
  title: string
  provider: MetadataProvider
  providerExternalId: string
}

/**
 * Per-job caches, same reasoning as match.ts's own `ImportCaches`: a show
 * with many watched/rated/listed episodes should only trigger one
 * `resolveShowFromExternalIds` call and one provider `getSeason` call per
 * season, not one per row. Keyed on the ids bundle (not a Trakt id, which
 * CSV rows don't have).
 */
export interface CsvImportCaches {
  shows: Map<string, { ok: true; show: ShowResolution } | { ok: false; reason: string }>
  /** `${localShowId}:${seasonNumber}` -> null once fetched successfully, or
   * the failure reason if the fetch failed — same shape as match.ts's
   * `caches.seasons`. */
  seasons: Map<string, string | null>
}

export function createCsvImportCaches(): CsvImportCaches {
  return { shows: new Map(), seasons: new Map() }
}

function idsKey(ids: ExternalIdBundle): string {
  return `tmdb:${ids.tmdb ?? ''}|tvdb:${ids.tvdb ?? ''}`
}

function hasAnyId(ids: ExternalIdBundle): boolean {
  return Boolean(ids.tmdb || ids.tvdb)
}

function describeProviderError(err: unknown): string {
  return err instanceof Error ? `Metadata lookup failed: ${err.message}` : 'Metadata lookup failed'
}

export async function matchCsvMovie(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  title: string,
  locale: string,
): Promise<CsvMatchOutcome> {
  if (!hasAnyId(ids)) {
    return { ok: false, reason: 'Row has no tmdb_id or tvdb_id to resolve against', title }
  }
  const movie = await resolveMovieFromExternalIds(db, providers, ids, locale)
  if (!movie) {
    return {
      ok: false,
      reason: 'No match for this movie from any configured metadata provider',
      title,
    }
  }
  return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
}

/** Internal resolver shared by matchCsvShow (ratings/watchlist/dropped
 * rows, where the show itself is the entity) and matchCsvEpisode (where
 * it's a stepping stone to an episode) — cached either way. */
async function resolveCsvShow(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  locale: string,
  caches: CsvImportCaches,
): Promise<{ ok: true; show: ShowResolution } | { ok: false; reason: string }> {
  if (!hasAnyId(ids)) {
    return { ok: false, reason: 'Row has no tmdb_id or tvdb_id to resolve against' }
  }
  const key = idsKey(ids)
  const cached = caches.shows.get(key)
  if (cached) return cached

  const show = await resolveShowFromExternalIds(db, providers, ids, locale)
  const result = show
    ? ({ ok: true, show } as const)
    : ({
        ok: false,
        reason: 'No match for this show from any configured metadata provider',
      } as const)
  caches.shows.set(key, result)
  return result
}

export async function matchCsvShow(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  title: string,
  locale: string,
  caches: CsvImportCaches,
): Promise<CsvMatchOutcome> {
  const result = await resolveCsvShow(db, providers, ids, locale, caches)
  if (!result.ok) return { ok: false, reason: result.reason, title }
  return { ok: true, entityType: 'show', entityId: result.show.id, title: result.show.title }
}

async function findLocalEpisode(
  db: Database,
  showId: string,
  seasonNumber: number,
  episodeNumber: number,
) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * `ids` here is the SHOW's ids (history.csv/ratings.csv/watchlist.csv all
 * export an episode row's tmdb_id/tvdb_id as its *show's* ids — TMDB/TVDB
 * have no separate stable per-episode id, season+episode number is how an
 * episode is addressed once the show resolves).
 */
export async function matchCsvEpisode(
  db: Database,
  providers: MetadataProvider[],
  ids: ExternalIdBundle,
  seasonNumber: number,
  episodeNumber: number,
  showTitle: string,
  locale: string,
  caches: CsvImportCaches,
): Promise<CsvMatchOutcome> {
  const label = `${showTitle} S${seasonNumber} E${episodeNumber}`
  const episodeFailure = (reason: string): CsvMatchOutcome => ({
    ok: false,
    reason,
    title: label,
    show: showTitle,
    season: seasonNumber,
    episode: episodeNumber,
  })

  const showResult = await resolveCsvShow(db, providers, ids, locale, caches)
  if (!showResult.ok) return episodeFailure(showResult.reason)
  const { show } = showResult

  const existing = await findLocalEpisode(db, show.id, seasonNumber, episodeNumber)
  if (existing) return { ok: true, entityType: 'episode', entityId: existing.id, title: label }

  // Same "one provider.getSeason() call per season, not per episode" cache
  // as match.ts's matchEpisode — resolveSeason (media.ts) always calls the
  // provider, it has no "already fetched locally" shortcut of its own.
  const seasonKey = `${show.id}:${seasonNumber}`
  if (!caches.seasons.has(seasonKey)) {
    try {
      await resolveSeason(db, show.provider, show.id, show.providerExternalId, seasonNumber, locale)
      caches.seasons.set(seasonKey, null)
    } catch (err) {
      caches.seasons.set(seasonKey, describeProviderError(err))
    }
  }
  const seasonFailure = caches.seasons.get(seasonKey)
  if (seasonFailure) return episodeFailure(seasonFailure)

  const resolved = await findLocalEpisode(db, show.id, seasonNumber, episodeNumber)
  if (!resolved) {
    return episodeFailure(`Episode not found in ${show.provider.source.toUpperCase()} season data`)
  }
  return { ok: true, entityType: 'episode', entityId: resolved.id, title: label }
}
