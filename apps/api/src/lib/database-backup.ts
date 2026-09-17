import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, stat, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { eq, sql } from 'drizzle-orm'
import { instanceSettings, type Database } from '@rwnd/db'
import { loadEnv } from '../env.js'

/**
 * Only files matching this are ever considered, for listing or for deletion.
 * Same defence-in-depth instinct as BACKUP_ID_RE in
 * apps/api/src/backup/paths.ts: DATABASE_BACKUP_DIR is a bind mount a human
 * may also drop files into, so the retention sweep has to be structurally
 * incapable of deleting anything this job didn't write.
 */
const DUMP_RE = /^rwnd-\d{8}T\d{6}Z\.sql\.gz$/

/** Same file, mid-write. Deliberately its own pattern rather than
 * `DUMP_RE.test(name.slice(0, -'.partial'.length))`: a plain
 * `.endsWith('.partial')` check (what this used to be) would let the stale-
 * partial sweep below delete *any* `.partial` file a human placed in the
 * bind mount, not just this job's own — the exact thing DUMP_RE above
 * exists to rule out, just missed on this one path. Found in the M4
 * milestone review (docs/TODO.md). */
const PARTIAL_DUMP_RE = /^rwnd-\d{8}T\d{6}Z\.sql\.gz\.partial$/

/** A partial older than this is from a crashed run, not one in flight, so
 * it's safe to clear. Generous relative to how long a dump of a
 * self-hosted instance actually takes. */
const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000

/** Name of the cross-process lock file guarding runDatabaseBackup (see
 * acquireBackupLock below). Deliberately doesn't match DUMP_RE or
 * PARTIAL_DUMP_RE, so prune()'s sweep and listDatabaseBackups() never see
 * it. */
const LOCK_FILE_NAME = 'rwnd-backup.lock'

/** A lock this old is from a crashed run, not one in flight - same margin
 * as STALE_PARTIAL_MS, since a real run never legitimately holds it
 * anywhere near this long. */
const STALE_LOCK_MS = STALE_PARTIAL_MS

/** Thrown by runDatabaseBackup when another run already holds the lock.
 * Distinct from a failed dump: nothing went wrong, a backup is just
 * already in progress elsewhere. Exported so callers (the scheduler
 * below, and eventually a manual "back up now" route) can report
 * "already running" instead of treating it as a failure. */
export class BackupAlreadyRunningError extends Error {
  constructor() {
    super('A database backup is already running.')
    this.name = 'BackupAlreadyRunningError'
  }
}

/**
 * Cross-process mutual exclusion for runDatabaseBackup: `open(path, 'wx')`
 * fails with EEXIST if the file already exists, and that check-and-create is
 * atomic at the filesystem level (unlike a separate exists-check followed by
 * a write), so it holds even against two processes racing to acquire the
 * lock at the exact same instant - e.g. a botched deploy briefly running two
 * containers against the same DATABASE_BACKUP_DIR, or a manual "back up now"
 * trigger racing the scheduled job.
 *
 * A lock found older than STALE_LOCK_MS is assumed left over from a run that
 * crashed before releasing it, and is cleared before retrying; bounded to a
 * handful of attempts rather than retried forever, since a lock that keeps
 * reappearing means something else is wrong and should surface as "already
 * running" rather than loop silently.
 */
async function acquireBackupLock(dir: string): Promise<FileHandle> {
  const lockPath = join(dir, LOCK_FILE_NAME)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(String(process.pid))
      return handle
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const info = await stat(lockPath).catch(() => null)
    // Vanished between our failed open() and this stat - another run just
    // released it, so loop straight back to acquiring rather than treating
    // that as staleness.
    if (info !== null && Date.now() - info.mtimeMs > STALE_LOCK_MS) {
      await unlink(lockPath).catch(() => {})
    } else if (info !== null) {
      throw new BackupAlreadyRunningError()
    }
  }
  throw new BackupAlreadyRunningError()
}

/** Releases a lock acquired by acquireBackupLock. Best-effort: a failure to
 * unlink here would otherwise mask the real result of the run it guarded,
 * and a lock left behind is simply treated as stale (STALE_LOCK_MS) by the
 * next run anyway. */
async function releaseBackupLock(handle: FileHandle, dir: string): Promise<void> {
  await handle.close().catch(() => {})
  await unlink(join(dir, LOCK_FILE_NAME)).catch(() => {})
}

