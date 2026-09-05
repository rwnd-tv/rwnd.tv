import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { episodes, externalIds, movies, seasons, shows } from '@rwnd/db'
import { createMetadataProviders } from '../providers/index.js'
import { loadEnv } from '../env.js'
import type { MetadataProvider, ProviderSeason } from '../providers/types.js'
import { backfillShowEpisodeRuntimes, runMetadataRefresh } from '../metadata/refresh.js'
import { resetDb, testDb } from './helpers.js'

const db = testDb()
const provider = createMetadataProviders(loadEnv())[0]!

function tmdbShowResponse(overrides: {
  id: number
  status: string
  genres?: string[]
  voteAverage?: number
  seasons: Array<{ season_number: number; episode_count: number }>
}) {
  return JSON.stringify({
    id: overrides.id,
    name: `Show ${overrides.id}`,
    first_air_date: '2020-01-01',
    overview: 'An overview.',
    poster_path: '/poster.jpg',
    status: overrides.status,
    genres: (overrides.genres ?? []).map((name, i) => ({ id: i, name })),
    // vote_count > 0 whenever a test supplies a rating — TmdbProvider.getShow
    // treats a zero vote_count as "no rating" regardless of vote_average.
    vote_average: overrides.voteAverage,
    vote_count: overrides.voteAverage === undefined ? 0 : 100,
    seasons: overrides.seasons.map((s) => ({
      season_number: s.season_number,
      name: `Season ${s.season_number}`,
      episode_count: s.episode_count,
      air_date: '2020-01-01',
      poster_path: '/season.jpg',
    })),
  })
}

// Only hit for an airing show's current season — see refreshOneShow's doc
// comment in apps/api/src/metadata/refresh.ts. `seasonNumber` must match the
// season actually requested — refreshOneShow now persists these episodes via
// resolveSeason (apps/api/src/lib/media.ts), which stores/looks them up by
// season number, so a mismatch here silently makes them vanish from the
// query rather than just being an unused field.
function tmdbSeasonResponse(
  seasonNumber: number,
  episodes: Array<{ episode_number: number; air_date?: string; runtime?: number }>,
) {
  return JSON.stringify({
    overview: 'A season overview.',
    episodes: episodes.map((e) => ({
      name: `Episode ${e.episode_number}`,
      season_number: seasonNumber,
      episode_number: e.episode_number,
      air_date: e.air_date,
      runtime: e.runtime,
    })),
  })
}

async function insertShow(opts: {
  tmdbId?: number
  status?: string | null
  metadataRefreshedAt: Date
  withSeasons?: boolean
  /** Defaults to empty, same as a real row before its first fetch — tests
   * that assert "should NOT be refetched" need to set this explicitly, or
   * they're really just re-testing the empty-genres backfill clause. */
  genres?: string[]
  /** Defaults to null, same as a real row before its first fetch — same
   * "should NOT be refetched" caveat as `genres` above, for the
   * never-had-a-rating-fetched backfill clause. */
  voteAverage?: number | null
  /** Defaults to null (same as a real season row before its first
   * aired-count computation) whenever `withSeasons` is set — same "should
   * NOT be refetched" caveat as `genres`/`voteAverage` above, for the
   * never-had-an-aired-count-computed backfill clause. */
  airedEpisodeCount?: number | null
}) {
  const [show] = await db
    .insert(shows)
    .values({
      title: 'Some Show',
      // Each call needs a distinct slug (shows.slug is unique) — the tmdb id
      // is a convenient distinguisher when set, otherwise a random one.
      slug: `some-show-${opts.tmdbId ?? crypto.randomUUID()}`,
      status: opts.status ?? null,
      metadataRefreshedAt: opts.metadataRefreshedAt,
      genres: opts.genres ?? [],
      voteAverage: opts.voteAverage ?? null,
    })
    .returning()
  if (!show) throw new Error('failed to insert show')
  if (opts.tmdbId !== undefined) {
    await db.insert(externalIds).values({
      entityType: 'show',
      entityId: show.id,
      source: 'tmdb',
      externalId: String(opts.tmdbId),
    })
  }
  if (opts.withSeasons) {
    await db.insert(seasons).values({
      showId: show.id,
      seasonNumber: 1,
      episodeCount: 5,
      airedEpisodeCount: opts.airedEpisodeCount ?? null,
    })
  }
  return show
}

