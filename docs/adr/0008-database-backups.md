# 0008: Automatic whole-database backups

## Status

Accepted

## Context

`docs/self-hosting.md` has always documented a whole-Postgres backup as a manual step: `docker compose exec db pg_dump ...`, run by hand, remembered by the operator. `docs/ROADMAP.md`'s M4 carried "Automatic, scheduled backup of the entire database" to make that happen on a schedule without a self-hoster having to set up their own host-level cron.

This is deliberately distinct from the per-user backup feature in `apps/api/src/backup/`, which is JSON, manually triggered, and covers one user's tracked activity rather than accounts, instance settings, or anything another user has done. `docs/self-hosting.md` already works to keep the two apart, and this ADR does not merge them.

**The deciding requirement, from James (2026-09-09): a backup taken by an older container must restore onto a newer one.** A schema change must not render backup history unrestorable. That requirement, not image size or elegance, is what settled the design.

Two routes were evaluated properly rather than assumed.

**A data-only dump over the connection the app already holds** (`COPY ... TO STDOUT`, no new binary, no `child_process`) was checked seriously and is genuinely reachable: `db.$client` exposes the typed postgres-js tag, and the driver implements the COPY sub-protocol with a documented `.readable()`. It is also helped by a real property of this schema: there are no sequences at all, every primary key being `uuid().defaultRandom()`, so the classic data-only footgun of resetting sequences does not apply.

It was rejected on three counts:

- **It fails the requirement above outright.** A data-only dump carries rows shaped by the schema at dump time and contains no schema to restore first, so one added or renamed column breaks the load with nothing to fall back on.
- **The schema contains a genuine foreign-key cycle.** `watchlists.cover_item_id` references `watchlist_items.id`, and `watchlist_items.watchlist_id` references `watchlists.id`; that cycle is why `packages/db/src/schema.ts` needs its `AnyPgColumn` escape hatch. No constraint anywhere is declared `DEFERRABLE`, so `SET CONSTRAINTS ALL DEFERRED` on restore is a silent no-op, and no topological table order exists. Every workaround (superuser-only `session_replication_role`, a migration marking the cycle deferrable, or special-casing that one column in the dump writer) costs something, and the last fails silently at restore time, which is the one moment it must not.
- **The restore runbook gets worse, not better.** `docker-entrypoint.sh` runs `seed.ts` on every boot, so a data-only load would hit duplicate keys unless everything were truncated first. The documented procedure would go from three honest lines to a drop-recreate-migrate-truncate-load dance, in a document whose whole value is being followable at 2am by someone whose instance is down.

## Decision

**Use `pg_dump`.** It composes with the migration system rather than fighting it, which is exactly what makes old backups restorable: restore the old schema and data into an empty database, start the new container, and the entrypoint's migrations carry the schema forward. The dump includes `__drizzle_migrations`, so migrations apply only what is missing. That is the same path every in-place upgrade already takes, rather than a second mechanism that has to be kept correct independently.

The costs are real and accepted rather than waved away:

- **`child_process` becomes a capability this codebase did not previously have.** Before this, nothing in `apps/`, `packages/` or `tools/` spawned a process, and "this container never executes anything" was a free invariant. It no longer is. This ADR exists specifically so a future `/security-review` or CodeQL run finds recorded rationale for the spawn sink rather than flagging it as an unexplained new finding, per [ADR 0007](0007-security-posture.md)'s own convention that accepted risks should be checked here before being re-raised.
- **A new OS package is new CVE surface**, which CI's Trivy scan will now report on permanently.

Both are contained, not eliminated: `spawn` is called with a fixed argv array and `shell: false`, so there is no injection surface; connection details come from `DATABASE_URL`, which is trusted configuration rather than user input; and the child fully inherits the container hardening in `docker-compose.yml` (`read_only`, `cap_drop: ALL`, `no-new-privileges`).

### Match the client to the server, at runtime

`pg_dump`'s version compatibility is directional in **both** directions, and a single bundled client gets one of them wrong:

