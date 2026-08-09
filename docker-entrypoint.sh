#!/bin/sh
set -e

echo "Running database migrations..."
/app/db/node_modules/.bin/tsx /app/db/src/migrate.ts

echo "Ensuring instance settings exist..."
/app/db/node_modules/.bin/tsx /app/db/src/seed.ts

echo "Starting rwnd.tv API..."
exec node /app/api/dist/index.js
