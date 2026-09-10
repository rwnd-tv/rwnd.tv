import { z } from 'zod'

/**
 * Backs `GET /admin/database-backups`
 * (apps/api/src/routes/admin-database-backups.ts), the read-only admin
 * status view for the automatic whole-database `pg_dump` job
 * (apps/api/src/lib/database-backup.ts, ADR 0008). Deliberately separate
 * from schemas/backups.ts, which is the unrelated per-user JSON
 * backup/restore feature (`BACKUP_DIR`, not `DATABASE_BACKUP_DIR`) — ADR
 * 0008 keeps the two apart on purpose.
 *
 * `configured` lives on this admin-only response rather than on the public
 * `instanceSettingsSchema` (unlike `backupsConfigured`/`traktConfigured`
 * etc.): the panel that reads this stays visible either way and explains
 * why when it's false (docs/TODO.md's "explain, don't disappear" panel
 * convention), so there's no pre-login UI decision that needs this flag
 * before the admin-only route is even reachable.
 */
export const databaseBackupFileSchema = z.object({
  name: z.string(),
  bytes: z.number().int(),
  createdAt: z.string().datetime(),
})
export type DatabaseBackupFile = z.infer<typeof databaseBackupFileSchema>

/** `status: 'failed'` covers a run that threw before ever writing a file
 * (e.g. a pg_dump version mismatch) — the only way that's visible at all,
 * since a directory listing alone would just show a stale newest dump. */
export const databaseBackupRunSchema = z.object({
  at: z.string().datetime(),
  status: z.enum(['ok', 'failed']),
  message: z.string().nullable(),
})
export type DatabaseBackupRun = z.infer<typeof databaseBackupRunSchema>

/**
 * A GFS-style (grandfather-father-son) retention policy — see
 * apps/api/src/lib/database-backup.ts's `RetentionTiers` doc comment for
 * the algorithm. Admin-editable via `PATCH /admin/database-backups`,
 * unlike `intervalHours` below: the underlying job's cadence is fixed, only
 * how long a given dump survives is configurable. Bounds are a generous
 * sanity ceiling, not a recommended value — "daily backups, kept for a
 * year, nothing else" needs `dailyRetentionDays: 365` with the other two
 * tiers at 0.
 */
export const databaseBackupRetentionSchema = z.object({
  dailyRetentionDays: z.number().int().min(1).max(3650),
  weeklyRetentionWeeks: z.number().int().min(0).max(520),
  monthlyRetentionMonths: z.number().int().min(0).max(600),
})
export type DatabaseBackupRetention = z.infer<typeof databaseBackupRetentionSchema>

/** `PATCH /admin/database-backups` body — partial, so an admin can change
 * just one tier without resending the other two. */
export const updateDatabaseBackupRetentionRequestSchema = databaseBackupRetentionSchema.partial()
export type UpdateDatabaseBackupRetentionRequest = z.infer<
  typeof updateDatabaseBackupRetentionRequestSchema
>

export const databaseBackupStatusSchema = z.object({
  configured: z.boolean(),
  // The real, fixed cadence (BACKUP_INTERVAL_HOURS in database-backup.ts),
  // informational only — see databaseBackupRetentionSchema above for what's
  // actually editable.
  intervalHours: z.number().int(),
  retention: databaseBackupRetentionSchema,
  files: z.array(databaseBackupFileSchema),
  // Null until the first run of this process — held in memory only, not
  // persisted, so it resets on restart (acceptable: a pass runs immediately
  // on boot).
  lastRun: databaseBackupRunSchema.nullable(),
  // Set when DATABASE_BACKUP_DIR is configured but couldn't be read (wrong
  // mount, permissions) — the likeliest misconfiguration, which would
  // otherwise surface as a 500 on exactly the screen meant to answer "is
  // this working?".
  directoryError: z.string().nullable(),
})
export type DatabaseBackupStatus = z.infer<typeof databaseBackupStatusSchema>