- it refuses to read a server **newer** than itself, and
- its output targets a server of its own version **or newer**, so a dump taken by a newer client will not restore into an older server. `pg_dump` 17 and later emit `SET transaction_timeout` in every dump header, a setting that does not exist before Postgres 17, and a 16 server rejects the entire restore on it.

The first draft of this ADR bundled only the newest client, reasoning solely about the first bullet. That was wrong, and wrong in the more dangerous direction: `docker-compose.yml` ships `postgres:16-alpine`, so a bundled `pg_dump` 18 would have produced backups that failed to restore into the user's own database, and the failure would have surfaced only on the day someone actually needed a restore. The round-trip test in `apps/api/src/test/database-backup.test.ts` caught it, which is the reason that test loads a dump back through `psql` rather than merely inspecting its contents.

So the image bundles `postgresql16-client`, `postgresql17-client` and `postgresql18-client` (about 9.4 MB in total on `node:26-alpine`, Alpine 3.24.1, measured), and the job probes `server_version_num` over the app's existing pool and execs the matching `/usr/libexec/postgresqlNN/pg_dump`. That is correct in both directions: never reading a server newer than the client, and never producing a dump the server cannot read back.

When Alpine gains a newer major, add it to the `apk add` line. A server newer than every bundled client falls back to whatever `pg_dump` is on `PATH` and will fail loudly rather than silently, and the job logs a line pointing at the version note in `docs/self-hosting.md` when it sees that error.

### Mechanics

- **The password never appears in argv.** `DATABASE_URL` is parsed with `new URL()` and passed as host/port/user/dbname flags, with the password supplied through the child's `PGPASSWORD` environment variable. A URI in argv would land in `/proc/<pid>/cmdline` and in any error that echoes the command line, against [ADR 0007](0007-security-posture.md)'s Stage G secret-and-log hygiene.
- **Plain SQL (`-Fp`), gzipped**, rather than `pg_dump`'s custom format. Plain SQL keeps restore a host-side shell redirect, matching what `docs/self-hosting.md` already documents, instead of requiring `pg_restore` reading from the db container's stdin. Gzip is applied in-process with `node:zlib` and `node:stream/promises`, both builtins: `users.avatar_image` is `bytea`, which hex-encodes to twice its binary size in a plain dump, so compression is the dominant saving.
- **Publication is atomic.** The dump is written to a `.partial` file and renamed only after `pg_dump` exits 0 and the pipeline resolves, so a container killed mid-dump cannot leave a truncated file that looks like a valid backup.
- **Retention originally kept the newest 7, by count rather than age.** A count bounds disk usage; "older than N days" does not, if the database grows. The sweep only ever considers files matching a strict `rwnd-<compact ISO>.sql.gz` pattern, mirroring the defence-in-depth instinct behind `BACKUP_ID_RE` in `apps/api/src/backup/paths.ts`: the directory is a bind mount a human may also put files in, so the job must be structurally incapable of deleting anything it did not write.

  **Update, 2026-09-10: retention is now a GFS-style (grandfather-father-son) tiered policy, not a flat count.** James asked for something closer to "daily for a week, weekly for a month, monthly for a year," flexible enough that "just daily backups, kept for a year" is also expressible. `selectDumpsToKeep` (`apps/api/src/lib/database-backup.ts`) keeps every dump within a `dailyRetentionDays` window outright, thins to one per week within a `weeklyRetentionWeeks` window beyond that, then one per month within a `monthlyRetentionMonths` window, then drops anything older than all three. Setting a tier to 0 collapses its window to zero width, skipping it. The defence-in-depth filename filter above is unchanged.

