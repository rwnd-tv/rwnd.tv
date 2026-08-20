import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { externalIds, seasons, shows } from '@rwnd/db'
import { createMetadataProvider } from '../providers/index.js'
import { loadEnv } from '../env.js'
import { runMetadataRefresh } from '../metadata/refresh.js'
import { resetDb, testDb } from './helpers.js'

const db = testDb()
const provider = createMetadataProvider(loadEnv())

function tmdbShowResponse(overrides: {
  id: number
  status: string
  genres?: string[]
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
    seasons: overrides.seasons.map((s) => ({
      season_number: s.season_number,
      name: `Season ${s.season_number}`,
      episode_count: s.episode_count,
      air_date: '2020-01-01',
      poster_path: '/season.jpg',
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
    await db.insert(seasons).values({ showId: show.id, seasonNumber: 1, episodeCount: 5 })
  }
  return show
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
              seasons: [{ season_number: 1, episode_count: 8 }],
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await runMetadataRefresh(db, provider)
    expect(result.showsRefreshed).toBe(1)

    const [updated] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(updated?.status).toBe('Ended')
    expect(updated?.genres).toEqual(['Drama', 'Crime'])
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
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, provider)
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

    const result = await runMetadataRefresh(db, provider)
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
      vi.fn(
        async () =>
          new Response(
            // A new episode aired since the last check — same season, bigger count.
            tmdbShowResponse({
              id: 3,
              status: 'Returning Series',
              seasons: [{ season_number: 1, episode_count: 9 }],
            }),
            { status: 200 },
          ),
      ),
    )

    const result = await runMetadataRefresh(db, provider)
    expect(result.showsRefreshed).toBe(1)

    const showSeasons = await db.select().from(seasons).where(eq(seasons.showId, show.id))
    expect(showSeasons).toHaveLength(1) // upserted in place, not a second row
    expect(showSeasons[0]?.episodeCount).toBe(9)
  })

  it('does not refetch an airing show that is not yet stale', async () => {
    await insertShow({
      tmdbId: 4,
      status: 'Returning Series',
      metadataRefreshedAt: new Date(Date.now() - 1 * DAY_MS), // within the 7-day interval
      withSeasons: true,
      genres: ['Drama'],
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, provider)
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

    const result = await runMetadataRefresh(db, provider)
    expect(result.showsRefreshed).toBe(1)
  })

  it('skips a show with no known TMDB id without crashing the sweep', async () => {
    await insertShow({ status: null, metadataRefreshedAt: new Date() }) // no tmdbId at all
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await runMetadataRefresh(db, provider)
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

    const result = await runMetadataRefresh(db, provider)
    expect(result.showsRefreshed).toBe(1) // the 404'd show doesn't count...
    const okSeasons = await db.select().from(seasons).where(eq(seasons.showId, ok.id))
    expect(okSeasons).toHaveLength(1) // ...but the other show still went through
  })
})