function tmdbMovieResponse(overrides: { id: number; genres?: string[]; voteAverage?: number }) {
  return JSON.stringify({
    id: overrides.id,
    title: `Movie ${overrides.id}`,
    release_date: '2020-01-01',
    runtime: 100,
    overview: 'An overview.',
    poster_path: '/poster.jpg',
    genres: (overrides.genres ?? []).map((name, i) => ({ id: i, name })),
    // Same "vote_count > 0 whenever a rating is supplied" convention as
    // tmdbShowResponse above — TmdbProvider.getMovie treats a zero
    // vote_count as "no rating" regardless of vote_average.
    vote_average: overrides.voteAverage,
    vote_count: overrides.voteAverage === undefined ? 0 : 100,
  })
}

async function insertMovie(opts: {
  tmdbId?: number
  metadataRefreshedAt: Date
  /** Defaults to empty, same as a real row before its first fetch — tests
   * that assert "should NOT be refetched" need to set this explicitly, or
   * they're really just re-testing the empty-genres backfill clause. */
  genres?: string[]
  /** Defaults to null, same as a real row before its first fetch — same
   * "should NOT be refetched" caveat as `genres` above. */
  voteAverage?: number | null
}) {
  const [movie] = await db
    .insert(movies)
    .values({
      title: 'Some Movie',
      // Each call needs a distinct slug (movies.slug is unique) — same
      // convention as insertShow's slug above.
      slug: `some-movie-${opts.tmdbId ?? crypto.randomUUID()}`,
      metadataRefreshedAt: opts.metadataRefreshedAt,
      genres: opts.genres ?? [],
      voteAverage: opts.voteAverage ?? null,
    })
    .returning()
  if (!movie) throw new Error('failed to insert movie')
  if (opts.tmdbId !== undefined) {
    await db.insert(externalIds).values({
      entityType: 'movie',
      entityId: movie.id,
      source: 'tmdb',
      externalId: String(opts.tmdbId),
    })
  }
  return movie
}

const DAY_MS = 24 * 60 * 60 * 1000

