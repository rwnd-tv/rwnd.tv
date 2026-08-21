import { rm } from 'node:fs/promises'
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
import type { BackupSummary, ListBackupsResponse, RestoreBackupResponse, User } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { loadEnv } from '../env.js'

const db = testDb()
const app = testApp()

async function createUserAndCookie(email: string) {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

async function meId(cookie: string) {
  const res = await app.request('/api/v1/auth/me', { headers: { cookie } })
  return (await json<User>(res)).id
}

/** A show, one season, one episode, a movie, each with a `tmdb` external
 * id — the minimum fixture backup/restore actually needs, since entries
 * are keyed by TMDB id rather than local row id (see
 * packages/shared/src/schemas/backups.ts). */
async function seedMetadata(db: ReturnType<typeof testDb>) {
  const [show] = await db
    .insert(shows)
    .values({ title: 'Breaking Bad', slug: 'breaking-bad', year: 2008, genres: ['Drama'] })
    .returning()
  if (!show) throw new Error('failed to insert show')
  await db.insert(externalIds).values({
    entityType: 'show',
    entityId: show.id,
    source: 'tmdb',
    externalId: '1396',
  })
  await db
    .insert(seasons)
    .values({ showId: show.id, seasonNumber: 1, name: 'Season 1', episodeCount: 7 })
  const [episode] = await db
    .insert(episodes)
    .values({ showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'Pilot' })
    .returning()
  if (!episode) throw new Error('failed to insert episode')

  const [movie] = await db.insert(movies).values({ title: 'The Matrix', year: 1999 }).returning()
  if (!movie) throw new Error('failed to insert movie')
  await db.insert(externalIds).values({
    entityType: 'movie',
    entityId: movie.id,
    source: 'tmdb',
    externalId: '603',
  })

  return { show, episode, movie }
}

/** Every row backup/restore touches, for a given user, scoped by userId —
 * used to compare "before backup" against "after restore". */
async function snapshotUserData(db: ReturnType<typeof testDb>, userId: string) {
  const [playRows, ratingRows, watchlistRows, droppedRows] = await Promise.all([
    db
      .select({ movieId: plays.movieId, episodeId: plays.episodeId, watchedAt: plays.watchedAt })
      .from(plays)
      .where(eq(plays.userId, userId)),
    db
      .select({
        entityType: ratings.entityType,
        entityId: ratings.entityId,
        rating: ratings.rating,
      })
      .from(ratings)
      .where(eq(ratings.userId, userId)),
    db
      .select({ entityType: watchlistItems.entityType, entityId: watchlistItems.entityId })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, userId)),
    db
      .select({ showId: droppedShows.showId, manualDropped: droppedShows.manualDropped })
      .from(droppedShows)
      .where(eq(droppedShows.userId, userId)),
  ])
  return { playRows, ratingRows, watchlistRows, droppedRows }
}

