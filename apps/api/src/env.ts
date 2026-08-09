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
  METADATA_PROVIDER: z.enum(['tmdb']).default('tmdb'),
  TMDB_API_KEY: z.string().optional(),
  TMDB_API_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: z.string().url().default('https://image.tmdb.org/t/p'),
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
  return parsed.data
}

let cached: Env | undefined

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (!cached) cached = parseEnv(source)
  return cached
}