- **`DATABASE_BACKUP_DIR` is its own env var**, not a subdirectory of `BACKUP_DIR`. `BACKUP_DIR` is load-bearing for `backupsConfigured` on `GET /settings` and the `requireBackupsConfigured` route guard, so reusing it would silently light up the per-user Settings panel for an operator who only wanted scheduled dumps.
- **No interval env var, and the backup cadence itself isn't admin-editable either.** This codebase has no duration env vars at all; every interval is a module constant with its reasoning attached, as in `apps/api/src/lib/webhook-retention.ts` and `apps/api/src/metadata/refresh.ts`. The cadence stays a fixed 24h constant even after the 2026-09-10 update below: the retention tiers only make sense against a steady daily cadence, so only retention became configurable, not how often the job runs.

  **Update, 2026-09-10: retention itself is now admin-editable, breaking with "every interval is a module constant."** The M4 item's own text left this open; the flat "keep newest 7" answered it by precedent at the time, but James asked for the tiered windows above to be genuinely configurable, including down to 0. The three tier values live on `instance_settings` (migration `0041_add_database_backup_retention_tiers.sql`), read fresh by `runDatabaseBackup` on every run (so a change takes effect on the next scheduled run, no scheduler-rescheduling needed), and are admin-editable via `PATCH /admin/database-backups`. Deliberately not on the public `instanceSettingsSchema`/`GET /settings` this table also backs, same reasoning as `configured` below: there is no pre-login UI decision that needs these numbers.

- **Restore stays manual.** Restoring is a destructive, rare, deliberate action, and automating it would add risk without adding value.

  **James, 2026-09-10: does not fully agree with this call.** Recorded here rather than silently overridden, since restore automation is a real, open question worth revisiting on its own, not a settled one. The 2026-09-10 admin panel work (see Consequences below) added a link from the panel to the Restoring section of `docs/self-hosting.md` as the smallest thing that could ship without re-opening the automation question itself.

## Consequences

- **Prod and dev must not share a backup directory.** They currently share one, used as an informal way to sync personal user data between instances. With retention live, each instance's sweep would delete the other's dumps, and a dev backup evicting a prod backup is real data loss rather than untidiness. James, 2026-09-09: split both `DATABASE_BACKUP_DIR` and `BACKUP_DIR` per instance. Restoring a prod database dump onto dev supersedes the old sync trick, and brings the whole instance rather than one user's activity.
- **The scheduler takes no `db` argument**, unlike `scheduleMetadataRefresh` and `scheduleWebhookRetention`, because `pg_dump` opens its own connection. That visibly breaks the shape the other two share, so it is called out in the module's own doc comment.
- **A successful backup is logged**, deviating from the "log only when there is something to report" convention the other two schedulers follow. A completed dump is the only evidence in `docker compose logs app` that the feature works at all, which makes it worth a line.
- **Update, 2026-09-10: the log line is no longer the only evidence.** `GET /admin/database-backups` (`apps/api/src/routes/admin-database-backups.ts`) reads the backup directory directly, the same way the per-user backup feature's own list route reads its directory rather than a table, and adds the scheduler's last-run outcome (kept in memory only, so it resets on restart) so a failed run is visible even when no file was written. Surfaced on `/admin` as a read-only panel. No table, no migration: this stays a status view, not a second source of truth for what is on disk.
- **The bundled client set is now a contract**, documented in `docs/self-hosting.md`. Anyone running a Postgres major newer than every client in the image gets no automatic backups until the image catches up, which fails loudly rather than producing an unrestorable file. Adding the next major is a one-line Dockerfile change.
- **Update, 2026-09-10: `instance_settings` now carries operational state, not only configuration.** Its own doc comment in `packages/db/src/schema.ts` called it "instance-wide configuration"; the three new retention columns are closer to a tuning knob for a background job than something an admin sets once and forgets, same category as `metadataProviderPriority` already occupied there. Reusing the table rather than adding a new one keeps the singleton-row pattern rather than introducing a second one for a handful of integers.
- **If the `watchlists` and `watchlist_items` cycle is ever removed** (making `cover_item_id` a lookup rather than a stored foreign key), the data-only route becomes clearly better than this one and the decision is worth revisiting. Nothing else about the rejection would change.
