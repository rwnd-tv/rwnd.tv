import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { resolveMovie, resolveShow } from '../lib/media.js'
import type { TraktEpisode, TraktIds, TraktMovie, TraktSeason, TraktShow } from '../trakt/types.js'

/**
 * Matches Trakt-sourced items against rwnd.tv's local records, via
 * `external_ids` — this is the mechanism ADR 0002 was designed for. A hit
 * against a `trakt` row means a previous import already resolved this item
 * (no network call); otherwise it falls back to the item's `tmdb` id and
 * goes through the same resolveMovie/resolveShow path search already uses
 * (apps/api/src/lib/media.ts). If Trakt's own `tmdb` id is missing, or the
 * provider no longer recognises it (merged/deleted/wrong id), this falls
 * through to a reverse lookup on Trakt's `imdb`/`tvdb` ids via
 * `provider.findByExternalId` (see docs/adr/0006) before giving up — the
 * fix for the common case where Trakt's own tmdb field is null or stale but
 * the provider does hold a matching entry. It does **not** help when the
 * provider genuinely has no entry for a title under any id (Formula 1 via
 * Trakt is the motivating example — TMDB doesn't carry it at all). Either
 * way, every id Trakt handed us gets backfilled (`trakt`, plus `imdb`/`tvdb`
 * when present) so the next import — or a webhook — hits the fast path.
 * Trakt's `slug` isn't stored: it's an alternate identifier *within*
 * Trakt's own system, not a separate external source, so it doesn't fit
 * `external_id_source`'s model of "which other system does this id belong
 * to."
 *
 * Anything that can't be matched (no id resolvable by any means and no
 * prior local match, or a Trakt item type rwnd.tv has no local entity for)
 * is reported back to the caller as a failure rather than silently dropped.
 */

export type MatchOutcome =
  | { ok: true; entityType: 'movie' | 'show' | 'episode'; entityId: string; title: string }
  | {
      ok: false
      reason: string
      title?: string
      /** Present for episode-level (and, for `season`, season-level)
       * failures — lets the UI group failures into a show > season >
       * episode tree instead of parsing them back out of `title`. */
      show?: string
      season?: number
      episode?: number
    }

interface ShowMatch {
  id: string
  title: string
  /** Needed to call provider.getSeason(); null if this show has no known id
   * from `provider` (e.g. it was matched purely by a previously-backfilled
   * trakt id and the provider never had a match for it under any id), in
   * which case episodes under it can't be resolved. */
  providerExternalId: string | null
}

/**
 * Per-job caches so a show with many watched/rated/listed episodes only
 * triggers one TMDB request per show and per season, not one per episode.
 * Both cache failures as well as successes — a show whose TMDB lookup
 * 404s fails identically for every episode under it, so without
 * `showFailures` a show with N watched episodes makes N redundant failing
 * requests instead of one (found live: a single unresolvable show
 * accounted for 200+ consecutive failures on a real import).
 */
export interface ImportCaches {
  /** `${localShowId}:${seasonNumber}` -> null once fetched successfully,
   * or the failure reason if the fetch failed. */
  seasons: Map<string, string | null>
  /** Trakt show id -> failure reason. Only failures are cached here — a
   * successful resolution is already fast via the local `external_ids`
   * lookup at the top of `matchShow`, so caching successes too would be
   * redundant. */
  showFailures: Map<number, string>
}

function describeProviderError(err: unknown): string {
  return err instanceof Error ? `TMDB lookup failed: ${err.message}` : 'TMDB lookup failed'
}

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

async function lookupProviderExternalId(
  db: Database,
  entityType: 'movie' | 'show' | 'episode',
  entityId: string,
  source: MetadataProvider['source'],
): Promise<string | null> {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.entityType, entityType),
        eq(externalIds.entityId, entityId),
        eq(externalIds.source, source),
      ),
    )
    .limit(1)
  return row?.externalId ?? null
}

/** Tries Trakt's `imdb` id then its `tvdb` id against
 * `provider.findByExternalId`, returning the first hit. `imdb` covers both
 * movies and shows; `tvdb` is TV-only in practice, but there's no harm
 * asking either provider method for either entity type — the provider
 * itself returns null for a source it can't reverse-lookup. */
