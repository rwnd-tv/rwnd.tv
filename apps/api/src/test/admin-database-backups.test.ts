import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

async function createUserAndCookie(email: string) {
  const id = await createLocalUser(db, email, 'correct-horse-battery-staple')
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
