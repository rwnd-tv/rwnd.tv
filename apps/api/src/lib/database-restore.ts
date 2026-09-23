import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  type FileHandle,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { sql } from 'drizzle-orm'
import { createDatabase } from '@rwnd/db'
import {
  BackupAlreadyRunningError,
  acquireBackupLock,
  connectionArgs,
  dumpDatabaseTo,
  pgClientBinary,
  releaseBackupLock,
  type DatabaseBackupFile,
} from './database-backup.js'

/**
 * Whole-database restore, the entrypoint-driven half of ADR 0008's
 * 2026-09-22 update. See docs/adr/0008-database-backups.md and the M6 plan
 * for why this can't run in-process: Drizzle's `drizzle` schema isn't under
 * `public`, and the live app pool would race a `DROP SCHEMA`'s ACCESS
 * EXCLUSIVE lock. Instead `POST /admin/database-backups/{file}/restore`
 * (routes/admin-database-backups.ts) validates, writes a marker file here,
 * and exits; `docker-entrypoint.sh` runs `runPendingRestore` below — via
 * the standalone `restore-entrypoint.ts` build — on the next boot, before
 * migrations, once the app process (and its connection pool) is already
 * gone.
 *
 * Three JSON marker files live in DATABASE_BACKUP_DIR, none matching
 * DUMP_RE or PARTIAL_DUMP_RE (database-backup.ts), so the retention sweep
 * can never touch them:
 *  - `rwnd-restore-request.json`: written by the route, read by the
 *    entrypoint. Presence alone means "a restore is pending."
 *  - `rwnd-restore-attempted.json`: the request renamed to this the moment
 *    the entrypoint claims it, before anything destructive happens. This is
 *    what makes a crash-loop structurally impossible: at most one attempt
 *    per request, ever. If the container is killed mid-restore, Postgres
 *    rolls the (`--single-transaction`) restore back on disconnect, so the
 *    database is untouched, but this file is found on the *next* boot and
 *    converted straight to a `failed` result rather than retried.
 *  - `rwnd-restore-result.json`: the last restore's outcome, read by the
 *    admin status route. On disk rather than in the database, since a
 *    successful restore's very first act is replacing the database this
 *    process would otherwise have recorded it in.
 */

const REQUEST_FILE = 'rwnd-restore-request.json'
const ATTEMPTED_FILE = 'rwnd-restore-attempted.json'
const RESULT_FILE = 'rwnd-restore-result.json'

/** Pre-restore snapshots (`runPendingRestore`'s undo point), deliberately a
 * different name shape from DUMP_RE — never picked up by the retention
 * sweep, and listed separately (listPreRestoreSnapshots below) so the admin
 * panel can offer "restore this to undo" without conflating it with a
 * regular scheduled/manual backup. Never pruned automatically: restores are
 * rare, so these accumulate slowly, and an old undo point disappearing on
 * its own would be a surprise on the one occasion someone goes looking for
 * it (James, M6 planning). */
export const PRE_RESTORE_RE = /^rwnd-pre-restore-\d{8}T\d{6}Z\.sql\.gz$/

interface RestoreRequest {
  file: string
  userId: string
  requestedAt: string
}

export interface RestoreResult {
  file: string
  requestedAt: string
  finishedAt: string
  status: 'ok' | 'failed'
  message: string | null
  /** The pre-restore snapshot taken before this restore, if it got far
   * enough to take one — null on a failure before that point (e.g. the
   * lock was held) or if the snapshot itself failed. */
  snapshot: string | null
}

function preRestoreSnapshotName(now: Date): string {
  const compact = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `rwnd-pre-restore-${compact}.sql.gz`
}

function parseSnapshotTimestamp(name: string): Date {
  const compact = name.slice('rwnd-pre-restore-'.length, name.length - '.sql.gz'.length)
  const iso = compact.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  )
  return new Date(iso)
}

/** The pre-restore snapshots currently on disk, newest first — same shape
 * and same "name is authoritative for ordering" reasoning as
 * listDatabaseBackups in database-backup.ts. */
