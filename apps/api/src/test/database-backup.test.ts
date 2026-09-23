import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { createGunzip, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createDatabase, movies, users, watchlistItems, watchlists } from '@rwnd/db'
import {
  BackupAlreadyRunningError,
  runDatabaseBackup,
  runScheduledDatabaseBackup,
} from '../lib/database-backup.js'
import {
  PRE_RESTORE_RE,
  readLastRestoreResult,
  runPendingRestore,
  writeRestoreRequest,
} from '../lib/database-restore.js'
import { createLocalUser, hasPgDump, resetDb, testDb } from './helpers.js'

vi.mock('../lib/job-alerts.js', () => ({ alertOnJobFailure: vi.fn() }))

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
    // --no-owner --no-privileges (added alongside restore automation, ADR
    // 0008's 2026-09-22 update): a dump restored onto a database connecting
    // as a different role must not fail on its first ALTER ... OWNER TO —
    // the prod-onto-dev case the ADR already endorses. Only a dump taken
    // before this flag existed still carries these statements.
    expect(sql).not.toMatch(/OWNER TO/)
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
    // (DEFAULT_RETENTION_TIERS, database-backup.ts) — must all survive,
    // not pruned to a fixed count the way the old flat "keep newest 7" did.
    // One per distinct UTC day, so the daily tier's same-day dedup
    // (database-backup-retention.test.ts) doesn't collapse any of these.
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
    // A stale .partial that ISN'T this job's own shape — the stale-partial
    // sweep used to match any name ending in .partial, which would delete
    // this too (M4 review finding, docs/TODO.md). It must survive exactly
    // like notes.txt/rwnd-backup.sql.gz above.
    const strangePartial = join(DIR, 'my-export.sql.gz.partial')
    await writeFile(strangePartial, "not this job's")
    await utimes(strangePartial, old, old)

    await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    const left = await readdir(DIR)
    // The recent fakes, plus the one runDatabaseBackup itself just wrote.
    expect(left.filter((n) => /^rwnd-\d{8}T\d{6}Z\.sql\.gz$/.test(n))).toHaveLength(
      recentAgeDays.length + 1,
    )
    expect(left).toContain('notes.txt')
    expect(left).toContain('rwnd-backup.sql.gz')
    expect(left).toContain('my-export.sql.gz.partial')
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

  it('refuses to run while another run holds the lock', async () => {
    await writeFile(join(DIR, 'rwnd-backup.lock'), '999999')

    await expect(
      runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() }),
    ).rejects.toBeInstanceOf(BackupAlreadyRunningError)

    // Nothing was dumped, and the other run's lock is left untouched for it
    // to release itself.
    const left = await readdir(DIR)
    expect(left.filter((n) => /^rwnd-\d{8}T\d{6}Z\.sql\.gz$/.test(n))).toHaveLength(0)
    expect(left).toContain('rwnd-backup.lock')
  })

  it('clears a stale lock left by a crashed run and proceeds', async () => {
    const lockPath = join(DIR, 'rwnd-backup.lock')
    await writeFile(lockPath, '999999')
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000) // past STALE_LOCK_MS (6h)
    await utimes(lockPath, old, old)

    const result = await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    expect(result.file).toMatch(/^rwnd-\d{8}T\d{6}Z\.sql\.gz$/)
  })

  it('releases the lock after a successful run', async () => {
    await runDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })
    const left = await readdir(DIR)
    expect(left).not.toContain('rwnd-backup.lock')
  })

  it('releases the lock after a failed run', async () => {
    const url = new URL(databaseUrl())
    url.hostname = 'no-such-host.invalid'

    await expect(runDatabaseBackup({ db, dir: DIR, databaseUrl: url.toString() })).rejects.toThrow()

    const left = await readdir(DIR).catch(() => [])
    expect(left).not.toContain('rwnd-backup.lock')
  })
})

describe.skipIf(!hasPgDump())('runScheduledDatabaseBackup', () => {
  beforeEach(async () => {
    ;[DIR] = await Promise.all([mkdtemp(join(tmpdir(), 'rwnd-tv-test-db-backups-')), resetDb(db)])
    vi.clearAllMocks()
  })

  it('does not alert on a successful run', async () => {
    const { alertOnJobFailure } = await import('../lib/job-alerts.js')

    await runScheduledDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    expect(alertOnJobFailure).not.toHaveBeenCalled()
  })

  it('alerts with the failure message on a real failure', async () => {
    const { alertOnJobFailure } = await import('../lib/job-alerts.js')
    const url = new URL(databaseUrl())
    url.hostname = 'no-such-host.invalid'

    await runScheduledDatabaseBackup({ db, dir: DIR, databaseUrl: url.toString() })

    expect(alertOnJobFailure).toHaveBeenCalledWith(
      db,
      'Database backup',
      expect.stringContaining('no-such-host.invalid'),
    )
  })

  it('does not alert when another run already holds the lock', async () => {
    const { alertOnJobFailure } = await import('../lib/job-alerts.js')
    await writeFile(join(DIR, 'rwnd-backup.lock'), '999999')

    await runScheduledDatabaseBackup({ db, dir: DIR, databaseUrl: databaseUrl() })

    expect(alertOnJobFailure).not.toHaveBeenCalled()
  })
})