export interface DatabaseBackupResult {
  file: string
  bytes: number
  durationMs: number
  pruned: number
}

export interface DatabaseBackupFile {
  name: string
  bytes: number
  createdAt: Date
}

export interface DatabaseBackupRun {
  at: Date
  status: 'ok' | 'failed'
  message: string | null
}

/**
 * A GFS-style (grandfather-father-son) retention policy: recent dumps kept
 * at full daily granularity, thinning to one per week and then one per
 * month as they age, then dropped entirely. Admin-editable (`instance_
 * settings` columns, PATCH /admin/database-backups) — replaced the earlier
 * flat "keep newest 7" (James, 2026-09-10: wanted something closer to
 * "daily for a week, weekly for a month, monthly for a year," and flexible
 * enough that "just daily backups, kept for a year" is also expressible).
 */
export interface RetentionTiers {
  dailyRetentionDays: number
  weeklyRetentionWeeks: number
  monthlyRetentionMonths: number
}

/** Matches the `instance_settings` column defaults — used when a caller
 * needs a tiers value without a `db` round trip (there is none today, but
 * keeping this next to the schema.ts defaults makes them easy to compare
 * if either ever drifts). */
export const DEFAULT_RETENTION_TIERS: RetentionTiers = {
  dailyRetentionDays: 7,
  weeklyRetentionWeeks: 4,
  monthlyRetentionMonths: 12,
}

/** Reads the current retention policy from the `instance_settings`
 * singleton row (id 1, always present — see packages/db/src/seed.ts). */
