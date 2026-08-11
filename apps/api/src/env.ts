import { z } from 'zod'

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Comma-separated origins allowed to make credentialed requests. Only
  // needed in dev, where the Vite dev server (5173) and API (3000) are on
  // different origins — in production the API serves the built SPA itself.
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : [])),
  SESSION_COOKIE_NAME: z.string().default('rwnd_session'),
  // Deliberately NOT z.coerce.boolean(): that does JS `Boolean(value)`,
  // under which the string "false" (non-empty) coerces to `true`. Parsed
  // by value below instead, defaulting off the schema's own NODE_ENV
  // rather than the ambient process.env at module-load time.
  COOKIE_SECURE: z.string().optional(),
  // Purely cosmetic: shown as a badge in the UI and prefixed on the
  // browser tab title, so multiple deployments (e.g. rwnd.tv vs
  // dev.rwnd.tv) don't get confused for one another. Unset by default —
  // a normal single-instance deployment shows nothing.
  ENVIRONMENT_LABEL: z.string().optional(),
  METADATA_PROVIDER: z.enum(['tmdb']).default('tmdb'),
  TMDB_API_KEY: z.string().optional(),
  TMDB_API_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: z.string().url().default('https://image.tmdb.org/t/p'),
  // Trakt import (M2). Both optional — a self-hoster who doesn't want Trakt
  // import just leaves these unset, and the /import UI hides itself (see
  // METADATA_PROVIDER-style optionality above). Register a free app at
  // https://trakt.tv/oauth/applications with redirect URI
  // urn:ietf:wg:oauth:2.0:oob (device flow doesn't use the redirect).
  TRAKT_CLIENT_ID: z.string().optional(),
  TRAKT_CLIENT_SECRET: z.string().optional(),
  TRAKT_API_BASE_URL: z.string().url().default('https://api.trakt.tv'),
  // Deliberately a different host from TRAKT_API_BASE_URL — Trakt's OAuth
  // flows (device code, token exchange/refresh, revocation) live on
  // auth.trakt.tv, not api.trakt.tv; sending them to the API host 404s.
  TRAKT_AUTH_BASE_URL: z.string().url().default('https://auth.trakt.tv'),
  // Base64-encoded 32 bytes, used to encrypt Trakt OAuth tokens at rest
  // (apps/api/src/lib/crypto.ts). Unlike session/API tokens (hashed only,
  // see lib/tokens.ts), these must be recoverable to make authenticated
  // Trakt requests, so they're encrypted rather than hashed. Generate with
  // `openssl rand -base64 32`. Required whenever TRAKT_CLIENT_ID is set.
  ENCRYPTION_KEY: z.string().optional(),
})

const envSchema = rawEnvSchema.transform((data) => ({
  ...data,
  COOKIE_SECURE:
    data.COOKIE_SECURE === undefined
      ? data.NODE_ENV === 'production'
      : data.COOKIE_SECURE === 'true',
}))

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration')
  }
  if (parsed.data.METADATA_PROVIDER === 'tmdb' && !parsed.data.TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is required when METADATA_PROVIDER=tmdb')
  }
  if (parsed.data.TRAKT_CLIENT_ID) {
    if (!parsed.data.TRAKT_CLIENT_SECRET) {
      throw new Error('TRAKT_CLIENT_SECRET is required when TRAKT_CLIENT_ID is set')
    }
    if (!parsed.data.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY is required when TRAKT_CLIENT_ID is set')
    }
    let keyBytes: Buffer
    try {
      keyBytes = Buffer.from(parsed.data.ENCRYPTION_KEY, 'base64')
    } catch {
      throw new Error('ENCRYPTION_KEY must be valid base64')
    }
    if (keyBytes.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must decode to exactly 32 bytes (e.g. `openssl rand -base64 32`)',
      )
    }
  }
  return parsed.data
}

let cached: Env | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (!cached) cached = parseEnv(source)
  return cached
}
