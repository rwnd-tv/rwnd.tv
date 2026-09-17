import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { instanceSettings } from '@rwnd/db'
import {
  databaseBackupStatusSchema,
  updateDatabaseBackupRetentionRequestSchema,
} from '@rwnd/shared'
import type { AppEnv } from '../types.js'
import { loadEnv } from '../env.js'
import { requireAdmin } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import {
  BACKUP_INTERVAL_HOURS,
  BackupAlreadyRunningError,
  getLastDatabaseBackupRun,
  getRetentionTiers,
  listDatabaseBackups,
  runAndRecordDatabaseBackup,
  type RetentionTiers,
} from '../lib/database-backup.js'

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
 */
export const adminDatabaseBackupRoutes = new OpenAPIHono<AppEnv>()

async function buildStatus(c: Context<AppEnv>): Promise<{
  configured: boolean
  intervalHours: number
  retention: RetentionTiers
  files: { name: string; bytes: number; createdAt: string }[]
  lastRun: { at: string; status: 'ok' | 'failed'; message: string | null } | null
  directoryError: string | null
}> {
  const dir = loadEnv().DATABASE_BACKUP_DIR
  const db = c.get('db')
  const retention = await getRetentionTiers(db)
  const lastRun = getLastDatabaseBackupRun()

  if (!dir) {
    return {
      configured: false,
      intervalHours: BACKUP_INTERVAL_HOURS,
      retention,
      files: [],
      lastRun: null,
      directoryError: null,
    }
  }

  let files: Awaited<ReturnType<typeof listDatabaseBackups>> = []
  let directoryError: string | null = null
  try {
    files = await listDatabaseBackups(dir)
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