export async function getRetentionTiers(db: Database): Promise<RetentionTiers> {
  const [row] = await db
    .select({
      dailyRetentionDays: instanceSettings.databaseBackupDailyRetentionDays,
      weeklyRetentionWeeks: instanceSettings.databaseBackupWeeklyRetentionWeeks,
      monthlyRetentionMonths: instanceSettings.databaseBackupMonthlyRetentionMonths,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
  return row ?? DEFAULT_RETENTION_TIERS
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Which dump names survive a sweep under `tiers`, given each dump's age
 * relative to `now`. `dumps` must be newest first (sortedDumpNames' order).
 *
 * Boundaries are cumulative: a dump younger than `dailyRetentionDays` is
 * bucketed by UTC calendar day and only the newest per day survives. Under
 * normal operation this is a no-op (the job only runs once a day), but it's
 * what actually caps a restart's or a manual "back up now" trigger's extra
 * same-day dump from surviving forever within the window — found the hard
 * way 2026-09-17, when both dev and prod had several same-day duplicates
 * this tier was keeping every one of, pruned by hand rather than by the
 * retention policy itself. Between the daily and weekly boundaries, dumps
 * are bucketed into 7-day periods and only the newest per bucket survives.
 * Between the weekly and monthly boundaries, the same happens in 30-day
 * buckets (an approximation, not calendar months — fine for a coarse
 * retention window). At or past the monthly boundary, nothing survives.
 *
 * Setting `weeklyRetentionWeeks`/`monthlyRetentionMonths` to 0 collapses
 * that tier's boundary width to zero, so no dump ever falls inside it —
 * that's how a policy like "daily backups, kept for a year, nothing else"
 * (`dailyRetentionDays: 365, weeklyRetentionWeeks: 0,
 * monthlyRetentionMonths: 0`) drops straight from the daily tier to the
 * hard cutoff.
 */
export function selectDumpsToKeep(
  dumps: { name: string; createdAt: Date }[],
  now: Date,
  tiers: RetentionTiers,
): Set<string> {
  const dailyBoundaryMs = tiers.dailyRetentionDays * DAY_MS
  const weeklyBoundaryMs = dailyBoundaryMs + tiers.weeklyRetentionWeeks * 7 * DAY_MS
  const monthlyBoundaryMs = weeklyBoundaryMs + tiers.monthlyRetentionMonths * 30 * DAY_MS

  const keep = new Set<string>()
  // First dump seen per bucket wins — `dumps` is newest first, so that's
  // the newest dump in that period, matching "keep the most recent
  // snapshot representing this day/week/month."
  const dailyBuckets = new Map<string, string>()
  const weeklyBuckets = new Map<number, string>()
  const monthlyBuckets = new Map<number, string>()

  for (const dump of dumps) {
    const ageMs = now.getTime() - dump.createdAt.getTime()
    if (ageMs < dailyBoundaryMs) {
      // toISOString().slice(0, 10) is this codebase's existing idiom for a
      // UTC calendar-day key (apps/api/src/calendar/build.ts,
      // metadata/refresh.ts, lib/ics.ts, routes/account.ts all do the
      // same) - createdAt is already a real UTC instant (parseTimestampName),
      // so no separate UTC handling is needed here.
      const day = dump.createdAt.toISOString().slice(0, 10)
      if (!dailyBuckets.has(day)) dailyBuckets.set(day, dump.name)
    } else if (ageMs < weeklyBoundaryMs) {
      const bucket = Math.floor((ageMs - dailyBoundaryMs) / (7 * DAY_MS))
      if (!weeklyBuckets.has(bucket)) weeklyBuckets.set(bucket, dump.name)
    } else if (ageMs < monthlyBoundaryMs) {
      const bucket = Math.floor((ageMs - weeklyBoundaryMs) / (30 * DAY_MS))
      if (!monthlyBuckets.has(bucket)) monthlyBuckets.set(bucket, dump.name)
    }
    // else: at or past every tier — not kept, pruned.
  }
  for (const name of dailyBuckets.values()) keep.add(name)
  for (const name of weeklyBuckets.values()) keep.add(name)
  for (const name of monthlyBuckets.values()) keep.add(name)
  return keep
}

/** Bounds how much of a pg_dump failure's message is kept in memory for the
 * admin status endpoint — the same instinct as the 8KB stderr cap above,
 * applied to whatever ends up in DatabaseBackupRun.message. */
const RUN_MESSAGE_MAX = 2000

/** Last run's outcome, held in memory only — reset on restart, which is
 * acceptable since scheduleDatabaseBackup always takes an immediate pass on
 * boot. Lets the admin status route report a failure even when no file was
 * written, which a directory listing alone can't show. */
let lastRun: DatabaseBackupRun | null = null

export function getLastDatabaseBackupRun(): DatabaseBackupRun | null {
  return lastRun
}

/** `20260909T183012Z`, the same compact shape generateBackupId uses in
 * apps/api/src/backup/paths.ts, and for the same reason: lexicographic
 * sort is chronological sort, so retention needs no date parsing. */
function timestampName(now: Date): string {
  return `rwnd-${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}.sql.gz`
}

/**
 * Which pg_dump binary to use for a given server.
 *
 * pg_dump's compatibility is directional in BOTH directions, and picking one
 * client gets one of them wrong:
 *
 *  - it refuses to read a server newer than itself, and
 *  - its output targets a server of its own version or newer, so a dump from
 *    a newer client will not restore into an older server. pg_dump 17+ emits
 *    `SET transaction_timeout`, a GUC that does not exist before 17, and a
 *    16 server rejects the whole restore on it.
 *
 * The second half is the dangerous one: it fails at restore time, long after
 * the backup looked fine. So match the client to the server rather than
 * bundling one and hoping. Caught by the round-trip test in
 * apps/api/src/test/database-backup.test.ts, which is the reason that test
 * loads a dump back rather than just inspecting it.
 *
 * Falls back to whatever `pg_dump` is on PATH when there is no versioned
 * binary for this server, which is what makes the tests work on a developer
 * machine or a CI runner with a single client installed.
 *
 * Probes over the app's own pool rather than opening a connection, which is
 * why this module takes a `db` at all: pg_dump still connects on its own.
 */
async function pgDumpBinary(db: Database): Promise<string> {
  const [row] = (await db.execute(
    sql`select current_setting('server_version_num')::int / 10000 as major`,
  )) as { major: number }[]
  const versioned = `/usr/libexec/postgresql${row?.major}/pg_dump`
  return existsSync(versioned) ? versioned : 'pg_dump'
}

/**
 * pg_dump connection flags from a DATABASE_URL.
 *
 * The password is deliberately NOT returned here: it goes to the child's
 * environment as PGPASSWORD instead. A URI or a `--password` flag in argv
 * would land in /proc/<pid>/cmdline and in any error that echoes the command
 * line, against ADR 0007's Stage G secret-and-log hygiene.
 */
function connectionArgs(databaseUrl: string): { args: string[]; password: string | undefined } {
  const url = new URL(databaseUrl)
  const args = [
    '--host',
    url.hostname,
    '--port',
    url.port || '5432',
    '--username',
    decodeURIComponent(url.username),
    '--dbname',
    url.pathname.replace(/^\//, ''),
  ]
  return { args, password: url.password ? decodeURIComponent(url.password) : undefined }
}

/** Real dumps among `entries`, newest first. Descending by name is
 * descending by time, given timestampName's shape. Shared by prune() (which
 * dumps to keep) and listDatabaseBackups() (what to report). */
function sortedDumpNames(entries: string[]): string[] {
  return entries.filter((n) => DUMP_RE.test(n)).sort((a, b) => b.localeCompare(a))
}

/** Deletes whatever `selectDumpsToKeep` doesn't keep under `tiers`, plus any
 * partial left by a crashed run. Returns how many dumps were removed
 * (partials aren't counted: they were never backups). */
async function prune(dir: string, now: number, tiers: RetentionTiers): Promise<number> {
  const entries = await readdir(dir)

  for (const name of entries.filter((n) => PARTIAL_DUMP_RE.test(n))) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (now - info.mtimeMs > STALE_PARTIAL_MS) await unlink(path)
    } catch {
      // Raced with another sweep, or vanished under us. Nothing to do.
    }
  }

  const dumps = sortedDumpNames(entries).map((name) => ({
    name,
    createdAt: parseTimestampName(name),
  }))
  const keep = selectDumpsToKeep(dumps, new Date(now), tiers)
  const stale = dumps.filter((d) => !keep.has(d.name)).map((d) => d.name)
  for (const name of stale) await unlink(join(dir, name))
  return stale.length
}

/** `rwnd-20260909T183012Z.sql.gz` -> the Date it encodes. Only ever called
 * on names already matched against DUMP_RE, so the slice is safe. */
function parseTimestampName(name: string): Date {
  const compact = name.slice('rwnd-'.length, name.length - '.sql.gz'.length)
  const iso = compact.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  )
  return new Date(iso)
}

/**
 * The dumps currently on disk, newest first, for the admin status endpoint.
 * `createdAt` comes from the filename rather than the file's mtime: the name
 * is what this module already treats as authoritative for ordering
 * (sortedDumpNames), and docs/self-hosting.md tells self-hosters to sync
 * this directory elsewhere, which would give a copied-back file a
 * misleading mtime.
 *
 * Pure, like runDatabaseBackup — takes `dir` explicitly rather than calling
 * loadEnv(), so it's testable without fighting that module's cache.
 */
export async function listDatabaseBackups(dir: string): Promise<DatabaseBackupFile[]> {
  const entries = await readdir(dir)
  const names = sortedDumpNames(entries)
  return Promise.all(
    names.map(async (name) => {
      const { size } = await stat(join(dir, name))
      return { name, bytes: size, createdAt: parseTimestampName(name) }
    }),
  )
}

/**
 * Takes one whole-database dump: `pg_dump` piped through gzip into
 * `dir`, then prunes older dumps.
 *
 * Plain SQL rather than pg_dump's custom format, so restoring stays the
 * host-side shell redirect docs/self-hosting.md already documents instead
 * of needing pg_restore against the db container. Gzipped because
 * `users.avatar_image` is bytea, which hex-encodes to twice its binary size
 * in a plain dump.
 *
 * Pure: takes its config explicitly and never calls loadEnv(), so tests can
 * point it anywhere without fighting that module-level cache.
 *
 * See docs/adr/0008-database-backups.md for why this shells out to pg_dump
 * at all rather than dumping over the connection the app already holds.
 */
export async function runDatabaseBackup({
  db,
  dir,
  databaseUrl,
  now = new Date(),
}: {
  db: Database
  dir: string
  databaseUrl: string
  now?: Date
}): Promise<DatabaseBackupResult> {
  const startedAt = Date.now()
  await mkdir(dir, { recursive: true })

  const lock = await acquireBackupLock(dir)
  try {
    const name = timestampName(now)
    const finalPath = join(dir, name)
    // Written under .partial and renamed only once pg_dump has exited 0 AND
    // the gzip pipeline has resolved. Rename within one filesystem is atomic,
    // so a container killed mid-dump can never leave a truncated file that
    // looks like a valid backup.
    const partialPath = `${finalPath}.partial`

    const { args, password } = connectionArgs(databaseUrl)
    const binary = await pgDumpBinary(db)
    const child = spawn(binary, [...args, '--format=plain', '--no-password'], {
      shell: false,
      env: password === undefined ? process.env : { ...process.env, PGPASSWORD: password },
    })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Bounded: a pathological failure shouldn't hold the whole of stderr in
      // memory. The first 8KB carries the actual error every time.
      if (stderr.length < 8192) stderr += chunk
    })

    const exited = new Promise<number>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 1))
    })
    // A spawn failure (e.g. pg_dump missing entirely) rejects both this and
    // child.stdout around the same time. When the pipeline below throws
    // first, `exited` is never awaited - without this, its rejection would
    // otherwise surface as an unhandled promise rejection rather than the
    // error this function actually throws.
    exited.catch(() => {})

    try {
      await pipeline(child.stdout, createGzip(), createWriteStream(partialPath))
      // A resolved pipeline does NOT imply a successful dump: pg_dump can fail
      // after writing some output, and gzip will happily compress a truncated
      // stream. The exit code is the only real signal.
      const code = await exited
      if (code !== 0) throw new Error(`pg_dump exited ${code}: ${stderr.trim() || 'no output'}`)

      await rename(partialPath, finalPath)
    } catch (err) {
      await unlink(partialPath).catch(() => {})
      throw err
    }

    const { size } = await stat(finalPath)
    const tiers = await getRetentionTiers(db)
    const pruned = await prune(dir, Date.now(), tiers)
    return { file: name, bytes: size, durationMs: Date.now() - startedAt, pruned }
  } finally {
    await releaseBackupLock(lock, dir)
  }
}

