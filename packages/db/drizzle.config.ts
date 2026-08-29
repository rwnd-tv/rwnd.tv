import { defineConfig } from 'drizzle-kit'
import { loadDbEnv } from './src/env.js'

const { databaseUrl, ssl } = loadDbEnv()

export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    // drizzle-kit's `ssl` config field only exists on the host/port/...
    // shape of dbCredentials, not alongside a bare `url` — so DATABASE_SSL
    // is expressed as a `sslmode` query param here instead, same effect.
    url: ssl
      ? `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=require`
      : databaseUrl,
  },
  strict: true,
  verbose: true,
})
