import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { instanceSettings, userCredentials } from '@rwnd/db'
import {
  databaseBackupStatusSchema,
  restoreDatabaseBackupRequestSchema,
  updateDatabaseBackupRetentionRequestSchema,
} from '@rwnd/shared'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { requireAdmin, requireOwner } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { verifyPassword } from '../lib/password.js'
import { logSecurityEvent } from '../lib/security-log.js'
import {
  BACKUP_INTERVAL_HOURS,
  BackupAlreadyRunningError,
  DUMP_RE,
  acquireBackupLock,
  getLastDatabaseBackupRun,
  getRetentionTiers,
  listDatabaseBackups,
  releaseBackupLock,
  runAndRecordDatabaseBackup,
  type RetentionTiers,
} from '../lib/database-backup.js'
import {
  PRE_RESTORE_RE,
  exitForRestore,
  hasPendingRestore,
  listPreRestoreSnapshots,
  preflightCheckDump,
  readLastRestoreResult,
  writeRestoreRequest,
} from '../lib/database-restore.js'

/**
 * Admin-only status for, and retention policy of, the automatic
 * whole-database backup job (apps/api/src/lib/database-backup.ts, ADR
 * 0008, docs/TODO.md's "Admin interface for the instance's automatic
 * database backups"). `GET` needs `db` only to read the current
 * RetentionTiers (`instance_settings`); the file listing itself still
 * reads DATABASE_BACKUP_DIR directly, same as GET /backups reads the
 * per-user backup directory rather than a table.
 *
 * `configured: false` short-circuits before touching the filesystem at
 * all, same reasoning as backups.ts's own `backupsConfigured` gate.
 *
 * `POST .../run` (below) triggers an immediate pass on request rather than
 * on the timer `scheduleDatabaseBackup` runs — deliberately a separate
 * route from the two above, not a flag on either, since spawning a process
 * on request is a different security shape (its own rate limit, on top of
 * the concurrent-run guard the scheduled job already needed).
 *
 * `POST .../{file}/restore` (below) is whole-database restore automation,
 * ADR 0008's 2026-09-22 update. Owner-only — this is the single most
 * destructive action in the app, replacing every user's data, not just the
 * caller's own — and gated on RWND_RESTORE_ENTRYPOINT: the route only ever
 * writes a request marker and exits, so without docker-entrypoint.sh's
 * restore-entrypoint.ts step to pick it up on the next boot, nothing would
 * ever act on it. See apps/api/src/lib/database-restore.ts's module doc
 * comment for the full design.
 */
export const adminDatabaseBackupRoutes = new OpenAPIHono<AppEnv>()

async function buildStatus(c: Context<AppEnv>): Promise<{
  configured: boolean
  intervalHours: number
  retention: RetentionTiers
  files: { name: string; bytes: number; createdAt: string }[]
  lastRun: { at: string; status: 'ok' | 'failed'; message: string | null } | null
  directoryError: string | null
  restoreAvailable: boolean
  lastRestore: {
    file: string
    requestedAt: string
    finishedAt: string
    status: 'ok' | 'failed'
    message: string | null
    snapshot: string | null
  } | null
  snapshots: { name: string; bytes: number; createdAt: string }[]
}> {
  const dir = loadEnv().DATABASE_BACKUP_DIR
  const db = c.get('db')
  const retention = await getRetentionTiers(db)
  const lastRun = getLastDatabaseBackupRun()
  const restoreAvailable = Boolean(loadEnv().RWND_RESTORE_ENTRYPOINT)

  if (!dir) {
    return {
      configured: false,
      intervalHours: BACKUP_INTERVAL_HOURS,
      retention,
      files: [],
      lastRun: null,
      directoryError: null,
      restoreAvailable,
      lastRestore: null,
      snapshots: [],
    }
  }

  let files: Awaited<ReturnType<typeof listDatabaseBackups>> = []
  let snapshots: Awaited<ReturnType<typeof listPreRestoreSnapshots>> = []
  let directoryError: string | null = null
  try {
    ;[files, snapshots] = await Promise.all([
      listDatabaseBackups(dir),
      listPreRestoreSnapshots(dir),
    ])
  } catch (err) {
    // ENOENT means the scheduler hasn't taken its first pass yet (it
    // creates the directory itself, mkdir-recursive, before writing) —
    // that's "no backups yet," not a misconfiguration. Anything else
    // (permissions, a broken mount) is worth surfacing: it's the
    // likeliest reason this screen would otherwise just show nothing.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      directoryError = err instanceof Error ? err.message : String(err)
    }
  }
  const lastRestore = await readLastRestoreResult(dir)

  return {
    configured: true,
    intervalHours: BACKUP_INTERVAL_HOURS,
    retention,
    files: files.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      createdAt: file.createdAt.toISOString(),
    })),
    lastRun: lastRun && {
      at: lastRun.at.toISOString(),
      status: lastRun.status,
      message: lastRun.message,
    },
    directoryError,
    restoreAvailable,
    lastRestore,
    snapshots: snapshots.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      createdAt: file.createdAt.toISOString(),
    })),
  }
}

adminDatabaseBackupRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/admin/database-backups',
    summary: 'Status of the automatic whole-database backup job (admin only)',
    middleware: [requireAdmin] as const,
    responses: {
      200: {
        description: 'Database backup status',
        content: { 'application/json': { schema: databaseBackupStatusSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => c.json(await buildStatus(c)),
)

adminDatabaseBackupRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/admin/database-backups',
    summary: "Update the automatic whole-database backup job's retention policy (admin only)",
    middleware: [requireAdmin] as const,
    request: {
      body: {
        content: { 'application/json': { schema: updateDatabaseBackupRetentionRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'Updated database backup status',
        content: { 'application/json': { schema: databaseBackupStatusSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')

    const changed = {
      ...(body.dailyRetentionDays !== undefined && {
        databaseBackupDailyRetentionDays: body.dailyRetentionDays,
      }),
      ...(body.weeklyRetentionWeeks !== undefined && {
        databaseBackupWeeklyRetentionWeeks: body.weeklyRetentionWeeks,
      }),
      ...(body.monthlyRetentionMonths !== undefined && {
        databaseBackupMonthlyRetentionMonths: body.monthlyRetentionMonths,
      }),
    }

    if (Object.keys(changed).length > 0) {
      // Upsert, same reasoning as PATCH /settings (settings.ts): the
      // singleton row isn't guaranteed to exist yet (a genuinely fresh
      // instance, or a test's resetDb() truncation) — id:1 plus `changed`
      // is a complete insert on its own, since every other column on this
      // table (including the three retention columns themselves) has a
      // schema-level default.
      await db
        .insert(instanceSettings)
        .values({ id: 1, ...changed })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: { ...changed, updatedAt: new Date() },
        })
    }

    return c.json(await buildStatus(c))
  },
)

adminDatabaseBackupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/admin/database-backups/run',
    summary: 'Trigger an immediate whole-database backup (admin only)',
    // A route that spawns a process on request, unlike the timer-driven
    // scheduler — its own security shape, per docs/TODO.md: rate-limited
    // per admin (same budget class as setup/register's 5/hour) on top of
    // runAndRecordDatabaseBackup's own cross-process concurrent-run guard,
    // rather than relying on the guard alone to stop an admin mashing the
    // button.
    middleware: [
      requireAdmin,
      rateLimit({
        name: 'admin:database-backups:run',
        limit: 5,
        windowMs: 60 * 60 * 1000,
        key: (c) => c.get('user')!.id,
      }),
    ] as const,
    responses: {
      200: {
        description: 'Updated database backup status',
        content: { 'application/json': { schema: databaseBackupStatusSchema } },
      },
      403: { description: 'Admin only' },
      409: { description: 'Backups are not configured, or one is already running' },
      429: { description: 'Too many manual runs — see the rate limit window' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const env = loadEnv()
    const dir = env.DATABASE_BACKUP_DIR
    if (!dir) {
      return c.json({ error: 'Automatic database backups are not configured.' }, 409)
    }

    try {
      await runAndRecordDatabaseBackup({ db, dir, databaseUrl: env.DATABASE_URL })
    } catch (err) {
      if (err instanceof BackupAlreadyRunningError) {
        return c.json({ error: 'A backup is already running. Try again shortly.' }, 409)
      }
      // Any other failure is already recorded in lastRun by
      // runAndRecordDatabaseBackup and surfaces via buildStatus below, the
      // same way a scheduled run's failure does — no separate error
      // response needed here.
    }

    return c.json(await buildStatus(c))
  },
)

adminDatabaseBackupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/admin/database-backups/{file}/restore',
    summary:
      'Restore the whole database from a backup or a pre-restore snapshot, replacing all current data (owner only)',
    // Owner only (requireOwner, not requireAdmin) — the same bar as this
    // app's only other requireOwner route, POST /auth/me/transfer-ownership
    // (auth.ts): this destroys every user's data, not just the caller's
    // own. Rate-limited tighter than the manual "back up now" route above
    // (3/hour vs 5/hour) — there is close to never a legitimate reason to
    // attempt several restores in quick succession.
    middleware: [
      requireOwner,
      rateLimit({
        name: 'admin:database-backups:restore',
        limit: 3,
        windowMs: 60 * 60 * 1000,
        key: (c) => c.get('user')!.id,
      }),
    ] as const,
    request: {
      params: z.object({ file: z.string() }),
      body: { content: { 'application/json': { schema: restoreDatabaseBackupRequestSchema } } },
    },
    responses: {
      202: { description: 'Restore requested — the server will restart shortly' },
      400: {
        description:
          "Instance name or password didn't match, the filename isn't recognized, or the file failed a pre-flight check",
      },
      403: { description: 'Owner only' },
      404: { description: 'File not found' },
      409: {
        description:
          'Backups are not configured, a restore is already pending, a backup is already running, or this API instance is not running under docker-entrypoint.sh',
      },
      429: { description: 'Too many restore attempts — see the rate limit window' },
    },
  }),
  async (c) => {
    const db = c.get('db')
    const owner = c.get('user')!
    const env = loadEnv()
    const dir = env.DATABASE_BACKUP_DIR
    const { file } = c.req.valid('param')
    const { confirmInstanceName, currentPassword } = c.req.valid('json')

    if (!dir) {
      return c.json({ error: 'Automatic database backups are not configured.' }, 409)
    }
    // Guards against a second restore submitted in the brief window before
    // the process actually exits (exitForRestore's own delay, plus however
    // long the container genuinely takes to restart) — the marker files
    // are each a single fixed filename, so a second request would
    // otherwise silently overwrite the first one's.
    if (await hasPendingRestore(dir)) {
      return c.json({ error: 'A restore is already pending.' }, 409)
    }
    if (!DUMP_RE.test(file) && !PRE_RESTORE_RE.test(file)) {
      return c.json({ error: 'Not a recognized backup file.' }, 400)
    }

    const [settings] = await db
      .select({ instanceName: instanceSettings.instanceName })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1))
    // The `instance_settings` default, mirrored — see the column's own
    // default in packages/db/src/schema.ts. A fresh instance (row never
    // written) must still be confirmable by its real displayed name.
    const instanceName = settings?.instanceName ?? 'rwnd.tv'
    if (confirmInstanceName !== instanceName) {
      return c.json({ error: 'Instance name does not match.' }, 400)
    }

    // Same "re-prove the current password" reasoning as
    // POST /auth/me/transfer-ownership — this is the single highest-risk
    // action in the app.
    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, owner.id), eq(userCredentials.type, 'local')))
      .limit(1)
    if (
      !credential?.passwordHash ||
      !(await verifyPassword(credential.passwordHash, currentPassword))
    ) {
      return c.json({ error: 'Current password is incorrect' }, 400)
    }

    const dumpPath = join(dir, file)
    if (!existsSync(dumpPath)) {
      return c.json({ error: 'File not found.' }, 404)
    }

    const [row] = (await db.execute(
      sql`select current_setting('server_version_num')::int / 10000 as major`,
    )) as { major: number }[]
    const serverMajor = row?.major ?? 0
    const role = decodeURIComponent(new URL(env.DATABASE_URL).username)
    const preflight = await preflightCheckDump(dumpPath, { serverMajor, role })
    if (!preflight.ok) {
      return c.json({ error: preflight.detail ?? 'This file failed a pre-flight check.' }, 400)
    }

    // Checked last, only once the request has otherwise fully checked out —
    // everything above (filename shape, instance name, password, file
    // existence, preflight) is real validation worth surfacing on its own
    // terms even when this gate would 409 anyway, and this is the only
    // check that's actually meaningless without the entrypoint (the write
    // + exit below would just do nothing).
    if (!env.RWND_RESTORE_ENTRYPOINT) {
      return c.json(
        {
          error:
            'This API instance is not running under docker-entrypoint.sh, so a restore would never be picked up.',
        },
        409,
      )
    }

    // Acquired and released rather than held: the actual restore doesn't
    // run until the next boot (see database-restore.ts), so there is
    // nothing for this process to hold the lock across. This purely checks
    // "is a backup running right now" before committing to a restore
    // request that a concurrent scheduled/manual backup could otherwise
    // silently race for the same lock on the next boot.
    try {
      const lock = await acquireBackupLock(dir)
      await releaseBackupLock(lock, dir)
    } catch (err) {
      if (err instanceof BackupAlreadyRunningError) {
        return c.json({ error: 'A backup is already running. Try again shortly.' }, 409)
      }
      throw err
    }

    await writeRestoreRequest(dir, { file, userId: owner.id })
    logSecurityEvent('database_restore_requested', { userId: owner.id, file })

    exitForRestore()
    return c.body(null, 202)
  },
)
