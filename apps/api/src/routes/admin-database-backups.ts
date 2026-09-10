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
import {
  BACKUP_INTERVAL_HOURS,
  getLastDatabaseBackupRun,
  getRetentionTiers,
  listDatabaseBackups,
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
