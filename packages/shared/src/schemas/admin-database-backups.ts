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

/**
 * `POST /admin/database-backups/{file}/restore` body (owner only, ADR 0008's
 * 2026-09-22 update). Both fields re-prove the caller's identity/intent for
 * the single most destructive action in the app — same "typed confirmation
 * plus current password" shape DeleteAccountCard.tsx and
 * TransferOwnershipCard.tsx already use, except the typed value here is the
 * instance name rather than the word DELETE, since the consequence (every
 * user's data replaced) is instance-wide, not the caller's own account.
 */
export const restoreDatabaseBackupRequestSchema = z.object({
  confirmInstanceName: z.string().min(1),
  currentPassword: z.string().min(1),
})
export type RestoreDatabaseBackupRequest = z.infer<typeof restoreDatabaseBackupRequestSchema>

/**
 * A completed (or interrupted) restore's outcome, written by
 * runPendingRestore (apps/api/src/lib/database-restore.ts) to a file rather
 * than a table — a successful restore's very first act is replacing the
 * database this process would otherwise have recorded it in. Read by the
 * admin status route as `lastRestore` below.
 */
export const databaseRestoreResultSchema = z.object({
  file: z.string(),
  requestedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  status: z.enum(['ok', 'failed']),
  message: z.string().nullable(),
  /** The pre-restore snapshot taken before this restore, if it got that
   * far — null on a failure before the snapshot step (or if the snapshot
   * itself failed). */
  snapshot: z.string().nullable(),
})
export type DatabaseRestoreResult = z.infer<typeof databaseRestoreResultSchema>

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
  // False when the API isn't running under docker-entrypoint.sh (a bare
  // `node dist/index.js`, or `pnpm dev:api`) — nothing would ever pick up a
  // restore request in that case, so the panel explains why rather than
  // offering a button that silently does nothing (RWND_RESTORE_ENTRYPOINT,
  // apps/api/src/env.ts).
  restoreAvailable: z.boolean(),
  lastRestore: databaseRestoreResultSchema.nullable(),
  snapshots: z.array(databaseBackupFileSchema),
})
export type DatabaseBackupStatus = z.infer<typeof databaseBackupStatusSchema>
