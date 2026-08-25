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
  // Which metadata providers are available is derived from which of these
  // credentials are actually set (apps/api/src/providers/index.ts) rather
  // than a separate explicit-choice env var — see docs/adr/0006. At least
  // one must be set; validated below since Zod can't express "at least one
  // of these optional fields" declaratively.
  TMDB_API_KEY: z.string().optional(),
  TMDB_API_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: z.string().url().default('https://image.tmdb.org/t/p'),
  // TheTVDB v4 API requires an account — either a paid/commercial key, or a
  // free "user-supported" key paired with the subscriber's PIN (see
  // apps/api/src/providers/tvdb.ts's login()). PIN is optional even when
  // TVDB_API_KEY is set: a commercial key doesn't use one, and the API
  // itself treats a present-but-empty pin as an error rather than ignoring
  // it, so this is only ever sent when actually configured.
  TVDB_API_KEY: z.string().optional(),
  TVDB_PIN: z.string().optional(),
  TVDB_API_BASE_URL: z.string().url().default('https://api4.thetvdb.com/v4'),
  // Trakt import (M2). Both optional — a self-hoster who doesn't want Trakt
  // import just leaves these unset, and the /import UI hides itself (same
  // "optional credential, feature hides itself" pattern as TMDB_API_KEY
  // above). Register a free app at
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
  // Per-user backup/restore (Settings > Database). Optional, same pattern as
  // TRAKT_CLIENT_ID above — unset means the feature hides itself in the web
  // app (see instanceSettingsSchema's backupsConfigured) rather than
  // erroring. Must be a directory the container's unprivileged `rwnd` user
  // (see Dockerfile) can write to; apps/api/src/backup/paths.ts creates the
  // per-user subdirectory under it on first use, but not this root itself.
  BACKUP_DIR: z.string().optional(),
  // Outbound email (account verification, password reset —
  // apps/api/src/lib/email.ts). Optional as a group, same "unset means the
  // feature hides itself" pattern as TRAKT_CLIENT_ID/BACKUP_DIR above —
  // SMTP_HOST is what actually gates it (see instanceSettingsSchema's
  // emailConfigured); the other four are required whenever it's set, since
  // a half-configured SMTP setup can't send anything. Plain SMTP, not a
  // specific provider's API, deliberately — see docs/self-hosting.md, any
  // self-hoster's own mail relay (Gmail with an App Password, a
  // transactional-email provider's SMTP endpoint, a self-run mail server,
  // ...) works without rwnd.tv taking a dependency on one vendor's SDK.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Shown as the message's From header — e.g. '"rwnd.tv" <noreply@example.com>'.
  SMTP_FROM: z.string().optional(),
  // This instance's own public base URL, e.g. 'https://rwnd.tv' — required
  // alongside SMTP_HOST to build the verification/reset links a sent email
  // actually points at (there's no reliable way to derive this from a
  // request's own Host header behind an arbitrary reverse proxy setup, so
  // it's explicit rather than guessed). No trailing slash.
  APP_URL: z.string().url().optional(),
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
  // At least one metadata provider's credentials must be configured — see
  // apps/api/src/providers/index.ts's createMetadataProviders, which this
  // check mirrors.
  if (!parsed.data.TMDB_API_KEY && !parsed.data.TVDB_API_KEY) {
    throw new Error(
      'At least one metadata provider must be configured — set TMDB_API_KEY and/or TVDB_API_KEY',
    )
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
  if (parsed.data.SMTP_HOST) {
    const missing = (['SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'APP_URL'] as const).filter(
      (key) => !parsed.data[key],
    )
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required when SMTP_HOST is set`,
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
