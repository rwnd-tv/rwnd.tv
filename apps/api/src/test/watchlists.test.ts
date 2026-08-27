import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { movies, shows, watchlistItems, watchlists } from '@rwnd/db'
import type {
  ListActivityResponse,
  ListWatchlistsResponse,
  MovieDetail,
  ShowDetail,
  WatchlistDetail,
  WatchlistMembershipStatus,
  WatchlistSummary,
} from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndCookie(email = 'watcher@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

async function seedShow(slug: string, title: string, posterPath: string | null = null) {
  const [show] = await db.insert(shows).values({ title, slug, posterPath }).returning()
  if (!show) throw new Error('failed to insert show')
  return show
}

async function seedMovie(slug: string, title: string) {
  const [movie] = await db.insert(movies).values({ title, slug }).returning()
  if (!movie) throw new Error('failed to insert movie')
  return movie
}

describe('watchlists', () => {
  beforeEach(() => resetDb(db))

  it('requires authentication', async () => {
    expect((await app.request('/api/v1/watchlists')).status).toBe(401)
    expect((await app.request('/api/v1/watchlists', { method: 'POST' })).status).toBe(401)
  })

  it('gives every new account exactly one Default list, un-renameable and un-deletable', async () => {
    const cookie = await createUserAndCookie()

    const res = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const body = await json<ListWatchlistsResponse>(res)
    expect(body.watchlists).toEqual([
      {
        id: expect.any(String),
        name: 'Default',
        isDefault: true,
        itemCount: 0,
        coverPosterPath: null,
      },
    ])
    const defaultId = body.watchlists[0]!.id

    const renameRes = await app.request(`/api/v1/watchlists/${defaultId}`, {
      method: 'PATCH',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Not Default' }),
    })
    expect(renameRes.status).toBe(400)

    const deleteRes = await app.request(`/api/v1/watchlists/${defaultId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(deleteRes.status).toBe(400)
  })

  it('creates a custom list, rejects a duplicate name, and lets it be renamed and deleted', async () => {
    const cookie = await createUserAndCookie()

    const createRes = await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cool Sci-fi Stuff!' }),
    })
    expect(createRes.status).toBe(201)
    const created = await json<WatchlistSummary>(createRes)
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Cool Sci-fi Stuff!',
      isDefault: false,
      itemCount: 0,
      coverPosterPath: null,
    })

    const dupRes = await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cool Sci-fi Stuff!' }),
    })
    expect(dupRes.status).toBe(409)

    const renameRes = await app.request(`/api/v1/watchlists/${created.id}`, {
      method: 'PATCH',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed List' }),
    })
    expect(renameRes.status).toBe(200)
    expect((await json<WatchlistSummary>(renameRes)).name).toBe('Renamed List')

    const deleteRes = await app.request(`/api/v1/watchlists/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(deleteRes.status).toBe(204)

    const listRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    expect((await json<ListWatchlistsResponse>(listRes)).watchlists).toHaveLength(1)
  })

  it('two different users can each have a list with the same name', async () => {
    const cookieA = await createUserAndCookie('a@example.com')
    await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
    })
    const cookieB = extractCookie(loginB)!

    for (const cookie of [cookieA, cookieB]) {
      const res = await app.request('/api/v1/watchlists', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Cool Sci-fi Stuff!' }),
      })
      expect(res.status).toBe(201)
    }
  })

  it('adds a show to the Default list with one call, idempotently, without disturbing the original listedAt', async () => {
    const cookie = await createUserAndCookie()
    const show = await seedShow('breaking-bad', 'Breaking Bad')

    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultId = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id

    const addRes = await app.request(`/api/v1/library/shows/breaking-bad/watchlists/${defaultId}`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(addRes.status).toBe(200)
    expect(await json<WatchlistMembershipStatus>(addRes)).toEqual({ myWatchlistIds: [defaultId] })

    const [row] = await db
      .select({ id: watchlistItems.id, listedAt: watchlistItems.listedAt })
      .from(watchlistItems)
      .where(eq(watchlistItems.entityId, show.id))
    expect(row).toBeDefined()

    // Re-adding is a no-op, not a second row or a bumped listedAt.
    const addAgainRes = await app.request(
      `/api/v1/library/shows/breaking-bad/watchlists/${defaultId}`,
      { method: 'PUT', headers: { cookie } },
    )
    expect(addAgainRes.status).toBe(200)
    const rowsAfter = await db
      .select({ id: watchlistItems.id, listedAt: watchlistItems.listedAt })
      .from(watchlistItems)
      .where(eq(watchlistItems.entityId, show.id))
    expect(rowsAfter).toHaveLength(1)
    expect(rowsAfter[0]!.listedAt).toEqual(row!.listedAt)

    // The show page's own myWatchlistIds reflects it too.
    const detailRes = await app.request('/api/v1/library/shows/breaking-bad', {
      headers: { cookie },
    })
    expect((await json<ShowDetail>(detailRes)).myWatchlistIds).toEqual([defaultId])
  })

  it('lets a show sit on several lists at once, and removes from just one at a time', async () => {
    const cookie = await createUserAndCookie()
    await seedShow('the-wire', 'The Wire')

    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultId = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id
    const customRes = await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Crime Dramas' }),
    })
    const customId = (await json<WatchlistSummary>(customRes)).id

    await app.request(`/api/v1/library/shows/the-wire/watchlists/${defaultId}`, {
      method: 'PUT',
      headers: { cookie },
    })
    const bothRes = await app.request(`/api/v1/library/shows/the-wire/watchlists/${customId}`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(new Set((await json<WatchlistMembershipStatus>(bothRes)).myWatchlistIds)).toEqual(
      new Set([defaultId, customId]),
    )

    const removeRes = await app.request(`/api/v1/library/shows/the-wire/watchlists/${defaultId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(await json<WatchlistMembershipStatus>(removeRes)).toEqual({ myWatchlistIds: [customId] })
  })

  it("404s adding to another user's watchlist id", async () => {
    const cookieA = await createUserAndCookie('a@example.com')
    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie: cookieA } })
    const defaultIdA = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id

    await createLocalUser(db, 'b@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'correct-horse-battery-staple' }),
    })
    const cookieB = extractCookie(loginB)!

    await seedShow('the-wire', 'The Wire')
    const res = await app.request(`/api/v1/library/shows/the-wire/watchlists/${defaultIdA}`, {
      method: 'PUT',
      headers: { cookie: cookieB },
    })
    expect(res.status).toBe(404)
  })

  it('adds a movie to a watchlist the same way as a show', async () => {
    const cookie = await createUserAndCookie()
    await seedMovie('the-matrix-1999', 'The Matrix')
    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultId = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id

    const addRes = await app.request(
      `/api/v1/library/movies/the-matrix-1999/watchlists/${defaultId}`,
      { method: 'PUT', headers: { cookie } },
    )
    expect(addRes.status).toBe(200)
    expect(await json<WatchlistMembershipStatus>(addRes)).toEqual({ myWatchlistIds: [defaultId] })

    const detailRes = await app.request('/api/v1/library/movies/the-matrix-1999', {
      headers: { cookie },
    })
    expect((await json<MovieDetail>(detailRes)).myWatchlistIds).toEqual([defaultId])
  })

  it("defaults a list's cover to the most recently added item, and lets a specific item be pinned instead", async () => {
    const cookie = await createUserAndCookie()
    await seedShow('breaking-bad', 'Breaking Bad', '/breaking-bad.jpg')
    await seedShow('the-wire', 'The Wire', '/the-wire.jpg')

    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultId = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id

    await app.request(`/api/v1/library/shows/breaking-bad/watchlists/${defaultId}`, {
      method: 'PUT',
      headers: { cookie },
    })
    await app.request(`/api/v1/library/shows/the-wire/watchlists/${defaultId}`, {
      method: 'PUT',
      headers: { cookie },
    })

    // "The Wire" was added last, so it's the default cover.
    const summariesRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultSummary = (await json<ListWatchlistsResponse>(summariesRes)).watchlists.find(
      (w) => w.id === defaultId,
    )!
    expect(defaultSummary.itemCount).toBe(2)
    expect(defaultSummary.coverPosterPath).toBe('/the-wire.jpg')

    const detailRes = await app.request(`/api/v1/watchlists/${defaultId}`, { headers: { cookie } })
    const detail = await json<WatchlistDetail>(detailRes)
    const breakingBadItem = detail.items.find((i) => i.slug === 'breaking-bad')!

    // Pin Breaking Bad as the cover instead.
    const pinRes = await app.request(`/api/v1/watchlists/${defaultId}`, {
      method: 'PATCH',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverItemId: breakingBadItem.itemId }),
    })
    expect(pinRes.status).toBe(200)
    expect((await json<WatchlistSummary>(pinRes)).coverPosterPath).toBe('/breaking-bad.jpg')

    // Pinning an item from a different list is rejected.
    const otherListRes = await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other' }),
    })
    const otherListId = (await json<WatchlistSummary>(otherListRes)).id
    const badPinRes = await app.request(`/api/v1/watchlists/${otherListId}`, {
      method: 'PATCH',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverItemId: breakingBadItem.itemId }),
    })
    expect(badPinRes.status).toBe(404)

    // Removing the pinned item falls back to "most recently added"
    // automatically (ON DELETE SET NULL on watchlists.cover_item_id).
    await app.request(`/api/v1/library/shows/breaking-bad/watchlists/${defaultId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    const [afterRemoval] = await db
      .select({ coverItemId: watchlists.coverItemId })
      .from(watchlists)
      .where(eq(watchlists.id, defaultId))
    expect(afterRemoval?.coverItemId).toBeNull()

    const afterRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const afterSummary = (await json<ListWatchlistsResponse>(afterRes)).watchlists.find(
      (w) => w.id === defaultId,
    )!
    expect(afterSummary.coverPosterPath).toBe('/the-wire.jpg')
  })

  it('clearing the watchlist category deletes custom lists but leaves Default, emptied', async () => {
    const cookie = await createUserAndCookie()
    await seedShow('breaking-bad', 'Breaking Bad')

    const watchlistsRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const defaultId = (await json<ListWatchlistsResponse>(watchlistsRes)).watchlists[0]!.id
    await app.request(`/api/v1/library/shows/breaking-bad/watchlists/${defaultId}`, {
      method: 'PUT',
      headers: { cookie },
    })
    await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Custom' }),
    })

    const clearRes = await app.request('/api/v1/account/clear-data', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watchHistory: false,
        ratings: false,
        watchlist: true,
        droppedShows: false,
      }),
    })
    expect(clearRes.status).toBe(204)

    const afterRes = await app.request('/api/v1/watchlists', { headers: { cookie } })
    const after = await json<ListWatchlistsResponse>(afterRes)
    expect(after.watchlists).toEqual([
      { id: defaultId, name: 'Default', isDefault: true, itemCount: 0, coverPosterPath: null },
    ])
  })

  it("names a watchlist add's list in the Activity feed", async () => {
    const cookie = await createUserAndCookie()
    await seedShow('breaking-bad', 'Breaking Bad')

    const customRes = await app.request('/api/v1/watchlists', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cool Sci-fi Stuff!' }),
    })
    const customId = (await json<WatchlistSummary>(customRes)).id

    await app.request(`/api/v1/library/shows/breaking-bad/watchlists/${customId}`, {
      method: 'PUT',
      headers: { cookie },
    })

    const feedRes = await app.request('/api/v1/activity-feed', { headers: { cookie } })
    const feed = await json<ListActivityResponse>(feedRes)
    const entry = feed.entries.find((e) => e.kind === 'watchlist')
    expect(entry?.listName).toBe('Cool Sci-fi Stuff!')
  })
})