export async function listPreRestoreSnapshots(dir: string): Promise<DatabaseBackupFile[]> {
  const entries = await readdir(dir)
  const names = entries.filter((n) => PRE_RESTORE_RE.test(n)).sort((a, b) => b.localeCompare(a))
  return Promise.all(
    names.map(async (name) => {
      const { size } = await stat(join(dir, name))
      return { name, bytes: size, createdAt: parseSnapshotTimestamp(name) }
    }),
  )
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Writes the restore request marker: `.tmp` then fsync then rename, so a
 * container crash between the write and the rename can never leave a
 * half-written request file for the entrypoint to trip over. Called by the
 * route after every check has passed and the caller is about to exit the
 * process.
 */
export async function writeRestoreRequest(
  dir: string,
  request: { file: string; userId: string },
): Promise<void> {
  const payload: RestoreRequest = { ...request, requestedAt: new Date().toISOString() }
  const path = join(dir, REQUEST_FILE)
  const tmpPath = `${path}.tmp`
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(JSON.stringify(payload))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmpPath, path)
}

/** The last restore's outcome, for the admin status route — null if a
 * restore has never run against this DATABASE_BACKUP_DIR. */
export async function readLastRestoreResult(dir: string): Promise<RestoreResult | null> {
  return readJsonIfExists<RestoreResult>(join(dir, RESULT_FILE))
}

/** True while a restore is queued (request written, not yet claimed by the
 * entrypoint) or already claimed but not yet finished (a boot is in
 * progress). The route checks this before writing a new request: without
 * it, a second restore submitted in the brief window before the process
 * actually exits (exitForRestore's 500ms delay, or however long the
 * container genuinely takes to restart) would silently overwrite the first
 * request's marker file, since both share the same fixed filename. */
export async function hasPendingRestore(dir: string): Promise<boolean> {
  const [request, attempted] = await Promise.all([
    readJsonIfExists<RestoreRequest>(join(dir, REQUEST_FILE)),
    readJsonIfExists<RestoreRequest>(join(dir, ATTEMPTED_FILE)),
  ])
  return request !== null || attempted !== null
}

async function writeRestoreResult(dir: string, result: RestoreResult): Promise<void> {
  await writeFile(join(dir, RESULT_FILE), JSON.stringify(result))
}

/** Called by `POST .../restore` right after responding 202. Delayed
 * slightly so the response has finished flushing to the client before the
 * process exits — @hono/node-server writes the response body
 * asynchronously, so exiting the instant the handler returns can race it.
 * Its own function, not an inline `process.exit()` call in the route, so
 * tests can mock it instead of actually killing the test process. */
export function exitForRestore(): void {
  setTimeout(() => process.exit(0), 500)
}

const HEAD_LINES = 60
const TAIL_LINES = 20

/** `-- Dumped by pg_dump version 17.2 (...)`  ->  17. Null when the line
 * isn't present at all (a hand-edited or non-pg_dump file), which
 * preflightCheckDump treats as "nothing to compare," not a failure — the
 * gzip-integrity and trailer checks already cover a genuinely broken file. */
export function parseDumpHeader(headLines: string[]): { pgDumpMajor: number | null } {
  for (const line of headLines) {
    const m = /^-- Dumped by pg_dump version (\d+)\./.exec(line)
    if (m) return { pgDumpMajor: Number(m[1]) }
  }
  return { pgDumpMajor: null }
}

/** `... OWNER TO rwnd;` -> `'rwnd'`, or `... OWNER TO "some role";` ->
 * `'some role'`. Null when the line carries no ownership statement. Only
 * ever non-empty for a dump taken before `--no-owner --no-privileges` was
 * added to the dump command (database-backup.ts) — new dumps carry no
 * OWNER TO statements at all. */
export function extractOwnerRole(line: string): string | null {
  const m = /\bOWNER TO "?([^";]+?)"?;/.exec(line)
  return m ? m[1]! : null
}

/**
 * pg_dump's trailer is `-- PostgreSQL database dump complete`, but it is
 * not necessarily the literal last line: pg_dump 16.10+/17.6+ (the
 * `\restrict`/`\unrestrict` guard against arbitrary client-side commands
 * during restore) appends `\unrestrict <token>` *after* it. So this checks
 * the last few KB for the comment appearing anywhere, not as the final
 * line — a dump missing it (truncated mid-write, or simply not a pg_dump
 * output at all) is treated as incomplete.
 */
