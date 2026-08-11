import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  SUPPORTED_LOCALES,
  instanceSettingsSchema,
  updateInstanceSettingsRequestSchema,
  type InstanceSettings,
} from '@rwnd/shared'
import { instanceSettings } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { loadEnv } from '../env.js'

export const settingsRoutes = new OpenAPIHono<AppEnv>()

const DEFAULT_SETTINGS = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed' as const,
  defaultLocale: 'en-GB' as const,
}

function isSupportedLocale(value: string): value is InstanceSettings['defaultLocale'] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Narrows a DB row's free-form `defaultLocale` text column to the locale union the API promises. */
function serializeSettings(row?: {
  instanceName: string
  registrationMode: InstanceSettings['registrationMode']
  defaultLocale: string
}): InstanceSettings {
  const source = row ?? DEFAULT_SETTINGS
  return {
    instanceName: source.instanceName,
    registrationMode: source.registrationMode,
    defaultLocale: isSupportedLocale(source.defaultLocale)
      ? source.defaultLocale
      : DEFAULT_SETTINGS.defaultLocale,
    environmentLabel: loadEnv().ENVIRONMENT_LABEL ?? null,
    traktConfigured: Boolean(loadEnv().TRAKT_CLIENT_ID && loadEnv().TRAKT_CLIENT_SECRET),
  }
}

// Instance name / registration mode / default locale are not sensitive —
// the login and setup screens need to read them before anyone is
// authenticated (e.g. to decide whether to show a "Register" link). PATCH
// below is gated on admin explicitly in its own handler chain, rather than
// via app.use('/settings', ...), since that would match this GET too.
settingsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    summary: 'Public instance settings',
    responses: {
      200: {
        description: 'Instance settings',
        content: { 'application/json': { schema: instanceSettingsSchema } },
      },
    },
  }),
  async (c) => {
    const [row] = await c.get('db').select().from(instanceSettings).limit(1)
    return c.json(serializeSettings(row))
  },
)

settingsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    summary: 'Update instance settings (admin only)',
    middleware: [requireAuth, requireAdmin] as const,
    request: {
      body: { content: { 'application/json': { schema: updateInstanceSettingsRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: instanceSettingsSchema } },
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')
    const [updated] = await db
      .insert(instanceSettings)
      .values({ id: 1, ...DEFAULT_SETTINGS, ...body })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { ...body, updatedAt: new Date() } })
      .returning()
    if (!updated) throw new Error('Failed to update instance settings')
    return c.json(serializeSettings(updated))
  },
)
