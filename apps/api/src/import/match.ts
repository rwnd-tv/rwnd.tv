import { and, eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { episodes, externalIds, movies, shows } from '@rwnd/db'
import type { MetadataProvider } from '../providers/types.js'
import { pickRefreshTarget } from '../metadata/refresh.js'
import { resolveMovie, resolveShow } from '../lib/media.js'
import type { TraktEpisode, TraktIds, TraktMovie, TraktSeason, TraktShow } from '../trakt/types.js'

/**
 * Matches Trakt-sourced items against rwnd.tv's local records, via
 * `external_ids` — this is the mechanism ADR 0002 was designed for. A hit
 * against a `trakt` row means a previous import already resolved this item
 * (no network call); otherwise it tries each configured provider in
 * priority order (docs/adr/0006), and for each one: that provider's own
 * field on Trakt's `ids` (e.g. `ids.tmdb` for TMDB, `ids.tvdb` for TVDB)
 * first, then — if that's absent, or present but rejected by the provider
 * (merged/deleted/wrong id) — a reverse lookup on Trakt's `imdb`/other-
 * provider id via `provider.findByExternalId`. Only once every configured
 * provider has been tried this way is the item reported unmatched. Either
 * way, every id Trakt handed us gets backfilled (`trakt`, plus `imdb`/`tvdb`
 * when present) so the next import — or a webhook — hits the fast path.
 * Trakt's `slug` isn't stored: it's an alternate identifier *within*
 * Trakt's own system, not a separate external source, so it doesn't fit
 * `external_id_source`'s model of "which other system does this id belong
 * to."
 *
 * Cross-provider fallback fixes the common case where the item's primary-
 * provider id is missing or stale but a *different* configured provider
 * does hold a matching entry — it does **not** help when a title genuinely
 * has no entry under any id, on any configured provider (Formula 1 via
 * Trakt is the motivating example — neither TMDB nor TVDB carry it at all).
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
  /** The provider (and its own id for this show) episode-level lookups
   * should use — the one whose id actually resolved the show, or (for a
   * show that was already resolved by a prior import) the highest-priority
   * configured provider with a recorded id for it, same convention as
   * pickRefreshTarget (apps/api/src/metadata/refresh.ts). Null if no
   * configured provider has a findable id for this show at all — e.g. it
   * was matched purely by a previously-backfilled trakt id and no provider
   * ever had a match for it under any id — in which case episodes under it
   * can't be resolved. */
  provider: MetadataProvider | null
  providerExternalId: string | null
}

/**
 * Per-job caches so a show with many watched/rated/listed episodes only
 * triggers one provider request per show and per season, not one per
 * episode. Both cache failures as well as successes — a show whose lookup
 * fails against every configured provider fails identically for every
 * episode under it, so without `showFailures` a show with N watched
 * episodes makes N redundant failing request sequences instead of one
 * (found live: a single unresolvable show accounted for 200+ consecutive
 * failures on a real import).
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

function describeProviderError(provider: MetadataProvider | null, err: unknown): string {
  const label = provider ? provider.source.toUpperCase() : 'Metadata'
  return err instanceof Error ? `${label} lookup failed: ${err.message}` : `${label} lookup failed`
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

/** This provider's own field on a Trakt id bundle — `ids.tmdb` for TMDB,
 * `ids.tvdb` for TVDB — distinct from the *other* ids `findViaAlternateIds`
 * below tries as a same-provider reverse-lookup fallback. */
function ownTraktId(provider: MetadataProvider, ids: TraktIds): string | null {
  const id = ids[provider.source]
  return id ? String(id) : null
}

/** Tries Trakt's `imdb` id, then its `tvdb` id (skipped when `provider`
 * *is* TVDB — reverse-looking-up a TVDB id against TVDB itself would be a
 * pointless self-referential call, already covered by `ownTraktId` above),
 * against `provider.findByExternalId`, returning the first hit. `imdb`
 * covers both movies and shows; `tvdb` is TV-only in practice, but there's
 * no harm asking either provider method for either entity type — the
 * provider itself returns null for a source it can't reverse-lookup. */
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
  if (ids.tvdb && provider.source !== 'tvdb') {
    const found = await provider.findByExternalId(entityType, 'tvdb', String(ids.tvdb), locale)
    if (found) return found
  }
  return null
}

/**
 * Shared by matchMovie/matchShow: walks `providers` in priority order and,
 * for each one, tries `resolve` against that provider's own Trakt id first
 * (`ownTraktId`), then — whether that was absent, or present but rejected
 * by the provider (merged/deleted/wrong id) — whatever
 * `findViaAlternateIds` turns up for that same provider. Moves on to the
 * next provider only once the current one has been fully exhausted. The
 * `findByExternalId` call is only made when it's actually needed (no eager
 * lookup on the common path where a provider's own id just works), since
 * it's a live provider request. `error`/`provider` describe the *last*
 * attempt made, or are null if no candidate id was ever found to try
 * against any provider.
 */
async function resolveViaProvider<T>(
  resolve: (provider: MetadataProvider, providerExternalId: string) => Promise<T>,
  providers: MetadataProvider[],
  entityType: 'movie' | 'show',
  ids: TraktIds,
  locale: string,
): Promise<
  | { ok: true; value: T; provider: MetadataProvider; externalId: string }
  | { ok: false; error: unknown; provider: MetadataProvider | null }