export function hasCompleteTrailer(tailLines: string[]): boolean {
  return tailLines.some((line) => line.trim() === '-- PostgreSQL database dump complete')
}

interface DumpScan {
  headLines: string[]
  tailLines: string[]
  ownerRoles: Set<string>
}

/** Decompresses and line-scans the whole dump once: gzip integrity (a
 * corrupt file throws), the header (pg_dump version), the trailer
 * (completeness), and every `OWNER TO` statement anywhere in the file, not
 * just the header — old dumps interleave them throughout the body, one per
 * object. Explicit error listeners on the read stream, the gunzip
 * transform, AND the readline interface itself — `.pipe()` doesn't forward
 * errors between streams, and readline.Interface re-emits its input
 * stream's own 'error' on itself rather than leaving `gz`'s own listener to
 * handle it, so without a listener on `rl` too, a corrupt gzip file crashes
 * the whole process with an uncaught exception (reproduced directly). */
function scanDump(path: string): Promise<DumpScan> {
  const headLines: string[] = []
  const tailLines: string[] = []
  const ownerRoles = new Set<string>()

  return new Promise<DumpScan>((resolve, reject) => {
    let settled = false
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const file = createReadStream(path)
    const gz = createGunzip()
    file.on('error', fail)
    gz.on('error', fail)
    file.pipe(gz)

    const rl = createInterface({ input: gz, crlfDelay: Infinity })
    // readline.Interface re-emits its input stream's own 'error' on itself
    // rather than just letting the listener above handle it — confirmed by
    // reproducing directly: without this, a corrupt gzip file crashes the
    // process with an uncaught exception (`Emitted 'error' event on
    // Interface instance`) despite gz.on('error', fail) already existing,
    // because `rl` itself has zero listeners for its own re-emitted copy.
    rl.on('error', fail)
    rl.on('line', (line) => {
      if (headLines.length < HEAD_LINES) headLines.push(line)
      tailLines.push(line)
      if (tailLines.length > TAIL_LINES) tailLines.shift()
      const role = extractOwnerRole(line)
      if (role) ownerRoles.add(role)
    })
    rl.on('close', () => {
      if (!settled) {
        settled = true
        resolve({ headLines, tailLines, ownerRoles })
      }
    })
  })
}

type PreflightFailureReason = 'corrupt' | 'incomplete' | 'newer_pg_dump' | 'owner_mismatch'

export interface PreflightResult {
  ok: boolean
  reason?: PreflightFailureReason
  detail?: string
}

/**
 * Cheap checks that return a specific reason instead of a confusing failure
 * three steps into an in-progress restore: gzip integrity, a complete
 * trailer, the dump's own pg_dump major not newer than `serverMajor` (same
 * directional issue runDatabaseBackup's client-matching guards against, the
 * other way round — a dump *written* by a newer pg_dump than the server can
 * understand contains syntax like `SET transaction_timeout` the server
 * rejects outright), and — only for a dump old enough to carry `OWNER TO`
 * statements at all — that they match the connecting role.
 *
 * Run twice per restore: once by the route before it ever commits to
 * anything, and again by runPendingRestore itself right before the
 * destructive step, since the file could have changed on disk in between.
 */