async function findViaAlternateIds(
  provider: MetadataProvider,
  entityType: 'movie' | 'show',
  ids: TraktIds,
  locale: string,
): Promise<string | null> {
  if (ids.imdb) {
    const found = await provider.findByExternalId(entityType, 'imdb', ids.imdb, locale)
    if (found) return found
  }
  if (ids.tvdb) {
    const found = await provider.findByExternalId(entityType, 'tvdb', String(ids.tvdb), locale)
    if (found) return found
  }
  return null
}

/**
 * Shared by matchMovie/matchShow: tries `resolve` against Trakt's own
 * `tmdb` id first (when present), then — whether `tmdb` was absent, or
 * present but rejected by the provider (merged/deleted/wrong id) — against
 * whatever `findViaAlternateIds` turns up. The `findByExternalId` call is
 * only made when it's actually needed (no eager lookup on the common path
 * where Trakt's own tmdb id just works), since it's a live provider
 * request. `error` is the most recent attempt's failure, or null if no
 * candidate id was ever found to try.
 */
async function resolveViaProvider<T>(
  resolve: (providerExternalId: string) => Promise<T>,
  provider: MetadataProvider,
  entityType: 'movie' | 'show',
  ids: TraktIds,
  locale: string,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown = null
  if (ids.tmdb) {
    try {
      return { ok: true, value: await resolve(String(ids.tmdb)) }
    } catch (err) {
      lastError = err
    }
  }
  const alternateId = await findViaAlternateIds(provider, entityType, ids, locale)
  if (alternateId) {
    try {
      return { ok: true, value: await resolve(alternateId) }
    } catch (err) {
      lastError = err
    }
  }
  return { ok: false, error: lastError }
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
    source: 'trakt' | 'imdb' | 'tvdb'
    externalId: string
  }> = [{ entityType, entityId, source: 'trakt', externalId: String(ids.trakt) }]
  if (ids.imdb) rows.push({ entityType, entityId, source: 'imdb', externalId: ids.imdb })
  if (ids.tvdb) rows.push({ entityType, entityId, source: 'tvdb', externalId: String(ids.tvdb) })
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
    if (movie) {
      // Backfilled even on this already-resolved fast path — a movie
      // matched via `trakt` before this field existed would otherwise
      // never pick up its tvdb id on a later re-import, since the whole
      // point of this branch is skipping work that's already done.
      await backfillExternalIds(db, 'movie', movie.id, traktMovie.ids)
      return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
    }
  }

  const result = await resolveViaProvider(
    (externalId) => resolveMovie(db, provider, externalId, locale),
    provider,
    'movie',
    traktMovie.ids,
    locale,
  )
  if (!result.ok) {
    // Either no id resolvable by any means, or the provider rejected every
    // candidate it was given (merged/deleted/wrong id) — either way, a
    // per-item failure, not a reason to abort the whole import.
    return {
      ok: false,
      reason: result.error
        ? describeProviderError(result.error)
        : 'No TMDB match for this movie (tried tmdb, imdb and tvdb ids)',
      title: traktMovie.title,
    }
  }
  const movie = result.value
  await backfillExternalIds(db, 'movie', movie.id, traktMovie.ids)
  return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
}