/** pg_dump refuses a server major newer than its own, and says so in a way
 * that reads as noise unless you already know. Worth naming, since it's the
 * one failure a self-hoster is actually likely to hit. */
function isVersionMismatch(err: unknown): boolean {
  return /server version|aborting because of server version mismatch/i.test(String(err))
}

const VERSION_MISMATCH_MESSAGE =
  'This image bundles an older pg_dump than your Postgres server. See the Backups section of ' +
  'docs/self-hosting.md.'

/** The one line describing a failed run, shared between the boot log and
 * DatabaseBackupRun.message so the admin status endpoint says the same
 * thing `docker compose logs app` does. Bounded to RUN_MESSAGE_MAX for the
 * generic case, same instinct as the stderr cap above. */
function describeFailure(err: unknown): string {
  if (isVersionMismatch(err)) return VERSION_MISMATCH_MESSAGE
  const text = err instanceof Error ? err.message : String(err)
  return text.length > RUN_MESSAGE_MAX ? `${text.slice(0, RUN_MESSAGE_MAX)}...` : text
}

/**
 * Runs one backup pass and records its outcome (`lastRun`, plus the same
 * console logging) — shared by the recurring schedule below and the manual
 * "back up now" route (`POST /admin/database-backups/run`,
 * routes/admin-database-backups.ts), so the admin panel and `docker compose
 * logs` report the same shape regardless of which path triggered a given
 * dump. Rethrows every error (including BackupAlreadyRunningError) after
 * recording it, so each caller can still react to "already running"
 * specifically (a log line for the scheduler, a 409 for the manual route)
 * without duplicating the run-and-record logic itself.
 */