export async function preflightCheckDump(
  path: string,
  { serverMajor, role }: { serverMajor: number; role: string },
): Promise<PreflightResult> {
  let scan: DumpScan
  try {
    scan = await scanDump(path)
  } catch (err) {
    return {
      ok: false,
      reason: 'corrupt',
      detail: `Not a valid gzip file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!hasCompleteTrailer(scan.tailLines)) {
    return {
      ok: false,
      reason: 'incomplete',
      detail: 'No "PostgreSQL database dump complete" trailer found — this dump looks truncated.',
    }
  }

  const { pgDumpMajor } = parseDumpHeader(scan.headLines)
  if (pgDumpMajor !== null && pgDumpMajor > serverMajor) {
    return {
      ok: false,
      reason: 'newer_pg_dump',
      detail: `This dump was written by pg_dump ${pgDumpMajor}, newer than the running Postgres server (${serverMajor}). See the Backups section of docs/self-hosting.md.`,
    }
  }

  if (scan.ownerRoles.size > 0 && !scan.ownerRoles.has(role)) {
    return {
      ok: false,
      reason: 'owner_mismatch',
      detail: `This dump records object ownership for a different database role (${[...scan.ownerRoles].join(', ')}) than this instance connects as (${role}).`,
    }
  }

  return { ok: true }
}

/**
 * The SQL run before the gunzipped dump itself, inside the same
 * `--single-transaction` psql invocation — see runPsqlRestore. In order:
 *
 * 1. A 30s lock_timeout, deliberately *before* the dump's own
 *    `SET lock_timeout = 0;` (every pg_dump plain output starts with one) —
 *    so it only governs the two steps below, making a lock wait during the
 *    schema drop fail fast rather than hang. The dump's own statement then
 *    takes over for the rest of the transaction, which is fine: by then the
 *    schema is already free.
 * 2. Terminate every other backend on this role and database — a restart
 *    doesn't guarantee every old connection (the just-exited app process,
 *    a health check) has actually closed yet, and a `DROP SCHEMA` would
 *    otherwise wait on one. Filtered to `usename = current_user` rather
 *    than every backend: terminating a connection under a different role
 *    raises an error under `ON_ERROR_STOP`, aborting the whole restore.
 * 3. Drop every non-system schema (`pg_namespace`, excluding `pg_%` and
 *    `information_schema`) with CASCADE — not a hand-picked list, so
 *    Drizzle's own `drizzle` schema (`__drizzle_migrations` isn't under
 *    `public`) is included. The dump itself recreates every schema it
 *    contains, `drizzle` among them.
 * 4. Recreate `public` the way `initdb` does. pg_dump's plain output never
 *    re-emits `CREATE SCHEMA public` (confirmed by the existing round-trip
 *    test in database-backup.test.ts, which loads a full dump into a
 *    freshly `CREATE DATABASE`d database — one that already has its own
 *    initdb-created `public` — with no conflict), so this has to exist
 *    before the dump body runs, not be left to it.
 */
function buildRestorePreamble(): string {
  return `SET lock_timeout = '30s';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND usename = current_user
  LOOP
    PERFORM pg_terminate_backend(r.pid);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname);
  END LOOP;
END $$;

CREATE SCHEMA public AUTHORIZATION pg_database_owner;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO PUBLIC;

`
}

/**
 * Streams the preamble followed by the gunzipped dump into one
 * `--single-transaction` psql run, so drop-and-restore is atomic: a failure
 * anywhere (a bad statement, a dropped connection) rolls the whole thing
 * back, leaving the database exactly as it was before this function was
 * called. `--single-transaction` plus `-v ON_ERROR_STOP=1` is what makes
 * that guarantee hold.
 */
async function runPsqlRestore({
  binary,
  databaseUrl,
  dumpPath,
}: {
  binary: string
  databaseUrl: string
  dumpPath: string
}): Promise<void> {
  const { args, password } = connectionArgs(databaseUrl)
  const child = spawn(
    binary,
    [
      ...args,
      '--no-password',
      '-v',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '--no-psqlrc',
      '--quiet',
    ],
    {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: password === undefined ? process.env : { ...process.env, PGPASSWORD: password },
    },
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk
  })

  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
  // Same reasoning as dumpDatabaseTo's own `exited.catch(() => {})`: a spawn
  // failure rejects both this and the input pipeline below around the same
  // time, and only one of them is actually awaited past that point.
  exited.catch(() => {})

  const input = new PassThrough()
  input.write(buildRestorePreamble())
  const file = createReadStream(dumpPath)
  const gz = createGunzip()
  // Explicit, not `.pipe()`-forwarded (it doesn't forward errors) — a read
  // or decompression failure here must reach `input` so the pipeline below
  // rejects instead of hanging on a stream that silently stopped.
  file.on('error', (err) => input.destroy(err))
  gz.on('error', (err) => input.destroy(err))
  file.pipe(gz)
  gz.pipe(input)

  // A failing statement under ON_ERROR_STOP makes psql exit and close its
  // stdin immediately — before this process is done writing the rest of the
  // dump into it, which makes the pipeline itself reject with EPIPE. That
  // rejection carries no diagnostic value (confirmed live: the admin panel
  // showed "failed: write EPIPE" for what was actually a SQL syntax error),
  // while the real reason is already sitting in `stderr` from psql's own
  // output. So: let the exit code drive the error whenever psql actually
  // exited non-zero, and only fall back to the raw pipeline error for a
  // genuinely different failure (psql still running, exit code 0, but the
  // pipe broke some other way).
  let pipelineError: Error | undefined
  try {
    await pipeline(input, child.stdin)
  } catch (err) {
    pipelineError = err instanceof Error ? err : new Error(String(err))
  }
  const code = await exited
  if (code !== 0) throw new Error(`psql exited ${code}: ${stderr.trim() || 'no output'}`)
  if (pipelineError) throw pipelineError
}

/**
 * The entrypoint's whole job (see restore-entrypoint.ts): pick up a pending
 * restore request, if any, and either perform it or record why it didn't.
 * Never throws — every failure path, including one left over from a killed
 * container, ends in a `failed` result file rather than an exception, so
 * `docker-entrypoint.sh` can move on to migrations either way without special
 * casing.
 */
export async function runPendingRestore({
  dir,
  databaseUrl,
  ssl,
}: {
  dir: string
  databaseUrl: string
  ssl: boolean
}): Promise<void> {
  await mkdir(dir, { recursive: true })

  const attemptedPath = join(dir, ATTEMPTED_FILE)
  const leftover = await readJsonIfExists<RestoreRequest>(attemptedPath)
  if (leftover) {
    // Claimed by a previous boot that never finished — the transaction
    // guarantees the database was left untouched, but this marker must
    // never be retried (that's what makes a crash-loop structurally
    // impossible), so it becomes a failed result instead.
    await writeRestoreResult(dir, {
      file: leftover.file,
      requestedAt: leftover.requestedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      message:
        'The previous restore attempt was interrupted before it finished. The database was left untouched — please try again.',
      snapshot: null,
    })
    await unlink(attemptedPath).catch(() => {})
    return
  }

  const requestPath = join(dir, REQUEST_FILE)
  const request = await readJsonIfExists<RestoreRequest>(requestPath)
  if (!request) return

  // Claim first, before anything else — see the module doc comment.
  await rename(requestPath, attemptedPath)

  let lock: FileHandle
  try {
    lock = await acquireBackupLock(dir)
  } catch (err) {
    await writeRestoreResult(dir, {
      file: request.file,
      requestedAt: request.requestedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      message:
        err instanceof BackupAlreadyRunningError
          ? 'A backup was already running when the restore started; it was skipped. Nothing was changed.'
          : `Could not start the restore: ${err instanceof Error ? err.message : String(err)}`,
      snapshot: null,
    })
    await unlink(attemptedPath).catch(() => {})
    return
  }

  let snapshotName: string | null = null
  try {
    const dumpPath = join(dir, request.file)
    const db = createDatabase(databaseUrl, { ssl })
    let psqlBinary: string
    try {
      const [row] = (await db.execute(
        sql`select current_setting('server_version_num')::int / 10000 as major`,
      )) as { major: number }[]
      const serverMajor = row?.major ?? 0

      snapshotName = preRestoreSnapshotName(new Date())
      await dumpDatabaseTo({ db, databaseUrl, finalPath: join(dir, snapshotName) })

      const role = decodeURIComponent(new URL(databaseUrl).username)
      const preflight = await preflightCheckDump(dumpPath, { serverMajor, role })
      if (!preflight.ok) {
        throw new Error(preflight.detail ?? `Preflight check failed: ${preflight.reason}`)
      }

      psqlBinary = await pgClientBinary(db, 'psql')
    } finally {
      // Must close before runPsqlRestore's preamble terminates every
      // backend under this role — otherwise it would terminate this very
      // connection too.
      await db.$client.end()
    }

    await runPsqlRestore({ binary: psqlBinary, databaseUrl, dumpPath })

    await writeRestoreResult(dir, {
      file: request.file,
      requestedAt: request.requestedAt,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      message: null,
      snapshot: snapshotName,
    })
  } catch (err) {
    await writeRestoreResult(dir, {
      file: request.file,
      requestedAt: request.requestedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
      snapshot: snapshotName,
    })
  } finally {
    await releaseBackupLock(lock, dir)
    await unlink(attemptedPath).catch(() => {})
  }
}