> {
  let lastError: unknown = null
  let lastProvider: MetadataProvider | null = null
  for (const provider of providers) {
    const ownId = ownTraktId(provider, ids)
    if (ownId) {
      lastProvider = provider
      try {
        return { ok: true, value: await resolve(provider, ownId), provider, externalId: ownId }
      } catch (err) {
        lastError = err
      }
    }
    const alternateId = await findViaAlternateIds(provider, entityType, ids, locale)
    if (alternateId) {
      lastProvider = provider
      try {
        return {
          ok: true,
          value: await resolve(provider, alternateId),
          provider,
          externalId: alternateId,
        }
      } catch (err) {
        lastError = err
      }
    }
  }
  return { ok: false, error: lastError, provider: lastProvider }
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

function noMatchReason(kind: 'movie' | 'show', providers: MetadataProvider[]): string {
  const tried = providers.map((p) => p.source).join(', ')
  return `No match for this ${kind} from any configured metadata provider (tried: ${tried})`
}

export async function matchMovie(
  db: Database,
  providers: MetadataProvider[],
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
    (provider, externalId) => resolveMovie(db, provider, externalId, locale),
    providers,
    'movie',
    traktMovie.ids,
    locale,
  )
  if (!result.ok) {
    // Either no id resolvable by any means, or every provider rejected
    // every candidate id it was given (merged/deleted/wrong id) — either
    // way, a per-item failure, not a reason to abort the whole import.
    return {
      ok: false,
      reason: result.error
        ? describeProviderError(result.provider, result.error)
        : noMatchReason('movie', providers),
      title: traktMovie.title,
    }
  }
  const movie = result.value
  await backfillExternalIds(db, 'movie', movie.id, traktMovie.ids)
  return { ok: true, entityType: 'movie', entityId: movie.id, title: movie.title }
}

async function matchShow(
  db: Database,
  providers: MetadataProvider[],
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
      // Highest-priority configured provider with a recorded id for this
      // show — same convention pickRefreshTarget uses for the background
      // refresher, so episode-level lookups below land on a provider this
      // show is actually known to.
      const target = await pickRefreshTarget(db, 'show', show.id, providers)
      // Same reasoning as matchMovie's fast path above.
      await backfillExternalIds(db, 'show', show.id, traktShow.ids)
      return {
        ok: true,
        show: {
          id: show.id,
          title: show.title,
          provider: target?.provider ?? null,
          providerExternalId: target?.externalId ?? null,
        },
      }
    }
  }

  const result = await resolveViaProvider(
    (provider, externalId) => resolveShow(db, provider, externalId, locale),
    providers,
    'show',
    traktShow.ids,
    locale,
  )
  if (!result.ok) {
    const reason = result.error
      ? describeProviderError(result.provider, result.error)
      : noMatchReason('show', providers)
    // Cached even for the no-candidate-id case, not just a thrown resolve
    // error — a show with no findable id fails identically for every
    // watched episode under it, so without this a show with N episodes
    // makes N redundant resolution attempts instead of one.
    caches.showFailures.set(traktShow.ids.trakt, reason)
    return { ok: false, reason, title: traktShow.title }
  }
  const show = result.value
  await backfillExternalIds(db, 'show', show.id, traktShow.ids)
  return {
    ok: true,
    show: {
      id: show.id,
      title: show.title,
      provider: result.provider,
      providerExternalId: result.externalId,
    },
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
  providers: MetadataProvider[],
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

  const showResult = await matchShow(db, providers, traktShow, locale, caches)
  if (!showResult.ok) return episodeFailure(showResult.reason)
  const { show } = showResult

  const existing = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (existing) {
    await backfillExternalIds(db, 'episode', existing.id, traktEpisode.ids)
    return { ok: true, entityType: 'episode', entityId: existing.id, title: label }
  }

  if (!show.provider || !show.providerExternalId) {
    return episodeFailure('Show has no id from any configured provider, cannot resolve episode')
  }
  const { provider, providerExternalId } = show

  const seasonKey = `${show.id}:${traktEpisode.season}`
  if (!caches.seasons.has(seasonKey)) {
    try {
      const { episodes: seasonEpisodes } = await provider.getSeason(
        providerExternalId,
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
      // fast instead of re-hitting the provider for a season it's already
      // failed on.
      caches.seasons.set(seasonKey, describeProviderError(provider, err))
    }
  }

  const seasonFailure = caches.seasons.get(seasonKey)
  if (seasonFailure) {
    return episodeFailure(seasonFailure)
  }

  const resolved = await findLocalEpisode(db, show.id, traktEpisode.season, traktEpisode.number)
  if (!resolved) {
    return episodeFailure(`Episode not found in ${provider.source.toUpperCase()} season data`)
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
  providers: MetadataProvider[],
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
      return matchMovie(db, providers, item.movie, locale)
    case 'show': {
      if (!item.show) return { ok: false, reason: 'Missing show payload' }
      const result = await matchShow(db, providers, item.show, locale, caches)
      if (!result.ok) return result
      return { ok: true, entityType: 'show', entityId: result.show.id, title: result.show.title }
    }
    case 'episode':
      if (!item.show || !item.episode) return { ok: false, reason: 'Missing episode payload' }
      return matchEpisode(db, providers, item.show, item.episode, locale, caches)
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
