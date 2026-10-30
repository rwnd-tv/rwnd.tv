#!/usr/bin/env bash
# Runs the whole test suite the way CI's `test` job does: against a real
# Postgres 16 and with a Postgres 16 client on PATH, so the backup and
# restore tests run rather than skip. See the "Install Postgres client" step
# in .github/workflows/ci.yml for why the client is pinned to 16.
#
# Needs Docker, and postgresql-client-16 from PostgreSQL's own apt
# repository (apt.postgresql.org), which installs to /usr/lib/postgresql/16.
#
# The database is a throwaway container: published on loopback only, its
# data kept in memory, and removed when the run ends, pass or fail. Port
# 55432 rather than CI's 5432 so it can't clash with a Postgres published
# on the default port. Never point this at a real instance's database: the
# tests truncate every table.
#
# Output is verbose (one line per test) so a backgrounded run's log fills
# in as it goes; redirect it to a file to keep it.
set -euo pipefail

NAME=rwnd-tv-test-postgres
PORT=55432
PG_BIN=/usr/lib/postgresql/16/bin

# Stop rather than let the backup and restore tests quietly skip, which is
# what they do when pg_dump is missing (hasPgDump() in
# apps/api/src/test/helpers.ts).
if [ ! -x "$PG_BIN/pg_dump" ] || [ ! -x "$PG_BIN/psql" ]; then
  echo "error: no Postgres 16 client in $PG_BIN; install postgresql-client-16" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "== start $(date -u '+%F %T UTC')"
docker run -d --rm --name "$NAME" \
  -e POSTGRES_USER=rwnd -e POSTGRES_PASSWORD=rwnd -e POSTGRES_DB=rwnd \
  -p "127.0.0.1:$PORT:5432" --tmpfs /var/lib/postgresql/data \
  postgres:16-alpine
# Only after `docker run` succeeds: if it failed because another run's
# container already has this name, removing it here would break that run.
trap 'echo "== removing $NAME"; docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec -i "$NAME" pg_isready -U rwnd -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$NAME" pg_isready -U rwnd -h 127.0.0.1

# The same placeholder environment as CI's `test` job; see the comments
# there for why each one is needed. None of them are real credentials.
export PATH="$PG_BIN:$PATH"
export DATABASE_URL="postgres://rwnd:rwnd@127.0.0.1:$PORT/rwnd"
export TMDB_API_KEY=ci-placeholder
export TRAKT_CLIENT_ID=ci-placeholder-client-id
export TRAKT_CLIENT_SECRET=ci-placeholder-client-secret
export ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export SMTP_HOST=localhost
export SMTP_USER=ci
export SMTP_PASS=ci-placeholder
export SMTP_FROM='rwnd.tv <ci@example.com>'
export APP_URL=http://localhost:3000

echo "== pg_dump: $(command -v pg_dump) ($(pg_dump --version))"
echo "== migrate"
pnpm db:migrate
echo "== test"
stdbuf -oL -eL pnpm test --reporter=verbose
echo "== end $(date -u '+%F %T UTC')"
