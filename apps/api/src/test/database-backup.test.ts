import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { createGunzip } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { movies, users, watchlistItems, watchlists } from '@rwnd/db'
import { runDatabaseBackup } from '../lib/database-backup.js'
import { createLocalUser, resetDb, testDb } from './helpers.js'

/**
 * `pg_dump` is bundled into the runtime image (see Dockerfile) but is not
 * necessarily on a contributor's PATH. Skipping keeps `pnpm test` usable
 * locally without it; `.github/workflows/ci.yml` installs it explicitly so
 * this suite can never silently stop running in CI, which for a
 * disaster-recovery feature would be worse than having no tests at all.
 */
function hasPgDump(): boolean {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const db = testDb()
let DIR: string

async function gunzipToString(path: string): Promise<string> {
  return text(createReadStream(path).pipe(createGunzip()))
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for these tests')
  return url
}

// Same filename shape as timestampName() in database-backup.ts, for a dump
// aged `days` old as of "now" — lets retention tests construct fakes at a
// known age rather than a fixed calendar date, so they don't drift relative
// to whatever DEFAULT_RETENTION_TIERS' boundaries land on by the time this
// runs.
function dumpNameAgedDays(days: number): string {
  const ts = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const compact = ts
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `rwnd-${compact}.sql.gz`
}

describe.skipIf(!hasPgDump())('database backup', () => {
  beforeEach(async () => {
    ;[DIR] = await Promise.all([mkdtemp(join(tmpdir(), 'rwnd-tv-test-db-backups-')), resetDb(db)])
  })

  afterEach(async () => {
    await rm(DIR, { recursive: true, force: true })
  })

  it('dumps schema and data, including the watchlists FK cycle and bytea', async () => {
    // The cycle (watchlists.cover_item_id -> watchlist_items.id, and
    // watchlist_items.watchlist_id -> watchlists.id) is the specific reason
    // a data-only dump was rejected in docs/adr/0008-database-backups.md, so
    // it is worth proving the chosen route actually carries it.
    const userId = await createLocalUser(db, 'backup@example.com', 'correct horse battery')
    await db
      .update(users)
      .set({ avatarImage: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]) })
      .where(eq(users.id, userId))

    const [list] = await db
      .insert(watchlists)
      .values({ userId, name: 'To watch' })
      .returning({ id: watchlists.id })
    const [movie] = await db
      .insert(movies)
      .values({ title: 'A Film', slug: 'a-film' })
      .returning({ id: movies.id })
    const [item] = await db
      .insert(watchlistItems)
      .values({
        userId,
        watchlistId: list!.id,
        entityType: 'movie',
        entityId: movie!.id,
        listedAt: new Date(),
      })
      .returning({ id: watchlistItems.id })
    // Closing the cycle: the list now points back at one of its own items.
    await db.update(watchlists).set({ coverItemId: item!.id }).where(eq(watchlists.id, list!.id))

    const result = await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    expect(result.file).toMatch(/^rwnd-\d{8}T\d{6}Z\.sql\.gz$/)
    expect(result.bytes).toBeGreaterThan(0)

    const sql = await gunzipToString(join(DIR, result.file))
    // Schema, which is what makes an old dump restorable onto a newer
    // container: migrations carry it forward from here.
    expect(sql).toContain('CREATE TABLE public.watchlists')
    expect(sql).toContain('CREATE TABLE public.users')
    // The migrations ledger rides along, so a restore then only applies what
    // is actually missing rather than re-running everything.
    expect(sql).toContain('__drizzle_migrations')
    // Data.
    expect(sql).toContain('backup@example.com')
    expect(sql).toContain('To watch')
    expect(sql).toContain(item!.id)
    // bytea round-trips as hex.
    expect(sql).toMatch(/\\\\x89504e4700ff|\\x89504e4700ff/)
  })

  it('restores onto an empty database with the data intact', async () => {
    // The test that actually matters: a dump nobody can restore is not a
    // backup. Loads into a scratch database via psql, exactly as
    // docs/self-hosting.md tells a self-hoster to.
    //
    // Explicit timeout: this is the only test here doing a real psql
    // round trip (create scratch DB, restore, two SELECTs, drop DB), and
    // it's flaked past vitest's 5s default on a loaded CI runner (took
    // 6997ms in a real run, 2026-09-11) despite the code itself being
    // correct — a shared amd64 runner's variance, not a regression.
    const userId = await createLocalUser(db, 'restore@example.com', 'correct horse battery')
    await db.insert(movies).values({ title: 'Restored Film', slug: 'restored-film' })

    const { file } = await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })
    const sql = await gunzipToString(join(DIR, file))

    const url = new URL(databaseUrl())
    const scratch = `rwnd_restore_${Date.now()}`
    const psqlEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
    const conn = [
      '--host',
      url.hostname,
      '--port',
      url.port || '5432',
      '--username',
      decodeURIComponent(url.username),
      '--no-password',
    ]
    const adminDb = url.pathname.replace(/^\//, '')

    try {
      execFileSync('psql', [...conn, '--dbname', adminDb, '-c', `CREATE DATABASE ${scratch}`], {
        env: psqlEnv,
        stdio: 'ignore',
      })
      execFileSync('psql', [...conn, '--dbname', scratch, '-v', 'ON_ERROR_STOP=1'], {
        env: psqlEnv,
        input: sql,
        stdio: ['pipe', 'ignore', 'pipe'],
      })

      const email = execFileSync(
        'psql',
        [...conn, '--dbname', scratch, '-tAc', `select email from users where id = '${userId}'`],
        { env: psqlEnv, encoding: 'utf8' },
      ).trim()
      expect(email).toBe('restore@example.com')

      const title = execFileSync(
        'psql',
        [
          ...conn,
          '--dbname',
          scratch,
          '-tAc',
          "select title from movies where slug='restored-film'",
        ],
        { env: psqlEnv, encoding: 'utf8' },
      ).trim()
      expect(title).toBe('Restored Film')
    } finally {
      execFileSync(
        'psql',
        [...conn, '--dbname', adminDb, '-c', `DROP DATABASE IF EXISTS ${scratch}`],
        {
          env: psqlEnv,
          stdio: 'ignore',
        },
      )
    }
  }, 15_000)

  it('prunes under the default retention policy and never touches anything else', async () => {
    // Well within the default policy's 7-day daily window
    // (DEFAULT_RETENTION_TIERS, database-backup.ts) — must all survive
    // regardless of count, since that tier keeps every dump by age, not a
    // fixed count the way the old flat "keep newest 7" did.
    const recentAgeDays = [1, 2, 3, 4, 5]
    for (const days of recentAgeDays) {
      await writeFile(join(DIR, dumpNameAgedDays(days)), 'old')
    }
    // Past every tier's boundary (7 daily + 4*7 weekly + 12*30 monthly =
    // 395 days) — must be pruned.
    await writeFile(join(DIR, dumpNameAgedDays(500)), 'ancient')
    await writeFile(join(DIR, dumpNameAgedDays(600)), 'ancient')

    // Files this job did not write must survive, however similar they look.
    await writeFile(join(DIR, 'notes.txt'), 'mine')
    await writeFile(join(DIR, 'rwnd-backup.sql.gz'), 'wrong shape')
    const stalePartial = join(DIR, 'rwnd-20260101T000000Z.sql.gz.partial')
    await writeFile(stalePartial, 'crashed run')
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await utimes(stalePartial, old, old)

    await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    const left = await readdir(DIR)
    // The recent fakes, plus the one runDatabaseBackup itself just wrote.
    expect(left.filter((n) => /^rwnd-\d{8}T\d{6}Z\.sql\.gz$/.test(n))).toHaveLength(
      recentAgeDays.length + 1,
    )
    expect(left).toContain('notes.txt')
    expect(left).toContain('rwnd-backup.sql.gz')
    expect(left).not.toContain('rwnd-20260101T000000Z.sql.gz.partial')
  })

  it('leaves no partial behind on success', async () => {
    await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })
    const left = await readdir(DIR)
    expect(left.filter((n) => n.endsWith('.partial'))).toHaveLength(0)
  })

  it('fails without leaving a partial, and without leaking the password', async () => {
    const url = new URL(databaseUrl())
    url.hostname = 'no-such-host.invalid'
    url.password = 'hunter2-should-never-appear'

    await expect(runDatabaseBackup({ db, dir: DIR, databaseUrl: url.toString() })).rejects.toThrow()

    const left = await readdir(DIR).catch(() => [])
    expect(left.filter((n) => n.endsWith('.partial'))).toHaveLength(0)

    // The password goes to the child's PGPASSWORD, never argv, so it cannot
    // surface in pg_dump's own error output (ADR 0007, Stage G).
    await expect(
      runDatabaseBackup({ db, dir: DIR, databaseUrl: url.toString() }).catch((err: unknown) =>
        Promise.reject(new Error(String(err))),
      ),
    ).rejects.not.toThrow(/hunter2/)
  })

  it('writes a file whose name sorts chronologically', async () => {
    const earlier = await runDatabaseBackup({
      db,
      dir: DIR,
      databaseUrl: databaseUrl(),
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    const later = await runDatabaseBackup({
      db,
      dir: DIR,
      databaseUrl: databaseUrl(),
      now: new Date('2026-06-01T12:34:56.000Z'),
    })
    expect(earlier.file).toBe('rwnd-20260101T000000Z.sql.gz')
    expect(later.file).toBe('rwnd-20260601T123456Z.sql.gz')
    expect([later.file, earlier.file].sort((a, b) => b.localeCompare(a))[0]).toBe(later.file)
  })

  it('reads back as valid gzip', async () => {
    const { file } = await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })
    // Gzip magic bytes, proving the file is not a truncated or plain stream.
    const raw = await readFile(join(DIR, file))
    expect(raw[0]).toBe(0x1f)
    expect(raw[1]).toBe(0x8b)
  })
})
