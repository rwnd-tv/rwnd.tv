import { mkdir, rm, writeFile } from 'node:fs/promises'
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
import type {
  BackupFile,
  BackupFileV1,
  BackupSummary,
  DiffBackupResponse,
  ListBackupsResponse,
  RestoreBackupResponse,
  User,
} from '@rwnd/shared'
import { BACKUP_FORMAT_VERSION } from '@rwnd/shared'
import { createLocalUser, extractCookie, json, resetDb, testApp, testDb } from './helpers.js'
import { loadEnv } from '../env.js'
import { restoreBackupFile } from '../backup/restore.js'
import { ensureDefaultWatchlist } from '../lib/watchlists.js'
import { backupFilePath, backupUserDir, generateBackupId } from '../backup/paths.js'
import { createApp } from '../app.js'
import type { MetadataProvider } from '../providers/types.js'

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

  const [movie] = await db
    .insert(movies)
    .values({ title: 'The Matrix', slug: 'the-matrix-1999', year: 1999 })
    .returning()
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
    expect((await app.request('/api/v1/backups/fake-id/diff')).status).toBe(401)
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
    const watchlistId = await ensureDefaultWatchlist(db, userId)
    await db.insert(watchlistItems).values({
      userId,
      watchlistId,
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

  it('gives two same-title-and-year movies in one backup file distinct slugs on restore', async () => {
    const cookie = await createUserAndCookie('collision@example.com')
    const userId = await meId(cookie)

    // Built directly rather than via seedMetadata/POST /backups — the
    // point of this test is restore's own slug-collision handling
    // (generateUniqueMovieSlug), which needs two movies that share a
    // title *and* year but have distinct TMDB ids, referenced by a real
    // watch each so restore doesn't skip either as unreferenced.
    const file: BackupFile = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      description: 'Same-title collision fixture',
      counts: { watchHistory: 2, ratings: 0, watchlist: 0, droppedShows: 0 },
      skipped: 0,
      movies: [
        {
          ref: { source: 'tmdb', externalId: '111' },
          title: 'Same Name',
          year: 2020,
          runtimeMinutes: 100,
          overview: null,
          posterPath: null,
        },
        {
          ref: { source: 'tmdb', externalId: '222' },
          title: 'Same Name',
          year: 2020,
          runtimeMinutes: 100,
          overview: null,
          posterPath: null,
        },
      ],
      shows: [],
      watchHistory: [
        {
          movie: { source: 'tmdb', externalId: '111' },
          watchedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          source: 'manual',
          sourceRef: null,
        },
        {
          movie: { source: 'tmdb', externalId: '222' },
          watchedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
          source: 'manual',
          sourceRef: null,
        },
      ],
      ratings: [],
      watchlist: [],
      watchlists: [],
      droppedShows: [],
    }

    const counts = await restoreBackupFile(db, userId, file)
    expect(counts.watchHistory).toBe(2)

    const rows = await db.select().from(movies).where(eq(movies.title, 'Same Name'))
    expect(rows).toHaveLength(2)
    const slugs = rows.map((r) => r.slug).sort()
    expect(slugs).toEqual(['same-name-2020', 'same-name-2020-2'])
  })

  it('diffs a backup against the current state, counting entries added and removed since it was taken', async () => {
    const cookie = await createUserAndCookie('differ@example.com')
    const userId = await meId(cookie)
    const { episode, movie } = await seedMetadata(db)

    // At backup time: one movie watch, one rating.
    await db
      .insert(plays)
      .values({ userId, movieId: movie.id, watchedAt: new Date('2026-01-01T00:00:00.000Z') })
    await db
      .insert(ratings)
      .values({ userId, entityType: 'movie', entityId: movie.id, rating: 8, ratedAt: new Date() })

    const createRes = await app.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Before more watching' }),
    })
    const backup = await json<BackupSummary>(createRes)

    // Since the backup: the movie watch is removed, an episode watch is
    // added, the rating is untouched.
    await db.delete(plays).where(eq(plays.movieId, movie.id))
    await db
      .insert(plays)
      .values({ userId, episodeId: episode.id, watchedAt: new Date('2026-01-05T00:00:00.000Z') })

    const diffRes = await app.request(`/api/v1/backups/${backup.id}/diff`, {
      headers: { cookie },
    })
    expect(diffRes.status).toBe(200)
    expect(await json<DiffBackupResponse>(diffRes)).toEqual({
      diff: {
        watchHistory: { added: 1, removed: 1 },
        ratings: { added: 0, removed: 0 },
        watchlist: { added: 0, removed: 0 },
        droppedShows: { added: 0, removed: 0 },
      },
    })
  })

  it('represents a TVDB-only show in a backup and its diff (regression: a show with no tmdb id showed no added/removed)', async () => {
    // Before build.ts learned to pick *any* configured provider's id
    // (pickRefreshTargets) instead of always querying for `source: 'tmdb'`,
    // a show like Formula 1 — resolved entirely via TVDB, no tmdb
    // external_ids row at all — was silently excluded from every backup
    // file's watchHistory/movies/shows arrays. Since both the saved backup
    // and the "current" snapshot dropped it identically, diffing showed
    // 0 added/0 removed even after real new watches were logged.
    const cookie = await createUserAndCookie('tvdb-only@example.com')
    const userId = await meId(cookie)

    const [show] = await db
      .insert(shows)
      .values({ title: 'Formula 1', slug: 'formula-1-1950', metadataSource: 'tvdb' })
      .returning()
    if (!show) throw new Error('failed to insert show')
    await db
      .insert(externalIds)
      .values({ entityType: 'show', entityId: show.id, source: 'tvdb', externalId: '9001' })
    await db.insert(seasons).values({ showId: show.id, seasonNumber: 2026, episodeCount: 2 })
    const [episode1, episode2] = await db
      .insert(episodes)
      .values([
        { showId: show.id, seasonNumber: 2026, episodeNumber: 1, title: 'Bahrain Grand Prix' },
        { showId: show.id, seasonNumber: 2026, episodeNumber: 2, title: 'Saudi Grand Prix' },
      ])
      .returning()
    if (!episode1 || !episode2) throw new Error('failed to insert episodes')

    await db
      .insert(plays)
      .values({ userId, episodeId: episode1.id, watchedAt: new Date('2026-03-01T00:00:00.000Z') })

    const fakeTmdb = { source: 'tmdb' } as unknown as MetadataProvider
    const fakeTvdb = { source: 'tvdb' } as unknown as MetadataProvider
    const customApp = createApp({ db, metadataProviders: [fakeTmdb, fakeTvdb] })

    const createRes = await customApp.request('/api/v1/backups', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Before more F1 watching' }),
    })
    expect(createRes.status).toBe(201)
    const backup = await json<BackupSummary>(createRes)
    expect(backup.counts.watchHistory).toBe(1)
    expect(backup.skipped).toBe(0)

    // Nothing has changed since the backup was taken.
    const diffRes = await customApp.request(`/api/v1/backups/${backup.id}/diff`, {
      headers: { cookie },
    })
    expect(await json<DiffBackupResponse>(diffRes)).toEqual({
      diff: {
        watchHistory: { added: 0, removed: 0 },
        ratings: { added: 0, removed: 0 },
        watchlist: { added: 0, removed: 0 },
        droppedShows: { added: 0, removed: 0 },
      },
    })

    // A second watch, logged after the backup — the diff must now see it.
    await db
      .insert(plays)
      .values({ userId, episodeId: episode2.id, watchedAt: new Date('2026-03-08T00:00:00.000Z') })
    const diffRes2 = await customApp.request(`/api/v1/backups/${backup.id}/diff`, {
      headers: { cookie },
    })
    expect(await json<DiffBackupResponse>(diffRes2)).toEqual({
      diff: {
        watchHistory: { added: 1, removed: 0 },
        ratings: { added: 0, removed: 0 },
        watchlist: { added: 0, removed: 0 },
        droppedShows: { added: 0, removed: 0 },
      },
    })
  })

  it('migrates a BACKUP_FORMAT_VERSION 1 file (bare tmdbId) transparently on restore and diff', async () => {
    const cookie = await createUserAndCookie('legacy@example.com')
    const userId = await meId(cookie)
    const { show, episode, movie } = await seedMetadata(db)

    // A v1 file, written directly to disk the way a pre-format-2 version of
    // rwnd.tv actually would have — never produced via POST /backups, which
    // now always writes the current format.
    const legacyFile: BackupFileV1 = {
      formatVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      description: 'A pre-v2 backup',
      counts: { watchHistory: 1, ratings: 1, watchlist: 0, droppedShows: 0 },
      skipped: 0,
      movies: [
        {
          tmdbId: '603',
          title: 'The Matrix',
          year: 1999,
          runtimeMinutes: null,
          overview: null,
          posterPath: null,
        },
      ],
      shows: [
        {
          tmdbId: '1396',
          slug: 'breaking-bad',
          title: 'Breaking Bad',
          year: 2008,
          overview: null,
          posterPath: null,
          status: null,
          genres: ['Drama'],
          voteAverage: null,
          seasons: [
            { seasonNumber: 1, name: 'Season 1', episodeCount: 7, airDate: null, posterPath: null },
          ],
          episodes: [
            {
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Pilot',
              runtimeMinutes: null,
              firstAired: null,
            },
          ],
        },
      ],
      watchHistory: [
        {
          movie: '603',
          watchedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          source: 'manual',
          sourceRef: null,
        },
      ],
      ratings: [
        { show: '1396', rating: 9, ratedAt: new Date('2026-01-01T00:00:00.000Z').toISOString() },
      ],
      watchlist: [],
      droppedShows: [],
    }

    const email = 'legacy@example.com'
    const id = generateBackupId(new Date(legacyFile.createdAt), legacyFile.description)
    await mkdir(backupUserDir(email), { recursive: true })
    await writeFile(backupFilePath(email, id), JSON.stringify(legacyFile), 'utf-8')

    // Diffing against it works exactly as it would for a current-format
    // file — nothing has changed since, except this rating is untouched
    // while the play referenced by the file has since been removed and a
    // different one added (proving the migrated refs actually match the
    // real `show`/`movie` rows the earlier tmdbId-keyed external_ids point
    // at, not just that the request 200s).
    await db.insert(ratings).values({
      userId,
      entityType: 'show',
      entityId: show.id,
      rating: 9,
      ratedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await db
      .insert(plays)
      .values({ userId, episodeId: episode.id, watchedAt: new Date('2026-02-01T00:00:00.000Z') })

    const diffRes = await app.request(`/api/v1/backups/${id}/diff`, { headers: { cookie } })
    expect(diffRes.status).toBe(200)
    expect(await json<DiffBackupResponse>(diffRes)).toEqual({
      diff: {
        watchHistory: { added: 1, removed: 1 },
        ratings: { added: 0, removed: 0 },
        watchlist: { added: 0, removed: 0 },
        droppedShows: { added: 0, removed: 0 },
      },
    })

    // Restoring it also works, and the resulting external_ids row is
    // tagged 'tmdb' (not left ambiguous) exactly as the original v1 write
    // would have recorded it.
    const restoreRes = await app.request(`/api/v1/backups/${id}/restore`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(restoreRes.status).toBe(200)
    expect(await json<RestoreBackupResponse>(restoreRes)).toEqual({
      counts: { watchHistory: 1, ratings: 1, watchlist: 0, droppedShows: 0 },
    })
    const [restoredPlay] = await db
      .select({ movieId: plays.movieId })
      .from(plays)
      .where(eq(plays.userId, userId))
    expect(restoredPlay?.movieId).toBe(movie.id)
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

    const diffRes = await app.request(
      `/api/v1/backups/${encodeURIComponent('../../etc/passwd')}/diff`,
      { headers: { cookie } },
    )
    expect(diffRes.status).toBe(400)
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

    const diffAsB = await app.request(`/api/v1/backups/${backup.id}/diff`, {
      headers: { cookie: cookieB },
    })
    expect(diffAsB.status).toBe(404)

    // Still there for its actual owner, unaffected by B's attempts.
    const listAsA = await app.request('/api/v1/backups', { headers: { cookie: cookieA } })
    const { backups } = await json<ListBackupsResponse>(listAsA)
    expect(backups.map((b) => b.id)).toEqual([backup.id])
  })
})