describe('metadata refresh', () => {
  beforeEach(() => resetDb(db))
  afterEach(() => vi.unstubAllGlobals())

  it('backfills a show with no cached season data, regardless of status/age', async () => {
    const show = await insertShow({ tmdbId: 1, status: null, metadataRefreshedAt: new Date() })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            tmdbShowResponse({
              id: 1,
              status: 'Ended',
              genres: ['Drama', 'Crime'],
              voteAverage: 8.7,
              seasons: [{ season_number: 1, episode_count: 8 }],
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const [updated] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(updated?.status).toBe('Ended')
    expect(updated?.genres).toEqual(['Drama', 'Crime'])
    expect(updated?.voteAverage).toBe(8.7)
    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    expect(showSeasons).toHaveLength(1)
    expect(showSeasons[0]?.episodeCount).toBe(8)
  })

  it('does not refetch an ended show that was recently refreshed', async () => {
    await insertShow({
      tmdbId: 2,
      status: 'Ended',
      metadataRefreshedAt: new Date(),
      withSeasons: true,
      genres: ['Drama'],
      voteAverage: 8.1,
      airedEpisodeCount: 5,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression: `genres` was added to `shows` after `seasons` had already
  // been backfilled for existing shows in production. Those shows had
  // seasons + a recent metadataRefreshedAt, so the "recently refreshed"
  // case just above would otherwise skip them forever — leaving genres
  // empty until their next airing/compliance-driven refresh, up to ~5
  // months away for an ended show. Caught live on dev.rwnd.tv 2026-08-19.
  it('refetches a recently-refreshed, seasons-cached show if it has no genres yet', async () => {
    const show = await insertShow({
      tmdbId: 9,
      status: 'Ended',
      metadataRefreshedAt: new Date(), // fresh — would be skipped by staleness alone
      withSeasons: true, // has seasons — would be skipped by the seasons-missing clause alone
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            tmdbShowResponse({
              id: 9,
              status: 'Ended',
              genres: ['Comedy'],
              seasons: [{ season_number: 1, episode_count: 5 }],
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)
    const [updated] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(updated?.genres).toEqual(['Comedy'])
  })

  it('refetches an airing show once it goes stale, upserting rather than duplicating seasons', async () => {
    const show = await insertShow({
      tmdbId: 3,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 10 * DAY_MS), // past the 7-day airing interval
      withSeasons: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/3/season/1') {
          // 2 aired, 1 not yet — this show is still airing.
          return new Response(
            tmdbSeasonResponse(1, [
              { episode_number: 1, air_date: '2020-01-01' },
              { episode_number: 2, air_date: '2020-01-08' },
              { episode_number: 3, air_date: '2099-01-01' },
            ]),
            { status: 200 },
          )
        }
        // A new episode aired since the last check — same season, bigger count.
        return new Response(
          tmdbShowResponse({
            id: 3,
            status: 'Returning Series',
            seasons: [{ season_number: 1, episode_count: 9 }],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    expect(showSeasons).toHaveLength(1) // upserted in place, not a second row
    expect(showSeasons[0]?.episodeCount).toBe(9)
    // Only 2 of the season's (eventual) 9 episodes have actually aired.
    expect(showSeasons[0]?.airedEpisodeCount).toBe(2)
  })

  // The point of routing the airedEpisodeCount fetch through resolveSeason
  // (apps/api/src/lib/media.ts) rather than calling provider.getSeason()
  // directly: a show nobody's opened a season/episode page for recently used
  // to never get per-episode rows persisted at all, no matter how long it
  // aired for (docs/TODO_ARCHIVE.md). Confirms the sweep itself now leaves
  // real `episodes` rows behind, not just a season-level count.
  it('persists per-episode rows for the currently-airing season during the background sweep', async () => {
    const show = await insertShow({
      tmdbId: 11,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 10 * DAY_MS),
      withSeasons: false,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/11/season/1') {
          return new Response(
            tmdbSeasonResponse(1, [
              { episode_number: 1, air_date: '2020-01-01' },
              { episode_number: 2, air_date: '2099-01-01' },
            ]),
            { status: 200 },
          )
        }
        return new Response(
          tmdbShowResponse({
            id: 11,
            status: 'Returning Series',
            seasons: [{ season_number: 1, episode_count: 2 }],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const showEpisodes = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, 1)))
    expect(showEpisodes).toHaveLength(2)
    const byNumber = new Map(showEpisodes.map((e) => [e.episodeNumber, e]))
    expect(byNumber.get(1)?.firstAired).toBe('2020-01-01')
    expect(byNumber.get(2)?.firstAired).toBe('2099-01-01')
  })

  // A1 of the cross-provider runtime fallback (docs/adr/0006's 2026-09-05
  // update): resolveSeason's onConflictDoUpdate coalesces a still-null
  // runtimeMinutes from the same provider on a later resolve, but must
  // never overwrite one already recorded — including one the runtime
  // backfill below filled from a *different* provider, which this same-
  // provider path has no way to judge against its own (possibly
  // differently-numbered) episode list.
  it('fills a previously-null episode runtime from the primary provider on a later resolve, without overwriting an existing one', async () => {
    const show = await insertShow({
      tmdbId: 12,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 10 * DAY_MS),
      withSeasons: false,
    })
    await db.insert(episodes).values([
      { showId: show.id, seasonNumber: 1, episodeNumber: 1, runtimeMinutes: 40 },
      { showId: show.id, seasonNumber: 1, episodeNumber: 2, runtimeMinutes: null },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/12/season/1') {
          return new Response(
            tmdbSeasonResponse(1, [
              // TMDB now claims a different runtime for episode 1 — must
              // not clobber the value already on record.
              { episode_number: 1, air_date: '2020-01-01', runtime: 999 },
              { episode_number: 2, air_date: '2020-01-08', runtime: 25 },
            ]),
            { status: 200 },
          )
        }
        return new Response(
          tmdbShowResponse({
            id: 12,
            status: 'Returning Series',
            seasons: [{ season_number: 1, episode_count: 2 }],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const showEpisodes = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.showId, show.id), eq(episodes.seasonNumber, 1)))
    const byNumber = new Map(showEpisodes.map((e) => [e.episodeNumber, e]))
    expect(byNumber.get(1)?.runtimeMinutes).toBe(40)
    expect(byNumber.get(2)?.runtimeMinutes).toBe(25)
  })

  it('sets airedEpisodeCount to the full episodeCount for a finished show, without an extra season fetch', async () => {
    const show = await insertShow({
      tmdbId: 7,
      status: 'Ended',
      metadataRefreshedAt: new Date(Date.now() - 200 * DAY_MS),
      withSeasons: true,
    })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          tmdbShowResponse({
            id: 7,
            status: 'Ended',
            seasons: [{ season_number: 1, episode_count: 8 }],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    // Ended means every episode necessarily aired — no /season/1 call needed
    // to figure that out.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    expect(showSeasons[0]?.airedEpisodeCount).toBe(8)
  })

  it('assumes a past season of an airing show already aired in full, without fetching it', async () => {
    const show = await insertShow({
      tmdbId: 8,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 10 * DAY_MS),
      withSeasons: false,
    })
    // Pre-existing season 1, already fully aired from a past refresh.
    await db.insert(seasons).values({
      showId: show.id,
      seasonNumber: 1,
      episodeCount: 8,
      airedEpisodeCount: 8,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/8/season/2') {
          return new Response(
            tmdbSeasonResponse(2, [
              { episode_number: 1, air_date: '2026-01-01' },
              { episode_number: 2, air_date: '2099-01-01' },
            ]),
            { status: 200 },
          )
        }
        if (url.pathname === '/3/tv/8/season/1') {
          throw new Error('season 1 should not be refetched — it already aired in full')
        }
        return new Response(
          tmdbShowResponse({
            id: 8,
            status: 'Returning Series',
            seasons: [
              { season_number: 1, episode_count: 8 },
              { season_number: 2, episode_count: 10 },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    const bySeason = new Map(showSeasons.map((s) => [s.seasonNumber, s]))
    expect(bySeason.get(1)?.airedEpisodeCount).toBe(8)
    expect(bySeason.get(2)?.airedEpisodeCount).toBe(1) // only the latest season got fetched
  })

  // Regression: TMDB can list an announced-but-empty future season
  // (episodeCount 0, no episodes populated yet) alongside the season
  // that's actually still airing. Confirmed live against Silo — season 4
  // was such a placeholder while season 3 (the real "latest" season with
  // episodes) was still airing. Picking season 4 as "latest" by season
  // number alone would fetch its (empty) episode list instead of season
  // 3's, and season 3 would wrongly be assumed fully aired.
  it('treats an announced-but-empty future season as not-yet-latest, so the real airing season still gets its per-episode fetch', async () => {
    const show = await insertShow({
      tmdbId: 10,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 10 * DAY_MS),
      withSeasons: false,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/10/season/3') {
          return new Response(
            tmdbSeasonResponse(3, [
              { episode_number: 1, air_date: '2020-01-01' },
              { episode_number: 2, air_date: '2099-01-01' },
            ]),
            { status: 200 },
          )
        }
        if (url.pathname === '/3/tv/10/season/4') {
          throw new Error('season 4 is an empty placeholder — it should never be fetched')
        }
        return new Response(
          tmdbShowResponse({
            id: 10,
            status: 'Returning Series',
            seasons: [
              { season_number: 3, episode_count: 10 },
              { season_number: 4, episode_count: 0 },
            ],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)

    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    const bySeason = new Map(showSeasons.map((s) => [s.seasonNumber, s]))
    // Only 1 of season 3's (eventual) 10 episodes has actually aired.
    expect(bySeason.get(3)?.airedEpisodeCount).toBe(1)
    expect(bySeason.get(4)?.airedEpisodeCount).toBe(0)
  })

  it('does not refetch an airing show that is not yet stale', async () => {
    await insertShow({
      tmdbId: 4,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 1 * DAY_MS), // within the 7-day interval
      withSeasons: true,
      genres: ['Drama'],
      voteAverage: 7.4,
      airedEpisodeCount: 5,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches an ended show once it crosses the TMDB compliance age, even though it is not airing', async () => {
    await insertShow({
      tmdbId: 5,
      status: 'Ended',
      metadataRefreshedAt: new Date(Date.now() - 200 * DAY_MS), // past the ~5 month compliance cutoff
      withSeasons: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            tmdbShowResponse({
              id: 5,
              status: 'Ended',
              seasons: [{ season_number: 1, episode_count: 5 }],
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1)
  })

  it('skips a show with no known TMDB id without crashing the sweep', async () => {
    await insertShow({ status: null, metadataRefreshedAt: new Date() }) // no tmdbId at all
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a show whose only external id is from a source none of the configured providers use', async () => {
    // Distinct from the "no known TMDB id at all" case above — this show
    // does have an external id, just not from any provider this instance
    // has configured (the test env only ever configures TMDB). Simulates
    // an id backfilled from a Trakt import (docs/adr/0006's import-match
    // work stores imdb/tvdb ids opportunistically) that no provider here
    // can act on yet.
    const show = await insertShow({ status: null, metadataRefreshedAt: new Date() })
    await db.insert(externalIds).values({
      entityType: 'show',
      entityId: show.id,
      source: 'imdb',
      externalId: 'tt0000001',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("one show's TMDB failure does not stop the rest of the sweep from being refreshed", async () => {
    await insertShow({ tmdbId: 404, status: null, metadataRefreshedAt: new Date() })
    const ok = await insertShow({ tmdbId: 6, status: null, metadataRefreshedAt: new Date() })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(input)
        if (url.pathname === '/3/tv/404') {
          return new Response('{"status_message":"Not Found"}', { status: 404 })
        }
        return new Response(
          tmdbShowResponse({
            id: 6,
            status: 'Ended',
            seasons: [{ season_number: 1, episode_count: 5 }],
          }),
          { status: 200 },
        )
      }),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.showsRefreshed).toBe(1) // the 404'd show doesn't count...
    const okSeasons = await db.select().from(seasons).where(eq(seasons.showId, ok.id))
    expect(okSeasons).toHaveLength(1) // ...but the other show still went through
  })

  // Same backfill-gap regression class as the shows genres test above,
  // applied to movies — findStaleMovies needs its own "never populated"
  // clauses or every movie that predates the genres/voteAverage columns
  // would sit unrefreshed for up to ~5 months.
  it('refetches a recently-refreshed movie if it has no genres yet', async () => {
    const movie = await insertMovie({ tmdbId: 20, metadataRefreshedAt: new Date() })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(tmdbMovieResponse({ id: 20, genres: ['Action'] }), { status: 200 }),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.moviesRefreshed).toBe(1)
    const [updated] = await db.select().from(movies).where(eq(movies.id, movie.id))
    expect(updated?.genres).toEqual(['Action'])
  })

  it('refetches a recently-refreshed movie if it has no rating yet', async () => {
    const movie = await insertMovie({
      tmdbId: 21,
      metadataRefreshedAt: new Date(),
      genres: ['Drama'], // already has genres — only the rating clause should catch this
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(tmdbMovieResponse({ id: 21, genres: ['Drama'], voteAverage: 7.5 }), {
            status: 200,
          }),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.moviesRefreshed).toBe(1)
    const [updated] = await db.select().from(movies).where(eq(movies.id, movie.id))
    expect(updated?.voteAverage).toBe(7.5)
  })

  it('does not refetch a fully-populated movie that was recently refreshed', async () => {
    await insertMovie({
      tmdbId: 22,
      metadataRefreshedAt: new Date(),
      genres: ['Comedy'],
      voteAverage: 6.9,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.moviesRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches a fully-populated movie once it crosses the TMDB compliance age', async () => {
    await insertMovie({
      tmdbId: 23,
      metadataRefreshedAt: new Date(Date.now() - 200 * DAY_MS), // past the ~5 month compliance cutoff
      genres: ['Horror'],
      voteAverage: 5.5,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(tmdbMovieResponse({ id: 23, genres: ['Horror'], voteAverage: 5.5 }), {
            status: 200,
          }),
      ),
    )

    const result = await runMetadataRefresh(db, [provider])
    expect(result.moviesRefreshed).toBe(1)
  })

  it('skips a movie with no known TMDB id without crashing the sweep', async () => {
    await insertMovie({ metadataRefreshedAt: new Date() }) // no tmdbId at all
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, [provider])
    expect(result.moviesRefreshed).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('cross-provider episode runtime backfill', () => {
    /**
     * A fake second provider whose `getSeason` is fully test-controlled —
     * same "hand-construct rather than go through env" reasoning as
     * imports.test.ts's own fakeTvdbProvider, but parameterized per test
     * since each test here needs a different season shape to exercise the
     * numbering guard (Gate A/B in fillSeasonRuntimesFromFallback,
     * apps/api/src/metadata/refresh.ts).
     */
    function fakeTvdbProvider(getSeason: MetadataProvider['getSeason']): MetadataProvider {
      return {
        source: 'tvdb',
        async searchMulti() {
          return []
        },
        async getMovie() {
          throw new Error('not used by these tests')
        },
        async getShow() {
          throw new Error('not used by these tests')
        },
        async getEpisode() {
          throw new Error('not used by these tests')
        },
        async findByExternalId() {
          return null
        },
        getSeason,
      }
    }

    /**
     * A show set up to dodge every OTHER backfill/sweep clause
     * (findStaleShows, the IMDb backfill, the overview backfill) so a test
     * here exercises only the runtime backfill — same reasoning as
     * insertShow's own "should NOT be refetched" options, extended with a
     * real season+episodes fixture and an optional `tvdbId` external id.
     */
    async function insertShowNeedingRuntimeBackfill(opts: {
      tmdbId: number
      tvdbId?: string
      seasonNumber?: number
      episodeCount: number
      episodes: Array<{ episodeNumber: number; runtimeMinutes: number | null; firstAired?: string }>
    }) {
      const seasonNumber = opts.seasonNumber ?? 1
      const show = await insertShow({
        tmdbId: opts.tmdbId,
        status: null,
        metadataRefreshedAt: new Date(),
        genres: ['Drama'],
        voteAverage: 5,
      })
      if (opts.tvdbId !== undefined) {
        await db.insert(externalIds).values({
          entityType: 'show',
          entityId: show.id,
          source: 'tvdb',
          externalId: opts.tvdbId,
        })
      }
      await db.insert(seasons).values({
        showId: show.id,
        seasonNumber,
        episodeCount: opts.episodeCount,
        airedEpisodeCount: opts.episodeCount,
      })
      const rows = await db
        .insert(episodes)
        .values(
          opts.episodes.map((e) => ({
            showId: show.id,
            seasonNumber,
            episodeNumber: e.episodeNumber,
            runtimeMinutes: e.runtimeMinutes,
            firstAired: e.firstAired ?? null,
            // Already checked — keeps this show off the IMDb/overview
            // backfills' own candidate lists, which are otherwise keyed
            // on exactly the same "checked_at IS NULL" shape this test
            // deliberately wants to isolate to runtime alone.
            overviewCheckedAt: new Date(),
            imdbCheckedAt: new Date(),
          })),
        )
        .returning()
      return { show, episodes: rows }
    }

    function fakeSeason(
      episodes: Array<{
        episodeNumber: number
        runtimeMinutes: number | null
        firstAired?: string
      }>,
    ): ProviderSeason {
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: episodes.map((e) => ({
          title: null,
          seasonNumber: 1,
          episodeNumber: e.episodeNumber,
          runtimeMinutes: e.runtimeMinutes,
          firstAired: e.firstAired ?? null,
          overview: null,
          stillPath: null,
          voteAverage: null,
          externalId: null,
          imdbId: null,
        })),
      }
    }

    it('fills a null runtime from the fallback provider when both gates pass', async () => {
      const { show, episodes: rows } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 200,
        tvdbId: '900',
        episodeCount: 2,
        episodes: [
          { episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' },
          { episodeNumber: 2, runtimeMinutes: 20, firstAired: '2020-01-08' },
        ],
      })
      const tvdb = fakeTvdbProvider(async () =>
        fakeSeason([
          { episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-01' },
          { episodeNumber: 2, runtimeMinutes: 99, firstAired: '2020-01-08' },
        ]),
      )

      const result = await runMetadataRefresh(db, [provider, tvdb])
      expect(result.episodeRuntimeSeasonsFilled).toBe(1)

      const updated = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      const byNumber = new Map(updated.map((e) => [e.episodeNumber, e]))
      expect(byNumber.get(1)?.runtimeMinutes).toBe(24)
      expect(byNumber.get(1)?.runtimeCheckedAt).not.toBeNull()
      // Episode 2 already had a runtime — never overwritten, even though
      // the fallback provider returned a different value for it.
      expect(byNumber.get(2)?.runtimeMinutes).toBe(20)
      expect(rows.find((e) => e.episodeNumber === 2)?.runtimeMinutes).toBe(20)
    })

    it('Gate A rejects a season-count mismatch, leaving runtime null but marking it checked', async () => {
      const { show } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 201,
        tvdbId: '901',
        episodeCount: 2, // cached locally as 2 episodes
        episodes: [{ episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' }],
      })
      const tvdb = fakeTvdbProvider(async () =>
        fakeSeason([
          // The fallback thinks this season has 3 episodes — a shape
          // mismatch against the locally cached count of 2.
          { episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-01' },
          { episodeNumber: 2, runtimeMinutes: 20, firstAired: '2020-01-08' },
          { episodeNumber: 3, runtimeMinutes: 18, firstAired: '2020-01-15' },
        ]),
      )

      const result = await runMetadataRefresh(db, [provider, tvdb])
      expect(result.episodeRuntimeSeasonsFilled).toBe(0)

      const [updated] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      expect(updated?.runtimeMinutes).toBeNull()
      expect(updated?.runtimeCheckedAt).not.toBeNull()
    })

    it('Gate B rejects a genuine air-date mismatch while other episodes in the season still fill', async () => {
      const { show } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 202,
        tvdbId: '902',
        episodeCount: 2,
        episodes: [
          { episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' },
          { episodeNumber: 2, runtimeMinutes: null, firstAired: '2020-01-08' },
        ],
      })
      const tvdb = fakeTvdbProvider(async () =>
        fakeSeason([
          // A week off — well past AIR_DATE_TOLERANCE_DAYS, so this one
          // episode must not fill even though the season shape (Gate A)
          // matches.
          { episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-08' },
          { episodeNumber: 2, runtimeMinutes: 20, firstAired: '2020-01-08' },
        ]),
      )

      const result = await runMetadataRefresh(db, [provider, tvdb])
      expect(result.episodeRuntimeSeasonsFilled).toBe(1)

      const updated = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      const byNumber = new Map(updated.map((e) => [e.episodeNumber, e]))
      expect(byNumber.get(1)?.runtimeMinutes).toBeNull()
      expect(byNumber.get(1)?.runtimeCheckedAt).not.toBeNull()
      expect(byNumber.get(2)?.runtimeMinutes).toBe(20)
    })

    // Regression: confirmed live against Keep Your Hands Off Eizouken! —
    // TVDB and IMDb agreed on 2020-01-06 for its episode 1, TMDB alone
    // recorded 2020-01-05, most likely a JST-midnight rounding quirk in
    // TMDB's own data. A same-day-give-or-take-one disagreement like this
    // must still fill; only a real mismatch (Gate B's other test above)
    // should block.
    it('Gate B tolerates a one-day air-date difference between providers', async () => {
      const { show } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 206,
        tvdbId: '906',
        episodeCount: 1,
        episodes: [{ episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-05' }],
      })
      const tvdb = fakeTvdbProvider(async () =>
        fakeSeason([{ episodeNumber: 1, runtimeMinutes: 25, firstAired: '2020-01-06' }]),
      )

      const result = await runMetadataRefresh(db, [provider, tvdb])
      expect(result.episodeRuntimeSeasonsFilled).toBe(1)

      const [updated] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      expect(updated?.runtimeMinutes).toBe(25)
    })

    it('the drain terminates — a second run makes zero further fallback-provider calls', async () => {
      await insertShowNeedingRuntimeBackfill({
        tmdbId: 203,
        tvdbId: '903',
        episodeCount: 1,
        episodes: [{ episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' }],
      })
      const getSeason = vi.fn(async () =>
        fakeSeason([{ episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-01' }]),
      )
      const tvdb = fakeTvdbProvider(getSeason)

      const first = await runMetadataRefresh(db, [provider, tvdb])
      expect(first.episodeRuntimeSeasonsFilled).toBe(1)
      expect(getSeason).toHaveBeenCalledTimes(1)

      const second = await runMetadataRefresh(db, [provider, tvdb])
      expect(second.episodeRuntimeSeasonsFilled).toBe(0)
      expect(getSeason).toHaveBeenCalledTimes(1) // no further calls
    })

    it('skips a show with no fallback-provider id, without marking its episodes checked', async () => {
      const { show } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 204,
        // No tvdbId at all — nothing for the fallback to resolve to.
        episodeCount: 1,
        episodes: [{ episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' }],
      })
      const getSeason = vi.fn(async () =>
        fakeSeason([{ episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-01' }]),
      )
      const tvdb = fakeTvdbProvider(getSeason)

      const result = await runMetadataRefresh(db, [provider, tvdb])
      expect(result.episodeRuntimeSeasonsFilled).toBe(0)
      expect(getSeason).not.toHaveBeenCalled()

      const [updated] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      expect(updated?.runtimeMinutes).toBeNull()
      expect(updated?.runtimeCheckedAt).toBeNull()
    })

    it("backfillShowEpisodeRuntimes fixes one show's runtimes immediately, for the manual refresh button", async () => {
      const { show } = await insertShowNeedingRuntimeBackfill({
        tmdbId: 205,
        tvdbId: '905',
        episodeCount: 1,
        episodes: [{ episodeNumber: 1, runtimeMinutes: null, firstAired: '2020-01-01' }],
      })
      const tvdb = fakeTvdbProvider(async () =>
        fakeSeason([{ episodeNumber: 1, runtimeMinutes: 24, firstAired: '2020-01-01' }]),
      )

      const filled = await backfillShowEpisodeRuntimes(db, show.id, [provider, tvdb], 'en-US')
      expect(filled).toBe(1)

      const [updated] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
      expect(updated?.runtimeMinutes).toBe(24)
    })
  })
})
