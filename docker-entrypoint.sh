#!/bin/sh
set -e

# Runs before migrations, while the app process (and its connection pool)
# from any previous boot is already gone — see
# apps/api/src/lib/database-restore.ts's module doc comment for why an
# admin-triggered restore can't run inside the live app process. `|| echo`
# rather than letting `set -e` kill the container: runPendingRestore already
# turns every failure into a recorded result and never throws, but this is
# the one place an unexpected crash here must never become a boot loop.
echo "Checking for a pending database restore..."
node /app/api/dist/restore-entrypoint.js || echo "Restore step failed unexpectedly; continuing normal startup."

echo "Running database migrations..."
/app/db/node_modules/.bin/tsx /app/db/src/migrate.ts

echo "Ensuring instance settings exist..."
/app/db/node_modules/.bin/tsx /app/db/src/seed.ts

echo "Starting rwnd.tv API..."
# Tells the app it's running under this entrypoint, not `pnpm dev:api` or a
# bare `node dist/index.js` — POST /admin/database-backups/{file}/restore
# (routes/admin-database-backups.ts) 409s without it, since a restore
# request written anywhere else would never be picked up by anything.
export RWND_RESTORE_ENTRYPOINT=1
exec node /app/api/dist/index.js