async function matchShow(
  db: Database,
  provider: MetadataProvider,
  traktShow: TraktShow,
  locale: string,
  caches: ImportCaches,
): Promise<{ ok: true; show: ShowMatch } | { ok: false; reason: string; title?: string }> {
  const cachedFailure = caches.showFailures.get(traktShow.ids.trakt)
  if (cachedFailure) {
    return { ok: false, reason: cachedFailure, title: traktShow.title }
  }

  const localId = await lookupLocalIdByExternalId(db, 'show', 'trakt', String(traktShow.ids.trakt))
  if (localId) {
    const [show] = await db.select().from(shows).where(eq(shows.id, localId)).limit(1)
    if (show) {
      // Same-request Trakt payload avoids a DB round trip only when it
      // actually names an id for the provider we're using — a hypothetical
      // non-tmdb provider can't be shortcut through Trakt's own tmdb field.
      const providerExternalId =
        traktShow.ids.tmdb && provider.source === 'tmdb'
          ? String(traktShow.ids.tmdb)
          : await lookupProviderExternalId(db, 'show', show.id, provider.source)
      // Same reasoning as matchMovie's fast path above.
      await backfillExternalIds(db, 'show', show.id, traktShow.ids)
      return { ok: true, show: { id: show.id, title: show.title, providerExternalId } }
    }
  }

  const result = await resolveViaProvider(
    (externalId) => resolveShow(db, provider, externalId, locale),
    provider,
    'show',
    traktShow.ids,
    locale,
  )
  if (!result.ok) {
    const reason = result.error
      ? describeProviderError(result.error)
      : 'No TMDB match for this show (tried tmdb, imdb and tvdb ids)'
    // Cached even for the no-candidate-id case, not just a thrown resolve
    // error — a show with no findable id fails identically for every
    // watched episode under it, so without this a show with N episodes
    // makes N redundant findViaAlternateIds calls instead of one.
    caches.showFailures.set(traktShow.ids.trakt, reason)
    return { ok: false, reason, title: traktShow.title }
  }
  const show = result.value
  await backfillExternalIds(db, 'show', show.id, traktShow.ids)
  // Whichever candidate id actually resolved it, resolveShow has already
  // written the provider-keyed external_ids row — read it back rather than
  // threading the winning candidate id out of resolveViaProvider.
  const providerExternalId = await lookupProviderExternalId(db, 'show', show.id, provider.source)
  return { ok: true, show: { id: show.id, title: show.title, providerExternalId } }
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
  caches: ImportCaches,
): Promise<MatchOutcome> {
  // Built from the Trakt show's own title up front, before we know whether
  // the show resolves — a show-level failure (the common case: one show
  // with many watched episodes fails identically for all of them) still
  // needs a label that identifies *which episode*, or every failure in
  // the list looks like an indistinguishable copy of the same entry.
  const label = `${traktShow.title} S${traktEpisode.season} E${traktEpisode.number}`
  // show/season/episode carried on every failure below so the UI can group
  // them into a tree instead of parsing `label` back apart.
  const episodeFailure = (reason: string): MatchOutcome => ({
    ok: false,
    reason,
    title: label,
    show: traktShow.title,
    season: traktEpisode.season,
    episode: traktEpisode.number,
  })

  const showResult = await matchShow(db, provider, traktShow, locale, caches)
  if (!showResult.ok) return episodeFailure(showResult.reason)
  const { show } = showResult

  const existing = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (existing) {
    await backfillExternalIds(db, 'episode', existing.id, traktEpisode.ids)
    return { ok: true, entityType: 'episode', entityId: existing.id, title: label }
  }

  if (!show.providerExternalId) {
    return episodeFailure('Show has no id from this provider, cannot resolve episode')
  }

  const seasonKey = `${show.id}:${traktEpisode.season}`
  if (!caches.seasons.has(seasonKey)) {
    try {
      const { episodes: seasonEpisodes } = await provider.getSeason(
        show.providerExternalId,
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
      caches.seasons.set(seasonKey, null)
    } catch (err) {
      // Cached so every other episode in this same broken season fails
      // fast instead of re-hitting TMDB for a season it's already 404'd on.
      caches.seasons.set(seasonKey, describeProviderError(err))
    }
  }

  const seasonFailure = caches.seasons.get(seasonKey)
  if (seasonFailure) {
    return episodeFailure(seasonFailure)
  }

  const resolved = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (!resolved) {
    return episodeFailure('Episode not found in TMDB season data')
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
  item: {
    type: string
    movie?: TraktMovie
    show?: TraktShow
    season?: TraktSeason
    episode?: TraktEpisode
  },
  locale: string,
  caches: ImportCaches,
): Promise<MatchOutcome> {
  switch (item.type) {
    case 'movie':
      if (!item.movie) return { ok: false, reason: 'Missing movie payload' }
      return matchMovie(db, provider, item.movie, locale)
    case 'show': {
      if (!item.show) return { ok: false, reason: 'Missing show payload' }
      const result = await matchShow(db, provider, item.show, locale, caches)
      if (!result.ok) return result
      return { ok: true, entityType: 'show', entityId: result.show.id, title: result.show.title }
    }
    case 'episode':
      if (!item.show || !item.episode) return { ok: false, reason: 'Missing episode payload' }
      return matchEpisode(db, provider, item.show, item.episode, locale, caches)
    case 'season':
      return {
        ok: false,
        reason: 'Season-level ratings/watchlist entries are not yet supported',
        title: item.show?.title,
        show: item.show?.title,
        season: item.season?.number,
      }
    default:
      return { ok: false, reason: `Unknown Trakt item type: ${item.type}` }
  }
}
