import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { sql } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { loadEnv } from '../env.js'

/**
 * How many dumps to keep. A **count**, not an age: a count actually bounds
 * disk usage, where "older than N days" doesn't if the database grows. Seven
 * covers a week of daily dumps, so a problem noticed on Monday can still be
 * rolled back to the previous Monday.
 */
const KEEP_COUNT = 7

/**
 * Only files matching this are ever considered, for listing or for deletion.
 * Same defence-in-depth instinct as BACKUP_ID_RE in
 * apps/api/src/backup/paths.ts: DATABASE_BACKUP_DIR is a bind mount a human
 * may also drop files into, so the retention sweep has to be structurally
 * incapable of deleting anything this job didn't write.
 */
const DUMP_RE = /^rwnd-\d{8}T\d{6}Z\.sql\.gz$/

/** A partial older than this is from a crashed run, not one in flight, so
 * it's safe to clear. Generous relative to how long a dump of a
 * self-hosted instance actually takes. */
const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000

export interface DatabaseBackupResult {
  file: string
  bytes: number
  durationMs: number
  pruned: number
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

/** Deletes all but the newest KEEP_COUNT dumps, plus any partial left by a
 * crashed run. Returns how many dumps were removed (partials aren't
 * counted: they were never backups). */
async function prune(dir: string, now: number): Promise<number> {
  const entries = await readdir(dir)

  for (const name of entries.filter((n) => n.endsWith('.partial'))) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (now - info.mtimeMs > STALE_PARTIAL_MS) await unlink(path)
    } catch {
      // Raced with another sweep, or vanished under us. Nothing to do.
    }
  }

  // Descending by name is descending by time, given timestampName's shape.
  const dumps = entries.filter((n) => DUMP_RE.test(n)).sort((a, b) => b.localeCompare(a))
  const stale = dumps.slice(KEEP_COUNT)
  for (const name of stale) await unlink(join(dir, name))
  return stale.length
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
  const pruned = await prune(dir, Date.now())
  return { file: name, bytes: size, durationMs: Date.now() - startedAt, pruned }
}

/** pg_dump refuses a server major newer than its own, and says so in a way
 * that reads as noise unless you already know. Worth naming, since it's the
 * one failure a self-hoster is actually likely to hit. */
function isVersionMismatch(err: unknown): boolean {
  return /server version|aborting because of server version mismatch/i.test(String(err))
}

/**
 * Starts the recurring backup: one pass immediately, then every 24h after,
 * same shape as apps/api/src/lib/webhook-retention.ts's
 * scheduleWebhookRetention, and deliberately not inside createApp() for the
 * same reason (testApp() calls createApp() in every test; this must not fire
 * there).
 *
 * Takes `db` like the other two schedulers, but only to probe the server's
 * major version so the matching pg_dump can be picked; the dump itself
 * connects on its own from DATABASE_URL rather than borrowing the pool.
 *
 * The immediate first pass is deliberate even though a restart-happy
 * container will dump more than it strictly needs: retention bounds that,
 * and it means a missing binary, an unwritable directory or a server-version
 * mismatch shows up in the boot log rather than 24 hours later.
 *
 * No-ops when DATABASE_BACKUP_DIR is unset. The gate lives here rather than
 * at the call site so index.ts stays a flat list of unconditional calls and
 * the reasoning sits next to the code that needs it.
 */
export function scheduleDatabaseBackup(db: Database): void {
  const env = loadEnv()
  const dir = env.DATABASE_BACKUP_DIR
  if (!dir) return

  const DAY_MS = 24 * 60 * 60 * 1000
  const run = () =>
    runDatabaseBackup({ db, dir, databaseUrl: env.DATABASE_URL })
      .then(({ file, bytes, durationMs, pruned }) => {
        // Logged unconditionally, unlike the other two schedulers' "only when
        // there's something to report" convention: a completed dump IS the
        // thing to report, and this line is the only evidence in
        // `docker compose logs app` that the feature works at all.
        const mb = (bytes / 1024 / 1024).toFixed(1)
        console.log(
          `Database backup: wrote ${file} (${mb} MB) in ${(durationMs / 1000).toFixed(1)}s` +
            (pruned > 0 ? `, pruned ${pruned} older dump(s).` : '.'),
        )
      })
      .catch((err: unknown) => {
        if (isVersionMismatch(err)) {
          console.error(
            'Database backup failed: this image bundles an older pg_dump than your Postgres ' +
              'server. See the Backups section of docs/self-hosting.md.',
          )
          return
        }
        console.error('Database backup failed:', err)
      })
  void run()
  setInterval(() => void run(), DAY_MS)
}