describe('backups', () => {
  // Directories are now keyed by email (see apps/api/src/backup/paths.ts),
  // a fixed literal per test rather than the fresh random UUID setup()
  // used to generate — so, unlike resetDb() for Postgres, nothing else
  // guarantees a clean slate between runs. Wiped outright rather than
  // tracking which emails this file happens to use.
  beforeEach(() =>
    Promise.all([resetDb(db), rm(loadEnv().BACKUP_DIR!, { recursive: true, force: true })]),
  )

  it('requires authentication', async () => {
    expect((await app.request('/api/v1/backups')).status).toBe(401)
    expect((await app.request('/api/v1/backups', { method: 'POST' })).status).toBe(401)
  })

  it('round-trips a backup through clear and restore', async () => {
    const cookie = await createUserAndCookie('watcher@example.com')
    const userId = await meId(cookie)
    const { show, episode, movie } = await seedMetadata(db)

    await db.insert(plays).values([
      { userId, movieId: movie.id, watchedAt: new Date('2026-01-01T00:00:00.000Z') },
      { userId, episodeId: episode.id, watchedAt: new Date('2026-01-02T00:00:00.000Z') },
    ])
    await db
      .insert(ratings)
      .values({ userId, entityType: 'show', entityId: show.id, rating: 9, ratedAt: new Date() })
    await db.insert(watchlistItems).values({
      userId,
      entityType: 'movie',
      entityId: movie.id,
      listedAt: new Date(),
      notes: 'watch this weekend',
    })
    await db.insert(droppedShows).values({
      userId,
      showId: show.id,
      manualDropped: true,
      manualDroppedAt: new Date(),
    })

    const before = await snapshotUserData(db, userId)

    const createRes = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Before a risky Trakt re-import' }),
    })
    expect(createRes.status).toBe(201)
    const backup = await json<BackupSummary>(createRes)
    expect(backup.counts).toEqual({ watchHistory: 2, ratings: 1, watchlist: 1, droppedShows: 1 })
    expect(backup.skipped).toBe(0)
    // The id doubles as the on-disk filename — slugified description
    // appended so it's recognisable in a directory listing without
    // opening the file (see generateBackupId in apps/api/src/backup/paths.ts).
    expect(backup.id).toMatch(/--before-a-risky-trakt-re-import$/)

    // Simulate "Clear database" — wipe the same four tables the real
    // clear-data route does (apps/api/src/routes/account.ts).
    await db.delete(plays).where(eq(plays.userId, userId))
    await db.delete(ratings).where(eq(ratings.userId, userId))
    await db.delete(watchlistItems).where(eq(watchlistItems.userId, userId))
    await db.delete(droppedShows).where(eq(droppedShows.userId, userId))
    expect((await snapshotUserData(db, userId)).playRows).toHaveLength(0)

    const restoreRes = await app.request(`/api/v1/backups/${backup.id}/restore`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(restoreRes.status).toBe(200)
    const restored = await json<RestoreBackupResponse>(restoreRes)
    expect(restored.counts).toEqual({ watchHistory: 2, ratings: 1, watchlist: 1, droppedShows: 1 })

    const after = await snapshotUserData(db, userId)
    expect(after).toEqual(before)
  })

  it('restores by recreating metadata the backup carries, without needing it to already exist', async () => {
    const cookie = await createUserAndCookie('rebuild@example.com')
    const userId = await meId(cookie)
    const { show, episode, movie } = await seedMetadata(db)

    await db
      .insert(plays)
      .values({ userId, episodeId: episode.id, watchedAt: new Date('2026-01-02T00:00:00.000Z') })
    await db
      .insert(ratings)
      .values({ userId, entityType: 'movie', entityId: movie.id, rating: 8, ratedAt: new Date() })

    const createRes = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Before wiping metadata' }),
    })
    const backup = await json<BackupSummary>(createRes)

    // Wipe every trace of the underlying metadata, not just this user's
    // activity — the point of this test is that restore rebuilds it from
    // the file alone, never calling out to TMDB (the test env's TMDB key
    // isn't even a real one — see vitest.config.ts).
    await db.delete(plays).where(eq(plays.userId, userId))
    await db.delete(ratings).where(eq(ratings.userId, userId))
    await db.delete(episodes).where(eq(episodes.showId, show.id))
    await db.delete(seasons).where(eq(seasons.showId, show.id))
    await db.delete(externalIds)
    await db.delete(shows).where(eq(shows.id, show.id))
    await db.delete(movies).where(eq(movies.id, movie.id))

    const restoreRes = await app.request(`/api/v1/backups/${backup.id}/restore`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(restoreRes.status).toBe(200)
    expect(await json<RestoreBackupResponse>(restoreRes)).toEqual({
      counts: { watchHistory: 1, ratings: 1, watchlist: 0, droppedShows: 0 },
    })

    // Not asserting on the regenerated slug itself — generateUniqueShowSlug
    // appends the year ("breaking-bad-2008"), which is its own concern,
    // not what this test is checking.
    const [recreatedShow] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(recreatedShow?.year).toBe(2008)
    const [recreatedMovie] = await db.select().from(movies).where(eq(movies.title, 'The Matrix'))
    expect(recreatedMovie?.year).toBe(1999)
  })

  it('falls back to a plain id when the description has nothing sluggable, and truncates a long one', async () => {
    const cookie = await createUserAndCookie('slugs@example.com')

    const emoji = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '🎬🍿' }),
    })
    const emojiBackup = await json<BackupSummary>(emoji)
    // No trailing "--" left dangling when slugify() reduces the
    // description to nothing.
    expect(emojiBackup.id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/)

    const long = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'x'.repeat(200) }),
    })
    const longBackup = await json<BackupSummary>(long)
    const slug = longBackup.id.split('--')[1]
    expect(slug).toBeDefined()
    expect(slug!.length).toBeLessThanOrEqual(50)
  })

  it('rejects a path-traversal-shaped backup id before touching the filesystem', async () => {
    const cookie = await createUserAndCookie('attacker@example.com')

    const restoreRes = await app.request(
      `/api/v1/backups/${encodeURIComponent('../../etc/passwd')}/restore`,
      { method: 'POST', headers: { cookie } },
    )
    expect(restoreRes.status).toBe(400)

    const deleteRes = await app.request(
      `/api/v1/backups/${encodeURIComponent('../../etc/passwd')}`,
      { method: 'DELETE', headers: { cookie } },
    )
    expect(deleteRes.status).toBe(400)
  })

  it("isolates one user's backups from another's", async () => {
    const cookieA = await createUserAndCookie('owner@example.com')
    // setup only ever creates the first admin (a second call refuses, see
    // setup.test.ts) — a genuine second user goes through createLocalUser
    // + login instead, same pattern as imports.test.ts's equivalent test.
    await createLocalUser(db, 'other@example.com', 'correct-horse-battery-staple')
    const loginB = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'other@example.com',
        password: 'correct-horse-battery-staple',
      }),
    })
    const cookieB = extractCookie(loginB)!

    await seedMetadata(db)
    const createRes = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: "A's backup" }),
    })
    const backup = await json<BackupSummary>(createRes)

    const listAsB = await app.request('/api/v1/backups', { headers: { cookie: cookieB } })
    expect(await json<ListBackupsResponse>(listAsB)).toEqual({ backups: [] })

    const restoreAsB = await app.request(`/api/v1/backups/${backup.id}/restore`, {
      method: 'POST',
      headers: { cookie: cookieB },
    })
    expect(restoreAsB.status).toBe(404)

    const deleteAsB = await app.request(`/api/v1/backups/${backup.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    })
    expect(deleteAsB.status).toBe(404)

    // Still there for its actual owner, unaffected by B's attempts.
    const listAsA = await app.request('/api/v1/backups', { headers: { cookie: cookieA } })
    const { backups } = await json<ListBackupsResponse>(listAsA)
    expect(backups.map((b) => b.id)).toEqual([backup.id])
  })
})
