import { mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseBackupStatus } from '@rwnd/shared'
import { loadEnv } from '../env.js'
import {
  createLocalUser,
  extractCookie,
  hasPgDump,
  json,
  resetDb,
  testApp,
  testDb,
} from './helpers.js'

const db = testDb()
const app = testApp()
const dir = loadEnv().DATABASE_BACKUP_DIR!

async function createAdminAndCookie(email = 'admin@example.com') {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'Admin' }),
  })
  const body = await json<{ id: string }>(res)
  return { id: body.id, cookie: extractCookie(res)! }
}

async function createUserAndCookie(email: string, opts: { role?: 'admin' | 'user' } = {}) {
  const id = await createLocalUser(db, email, 'correct-horse-battery-staple', opts)
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  })
  return { id, cookie: extractCookie(res)! }
}

// Writing directly under `dir` rather than going through runDatabaseBackup()
// (which shells out to pg_dump, unavailable on Windows/CI without a real
// Postgres client) — this route only ever reads the directory, so a fake
// dump with the right name and some bytes exercises it exactly the same way.
function dumpName(compactIso: string): string {
  return `rwnd-${compactIso}Z.sql.gz`
}

describe('GET /admin/database-backups', () => {
  beforeEach(() => Promise.all([resetDb(db), rm(dir, { recursive: true, force: true })]))

  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/admin/database-backups')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    const user = await createUserAndCookie('plain@example.com')
    const res = await app.request('/api/v1/admin/database-backups', {
      headers: { cookie: user.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('reports no backups yet when the directory has never been created', async () => {
    const admin = await createAdminAndCookie()
    const res = await app.request('/api/v1/admin/database-backups', {
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(200)
    const body = await json<DatabaseBackupStatus>(res)
    expect(body).toEqual({
      configured: true,
      intervalHours: 24,
      retention: { dailyRetentionDays: 7, weeklyRetentionWeeks: 4, monthlyRetentionMonths: 12 },
      files: [],
      lastRun: null,
      directoryError: null,
      // RWND_RESTORE_ENTRYPOINT is never set in the test environment (see
      // vitest.config.ts) — restoreAvailable is false everywhere in this
      // suite, which is also why the actual 202 restore-request path below
      // can only be tested at the runPendingRestore level
      // (database-backup.test.ts), not through this route.
      restoreAvailable: false,
      lastRestore: null,
      snapshots: [],
    })
  })

  it('lists real dumps newest first, ignoring non-matching and partial files', async () => {
    const admin = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    await writeFile(`${dir}/${dumpName('20260901T030000')}`, 'a'.repeat(10))
    await writeFile(`${dir}/${dumpName('20260903T030000')}`, 'b'.repeat(20))
    await writeFile(`${dir}/${dumpName('20260902T030000')}`, 'c'.repeat(30))
    await writeFile(`${dir}/rwnd-20260904T030000Z.sql.gz.partial`, 'd'.repeat(5))
    await writeFile(`${dir}/notes.txt`, 'not a backup')

    const res = await app.request('/api/v1/admin/database-backups', {
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(200)
    const body = await json<DatabaseBackupStatus>(res)
    expect(body.configured).toBe(true)
    expect(body.files.map((f) => f.name)).toEqual([
      dumpName('20260903T030000'),
      dumpName('20260902T030000'),
      dumpName('20260901T030000'),
    ])
    expect(body.files[0]).toEqual({
      name: dumpName('20260903T030000'),
      bytes: 20,
      createdAt: '2026-09-03T03:00:00.000Z',
    })
    expect(body.directoryError).toBeNull()
  })
})

describe('PATCH /admin/database-backups', () => {
  beforeEach(() => Promise.all([resetDb(db), rm(dir, { recursive: true, force: true })]))

  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/admin/database-backups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyRetentionDays: 30 }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    const user = await createUserAndCookie('plain@example.com')
    const res = await app.request('/api/v1/admin/database-backups', {
      method: 'PATCH',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyRetentionDays: 30 }),
    })
    expect(res.status).toBe(403)
  })

  it('persists a partial update and leaves the other tiers unchanged', async () => {
    const admin = await createAdminAndCookie()
    const res = await app.request('/api/v1/admin/database-backups', {
      method: 'PATCH',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyRetentionDays: 365, weeklyRetentionWeeks: 0 }),
    })
    expect(res.status).toBe(200)
    const body = await json<DatabaseBackupStatus>(res)
    expect(body.retention).toEqual({
      dailyRetentionDays: 365,
      weeklyRetentionWeeks: 0,
      monthlyRetentionMonths: 12,
    })

    // Reflected on a fresh GET too, not just the PATCH response itself.
    const getRes = await app.request('/api/v1/admin/database-backups', {
      headers: { cookie: admin.cookie },
    })
    const getBody = await json<DatabaseBackupStatus>(getRes)
    expect(getBody.retention).toEqual(body.retention)
  })

  it('rejects an out-of-bounds value', async () => {
    const admin = await createAdminAndCookie()
    const res = await app.request('/api/v1/admin/database-backups', {
      method: 'PATCH',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyRetentionDays: 0 }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/database-backups/run', () => {
  beforeEach(() => Promise.all([resetDb(db), rm(dir, { recursive: true, force: true })]))

  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/admin/database-backups/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    const user = await createUserAndCookie('plain@example.com')
    const res = await app.request('/api/v1/admin/database-backups/run', {
      method: 'POST',
      headers: { cookie: user.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('returns 409 when another run already holds the lock', async () => {
    // Doesn't need a real pg_dump: acquireBackupLock (database-backup.ts)
    // rejects before the child process is ever spawned, so this exercises
    // the same path on Windows/CI alike.
    const admin = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'rwnd-backup.lock'), '999999')

    const res = await app.request('/api/v1/admin/database-backups/run', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(409)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/already running/i)
  })

  it('treats a stale lock as clearable rather than permanently stuck', async () => {
    const admin = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    const lockPath = join(dir, 'rwnd-backup.lock')
    await writeFile(lockPath, '999999')
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000) // past the 6h staleness window
    await utimes(lockPath, old, old)

    const res = await app.request('/api/v1/admin/database-backups/run', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    // Whether or not pg_dump is actually available here, a stale lock must
    // never produce the "already running" 409 - it's cleared and the run
    // (successful or not) proceeds, always coming back as 200 either way
    // (see the route's own comment on why a generic failure isn't a 409).
    expect(res.status).toBe(200)
  })

  it('rate-limits repeated manual triggers', async () => {
    const admin = await createAdminAndCookie()

    // Whether or not pg_dump is installed here, each of the first 5 calls
    // consumes a rate-limit token in the request middleware before the
    // handler ever runs (real success or a recorded failure both count),
    // so this is a reliable cross-platform check of the limit itself.
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/v1/admin/database-backups/run', {
        method: 'POST',
        headers: { cookie: admin.cookie },
      })
      expect(res.status).toBe(200)
    }

    const sixth = await app.request('/api/v1/admin/database-backups/run', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(sixth.status).toBe(429)
  })

  it.skipIf(!hasPgDump())('writes a real dump and reflects it in the returned status', async () => {
    const admin = await createAdminAndCookie()
    const res = await app.request('/api/v1/admin/database-backups/run', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(res.status).toBe(200)
    const body = await json<DatabaseBackupStatus>(res)
    expect(body.files).toHaveLength(1)
    expect(body.files[0]!.name).toMatch(/^rwnd-\d{8}T\d{6}Z\.sql\.gz$/)
    expect(body.lastRun).toEqual({ at: expect.any(String), status: 'ok', message: null })
  })
})

/**
 * `POST /admin/database-backups/{file}/restore` — the destructive whole-
 * database restore route, ADR 0008's 2026-09-22 update. The route checks
 * filename shape, instance-name confirmation, password, file existence and
 * the pre-flight dump checks *before* the RWND_RESTORE_ENTRYPOINT gate
 * (deliberately — see the route's own comment), so all of that is
 * reachable and tested here even though this suite never sets that env var
 * (vitest.config.ts doesn't, and loadEnv() caches on first call, so there's
 * no per-test way to flip it). Only the final "does the entrypoint pick
 * this up" step is untestable at this level, and it always 409s here —
 * proven by the last test below, which passes every other check first. The
 * actual drop-and-restore mechanics are covered end-to-end against a real
 * scratch database in database-backup.test.ts's runPendingRestore suite,
 * which doesn't go through this route or that flag at all.
 */
describe('POST /admin/database-backups/{file}/restore', () => {
  beforeEach(() => Promise.all([resetDb(db), rm(dir, { recursive: true, force: true })]))

  function restoreBody(
    overrides: Partial<{ confirmInstanceName: string; currentPassword: string }> = {},
  ) {
    return JSON.stringify({
      confirmInstanceName: 'rwnd.tv',
      currentPassword: 'correct-horse-battery-staple',
      ...overrides,
    })
  }

  async function restore(file: string, cookie: string, body = restoreBody()) {
    return app.request(`/api/v1/admin/database-backups/${encodeURIComponent(file)}/restore`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body,
    })
  }

  /** A file that passes every pre-flight check without needing real pg_dump:
   * valid gzip, a complete trailer, no `OWNER TO` (so the owner-role check
   * never applies) and no `-- Dumped by pg_dump version` header (so the
   * version check never applies either). preflightCheckDump is pure Node
   * stream/readline code with no dependency on the pg_dump/psql binaries
   * themselves — only running an actual restore does. */
  async function writeValidDump(name: string) {
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, name),
      gzipSync(['SELECT 1;', '-- PostgreSQL database dump complete', ''].join('\n')),
    )
  }

  it('rejects an unauthenticated request', async () => {
    const res = await app.request('/api/v1/admin/database-backups/some-file/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: restoreBody(),
    })
    expect(res.status).toBe(401)
  })

  it('rejects an admin who is not the owner (requireOwner, stricter than requireAdmin)', async () => {
    const admin = await createUserAndCookie('admin@example.com', { role: 'admin' })
    const res = await restore('some-file', admin.cookie)
    expect(res.status).toBe(403)
  })

  it('rejects a plain user', async () => {
    const user = await createUserAndCookie('plain@example.com')
    const res = await restore('some-file', user.cookie)
    expect(res.status).toBe(403)
  })

  it('rejects a filename matching neither a backup nor a pre-restore snapshot pattern', async () => {
    const owner = await createAdminAndCookie()
    const res = await restore('not-a-real-backup.txt', owner.cookie)
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/not a recognized/i)
  })

  it('accepts a pre-restore snapshot filename shape too, not just a regular backup', async () => {
    const owner = await createAdminAndCookie()
    const res = await restore('rwnd-pre-restore-20260909T030000Z.sql.gz', owner.cookie)
    // No such file on disk — proves the filename-shape check passed and it
    // moved on to the next check (instance name matched here, so this gets
    // as far as the file-existence check).
    expect(res.status).toBe(404)
  })

  it('rejects a wrong instance name, before ever touching the filesystem', async () => {
    const owner = await createAdminAndCookie()
    const res = await restore(
      'rwnd-20260909T030000Z.sql.gz',
      owner.cookie,
      restoreBody({ confirmInstanceName: 'not the right name' }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/does not match/i)
  })

  it('rejects a wrong password', async () => {
    const owner = await createAdminAndCookie()
    const res = await restore(
      'rwnd-20260909T030000Z.sql.gz',
      owner.cookie,
      restoreBody({ currentPassword: 'definitely-not-it' }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/incorrect/i)
  })

  it('404s when the confirmed file does not exist on disk', async () => {
    const owner = await createAdminAndCookie()
    const res = await restore('rwnd-20260909T030000Z.sql.gz', owner.cookie)
    expect(res.status).toBe(404)
  })

  it('rejects a file that fails pre-flight (corrupt gzip)', async () => {
    const owner = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'rwnd-20260909T030000Z.sql.gz'), 'not gzip at all')

    const res = await restore('rwnd-20260909T030000Z.sql.gz', owner.cookie)
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/gzip/i)
  })

  it('rejects a file that fails pre-flight (no complete trailer — looks truncated)', async () => {
    const owner = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'rwnd-20260909T030000Z.sql.gz'), gzipSync('SELECT 1;'))

    const res = await restore('rwnd-20260909T030000Z.sql.gz', owner.cookie)
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/truncated|complete/i)
  })

  it('409s when a restore is already pending, before ever looking at the requested filename', async () => {
    const owner = await createAdminAndCookie()
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'rwnd-restore-request.json'),
      JSON.stringify({ file: 'rwnd-20260101T000000Z.sql.gz', userId: 'someone-else' }),
    )

    // A second, otherwise-completely-invalid request still 409s first,
    // rather than 400ing on the filename — proves the pending-restore
    // guard runs before filename validation, so a second submission can
    // never silently overwrite the first request's marker file.
    const res = await restore('not-a-real-file.txt', owner.cookie)
    expect(res.status).toBe(409)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/already pending/i)
  })

  it('409s because this API instance is not running under docker-entrypoint.sh, once everything else has checked out', async () => {
    const owner = await createAdminAndCookie()
    await writeValidDump('rwnd-20260909T030000Z.sql.gz')

    const res = await restore('rwnd-20260909T030000Z.sql.gz', owner.cookie)
    expect(res.status).toBe(409)
    const body = await json<{ error: string }>(res)
    expect(body.error).toMatch(/docker-entrypoint\.sh/)

    // Nothing was written or requested — the gate above fired before any
    // of that.
    const files = await readdir(dir)
    expect(files).not.toContain('rwnd-restore-request.json')
  })

  it('rate-limits repeated restore attempts tighter than the manual backup route (3/hour)', async () => {
    const owner = await createAdminAndCookie()

    for (let i = 0; i < 3; i++) {
      const res = await restore('some-file', owner.cookie)
      // Rejected on filename shape each time — the point here is only that
      // the rate limiter counts the attempt regardless of why it failed.
      expect(res.status).toBe(400)
    }

    const fourth = await restore('some-file', owner.cookie)
    expect(fourth.status).toBe(429)
  })
})