export async function runAndRecordDatabaseBackup(opts: {
  db: Database
  dir: string
  databaseUrl: string
}): Promise<DatabaseBackupResult> {
  try {
    const result = await runDatabaseBackup(opts)
    // Logged unconditionally, unlike the other two schedulers' "only when
    // there's something to report" convention: a completed dump IS the
    // thing to report, and this line is the only evidence in
    // `docker compose logs app` that the feature works at all.
    const mb = (result.bytes / 1024 / 1024).toFixed(1)
    console.log(
      `Database backup: wrote ${result.file} (${mb} MB) in ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.pruned > 0 ? `, pruned ${result.pruned} older dump(s).` : '.'),
    )
    lastRun = { at: new Date(), status: 'ok', message: null }
    return result
  } catch (err) {
    if (err instanceof BackupAlreadyRunningError) throw err
    const message = describeFailure(err)
    if (isVersionMismatch(err)) {
      console.error(`Database backup failed: ${message}`)
    } else {
      console.error('Database backup failed:', err)
    }
    lastRun = { at: new Date(), status: 'failed', message }
    throw err
  }
}

/** How often scheduleDatabaseBackup's recurring run repeats — fixed, not
 * admin-editable (see RetentionTiers' doc comment for why: the tiers only
 * make sense against a steady daily cadence). Exported so the admin status
 * endpoint can report the real schedule instead of duplicating it in a
 * translation string. */
export const BACKUP_INTERVAL_HOURS = 24

/** Fixed UTC hour the recurring backup re-anchors to on every boot (see
 * `msUntilNextHourUtc`'s doc comment for why a fixed anchor, not
 * process-start time, matters). Low-traffic o'clock for a self-hosted app
 * with no configured timezone to reason about; not admin-editable, same
 * reasoning as BACKUP_INTERVAL_HOURS above. Not exported: nothing outside
 * scheduleDatabaseBackup itself needs it (unlike BACKUP_INTERVAL_HOURS,
 * which the admin status endpoint reports). */
const BACKUP_HOUR_UTC = 3

/**
 * Milliseconds from `now` until the next occurrence of `hourUtc` (00-23) on
 * the UTC clock, in (0, 24h]. Exported and kept pure so scheduling math is
 * unit-testable without mocking `setInterval`/`setTimeout`.
 */
export function msUntilNextHourUtc(hourUtc: number, now: Date): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0),
  )
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

/**
 * Starts the recurring backup: one pass immediately, then a recurring pass
 * anchored to a fixed wall-clock hour (`BACKUP_HOUR_UTC`) every
 * `BACKUP_INTERVAL_HOURS` after that — deliberately not just "one immediate
 * pass, then setInterval(24h) from process-start time" the way
 * apps/api/src/lib/webhook-retention.ts's scheduleWebhookRetention is
 * shaped: that re-anchors the recurring clock to whenever the process last
 * started, so any restart landing on the same calendar day as the previous
 * scheduled backup produces an extra same-day dump, and the clock stays
 * shifted from then on instead of settling back onto a fixed time.
 * Root-caused against real prod backup timestamps 2026-09-16 (see
 * docs/TODO.md); harmless for webhook-retention's idempotent prune, so that
 * scheduler is deliberately left alone.
 *
 * Takes `db` like the other two schedulers, but only to probe the server's
 * major version so the matching pg_dump can be picked; the dump itself
 * connects on its own from DATABASE_URL rather than borrowing the pool.
 *
 * The immediate first pass is deliberate even though a restart-happy
 * container will dump more than it strictly needs: retention bounds that,
 * and it means a missing binary, an unwritable directory or a server-version
 * mismatch shows up in the boot log rather than 24 hours later. It runs
 * independently of the fixed-hour recurring schedule below, so a restart
 * always gets its own immediate sanity-check dump on top of whatever the
 * fixed schedule already produced that day — accepted the same way the
 * pre-fix behavior always did, and bounded by retention either way.
 *
 * No-ops when DATABASE_BACKUP_DIR is unset. The gate lives here rather than
 * at the call site so index.ts stays a flat list of unconditional calls and
 * the reasoning sits next to the code that needs it.
 */
export function scheduleDatabaseBackup(db: Database): void {
  const env = loadEnv()
  const dir = env.DATABASE_BACKUP_DIR
  if (!dir) return

  const DAY_MS = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000
  const run = () =>
    runAndRecordDatabaseBackup({ db, dir, databaseUrl: env.DATABASE_URL }).catch((err: unknown) => {
      // Not a failure: another run (a different container during a
      // deploy, or a manual "back up now" trigger) already holds the
      // lock. Any other error was already logged and recorded by
      // runAndRecordDatabaseBackup itself, so there's nothing left to do
      // here beyond swallowing the rejection.
      if (err instanceof BackupAlreadyRunningError) {
        console.log('Database backup: skipped, another run already in progress.')
      }
    })
  void run()
  setTimeout(
    () => {
      void run()
      setInterval(() => void run(), DAY_MS)
    },
    msUntilNextHourUtc(BACKUP_HOUR_UTC, new Date()),
  )
}