/**
 * `runPendingRestore` (apps/api/src/lib/database-restore.ts) — the actual
 * drop-and-restore mechanics behind ADR 0008's 2026-09-22 restore-automation
 * update. Run against a genuinely separate scratch database, never the
 * shared `db`/`testDb()` connection every other test file in this suite
 * uses: this function drops every schema it finds, which would otherwise
 * wipe every other file's data mid-run. `DROP DATABASE ... WITH (FORCE)`
 * (PG13+) in the teardown, not a plain `DROP DATABASE`, since a test that
 * fails partway can leave `runPendingRestore`'s own connections still open
 * against the scratch database.
 */
describe.skipIf(!hasPgDump())('database restore (runPendingRestore)', () => {
  let RESTORE_DIR: string
  let scratchName: string
  let scratchUrl: string
  let psqlConn: string[]
  let psqlEnv: NodeJS.ProcessEnv
  let adminDb: string

  beforeEach(async () => {
    RESTORE_DIR = await mkdtemp(join(tmpdir(), 'rwnd-tv-test-restore-'))

    const url = new URL(databaseUrl())
    scratchName = `rwnd_restore_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    psqlEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
    psqlConn = [
      '--host',
      url.hostname,
      '--port',
      url.port || '5432',
      '--username',
      decodeURIComponent(url.username),
      '--no-password',
    ]
    adminDb = url.pathname.replace(/^\//, '')
    execFileSync(
      'psql',
      [...psqlConn, '--dbname', adminDb, '-c', `CREATE DATABASE ${scratchName}`],
      {
        env: psqlEnv,
        stdio: 'ignore',
      },
    )

    const scratch = new URL(databaseUrl())
    scratch.pathname = `/${scratchName}`
    scratchUrl = scratch.toString()

    // Mirrors what the real entrypoint restores onto: an already-running,
    // already-migrated instance, not a fresh unmigrated database — restore
    // runs *before* migrations in docker-entrypoint.sh, against whatever
    // schema the previous boot last left behind.
    execFileSync('pnpm', ['--filter', '@rwnd/db', 'migrate'], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: 'ignore',
      shell: true,
    })
  })

  afterEach(async () => {
    await rm(RESTORE_DIR, { recursive: true, force: true })
    execFileSync(
      'psql',
      [
        ...psqlConn,
        '--dbname',
        adminDb,
        '-c',
        `DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`,
      ],
      { env: psqlEnv, stdio: 'ignore' },
    )
  })

  it('replaces the database with the dump, leaving __drizzle_migrations and citext working', async () => {
    const scratchDb = createDatabase(scratchUrl)
    await scratchDb.insert(users).values({ email: 'old@example.com', displayName: 'Old' })

    const { file } = await runDatabaseBackup({
      db: scratchDb,
      dir: RESTORE_DIR,
      databaseUrl: scratchUrl,
    })

    // Diverge from the dump, so the restore is actually observable.
    await scratchDb.delete(users)
    await scratchDb.insert(users).values({ email: 'new@example.com', displayName: 'New' })
    await scratchDb.$client.end()

    await writeRestoreRequest(RESTORE_DIR, { file, userId: 'test-user' })
    await runPendingRestore({ dir: RESTORE_DIR, databaseUrl: scratchUrl, ssl: false })

    const result = await readLastRestoreResult(RESTORE_DIR)
    expect(result?.status).toBe('ok')
    expect(result?.snapshot).toMatch(PRE_RESTORE_RE)

    const restoredDb = createDatabase(scratchUrl)
    const rows = await restoredDb.select().from(users)
    expect(rows.map((r) => r.email)).toEqual(['old@example.com'])
    // citext survives the schema drop + CREATE EXTENSION IF NOT EXISTS in
    // the dump body: a case-different lookup still matches.
    const [caseInsensitive] = await restoredDb
      .select()
      .from(users)
      .where(eq(users.email, 'OLD@EXAMPLE.COM'))
    expect(caseInsensitive?.email).toBe('old@example.com')
    // The migrations ledger lives in its own `drizzle` schema, not
    // `public` — this only works because runPendingRestore drops every
    // non-system schema (pg_namespace), not a hand-picked list.
    const migrationRows = await restoredDb.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    )
    expect((migrationRows[0] as { count: number }).count).toBeGreaterThan(0)
    await restoredDb.$client.end()

    // The snapshot taken before the restore is on disk and not pruned —
    // never matches DUMP_RE, so retention can never touch it.
    const files = await readdir(RESTORE_DIR)
    expect(files).toContain(result!.snapshot)
  })

  it('leaves the database untouched and records a failure for a truncated (corrupt gzip) dump', async () => {
    const scratchDb = createDatabase(scratchUrl)
    await scratchDb.insert(users).values({ email: 'untouched@example.com', displayName: 'U' })
    await scratchDb.$client.end()

    const badFile = 'rwnd-20260101T000000Z.sql.gz'
    const real = gzipSync('some content that will be truncated below, well past a few bytes')
    await writeFile(join(RESTORE_DIR, badFile), real.subarray(0, 5))

    await writeRestoreRequest(RESTORE_DIR, { file: badFile, userId: 'test-user' })
    await runPendingRestore({ dir: RESTORE_DIR, databaseUrl: scratchUrl, ssl: false })

    const result = await readLastRestoreResult(RESTORE_DIR)
    expect(result?.status).toBe('failed')

    const restoredDb = createDatabase(scratchUrl)
    const rows = await restoredDb.select().from(users)
    expect(rows.map((r) => r.email)).toEqual(['untouched@example.com'])
    await restoredDb.$client.end()
  })

  it('leaves the database untouched and records a failure for a well-formed dump with a bad statement', async () => {
    const scratchDb = createDatabase(scratchUrl)
    await scratchDb.insert(users).values({ email: 'untouched2@example.com', displayName: 'U' })
    await scratchDb.$client.end()

    // Passes preflight (valid gzip, has a complete trailer, no OWNER TO, no
    // pg_dump version header to compare) but fails once psql actually runs
    // it — --single-transaction must roll the whole thing back.
    const badSql = [
      'SELECT 1;',
      'THIS IS NOT VALID SQL AT ALL;',
      '-- PostgreSQL database dump complete',
      '',
    ].join('\n')
    const badFile = 'rwnd-20260102T000000Z.sql.gz'
    await writeFile(join(RESTORE_DIR, badFile), gzipSync(badSql))

    await writeRestoreRequest(RESTORE_DIR, { file: badFile, userId: 'test-user' })
    await runPendingRestore({ dir: RESTORE_DIR, databaseUrl: scratchUrl, ssl: false })

    const result = await readLastRestoreResult(RESTORE_DIR)
    expect(result?.status).toBe('failed')
    // Regression: psql exiting on the bad statement closes its stdin before
    // this process finishes writing the rest of the dump, which makes the
    // input pipeline itself reject with EPIPE — a real message seen live
    // against dev.rwnd.tv (2026-09-23) that carries no diagnostic value.
    // The actual psql stderr must win instead.
    expect(result?.message).not.toMatch(/EPIPE/i)
    expect(result?.message?.toLowerCase()).toContain('syntax error')

    const restoredDb = createDatabase(scratchUrl)
    const rows = await restoredDb.select().from(users)
    expect(rows.map((r) => r.email)).toEqual(['untouched2@example.com'])
    await restoredDb.$client.end()
  })

  it('converts a leftover .attempted marker (an interrupted restore) to a failed result, never retrying it', async () => {
    const scratchDb = createDatabase(scratchUrl)
    await scratchDb.insert(users).values({ email: 'never-touched@example.com', displayName: 'U' })
    await scratchDb.$client.end()

    // Simulates a container killed mid-restore: the request was already
    // claimed (renamed to .attempted) but the process never got to write a
    // result. Postgres itself already rolled the transaction back on
    // disconnect, so the database is genuinely untouched — this only
    // checks that the marker is never acted on again.
    const file = 'rwnd-20260103T000000Z.sql.gz'
    await writeFile(
      join(RESTORE_DIR, 'rwnd-restore-attempted.json'),
      JSON.stringify({ file, userId: 'test-user', requestedAt: new Date().toISOString() }),
    )

    await runPendingRestore({ dir: RESTORE_DIR, databaseUrl: scratchUrl, ssl: false })

    const result = await readLastRestoreResult(RESTORE_DIR)
    expect(result?.status).toBe('failed')
    expect(result?.message).toMatch(/interrupted/i)

    const restoredDb = createDatabase(scratchUrl)
    const rows = await restoredDb.select().from(users)
    expect(rows.map((r) => r.email)).toEqual(['never-touched@example.com'])
    await restoredDb.$client.end()

    const files = await readdir(RESTORE_DIR)
    expect(files).not.toContain('rwnd-restore-attempted.json')
  })

  it('no-ops when there is no pending request', async () => {
    await runPendingRestore({ dir: RESTORE_DIR, databaseUrl: scratchUrl, ssl: false })
    expect(await readLastRestoreResult(RESTORE_DIR)).toBeNull()
  })
})
