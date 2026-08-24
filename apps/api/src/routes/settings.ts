import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  SUPPORTED_LOCALES,
  instanceSettingsSchema,
  metadataProviderSourceSchema,
  updateInstanceSettingsRequestSchema,
  type InstanceSettings,
  type MetadataProviderSource,
} from '@rwnd/shared'
import { instanceSettings } from '@rwnd/db'
import type { AppEnv } from '../types.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { loadEnv } from '../env.js'
import { availableProviderSources } from '../providers/index.js'

export const settingsRoutes = new OpenAPIHono<AppEnv>()

const DEFAULT_SETTINGS = {
  instanceName: 'rwnd.tv',
  registrationMode: 'closed' as const,
  defaultLocale: 'en-US' as const,
  metadataProviderPriority: ['tmdb'] as MetadataProviderSource[],
}

function isSupportedLocale(value: string): value is InstanceSettings['defaultLocale'] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function isProviderSource(value: string): value is MetadataProviderSource {
  return metadataProviderSourceSchema.safeParse(value).success
}

/** Narrows a DB row's free-form `defaultLocale`/`metadataProviderPriority`
 * columns to the unions the API promises. */
function serializeSettings(row?: {
  instanceName: string
  registrationMode: InstanceSettings['registrationMode']
  defaultLocale: string
  metadataProviderPriority: string[]
}): InstanceSettings {
  const source = row ?? DEFAULT_SETTINGS
  const available = availableProviderSources(loadEnv())
  // Drops anything the stored list names that this instance doesn't (or no
  // longer) have credentials for — same reasoning as isSupportedLocale
  // above. Falls back to the default (not `available` verbatim) when
  // nothing valid survives, so an instance with a garbage/empty stored
  // list still gets a sane, non-empty priority rather than an arbitrary
  // env-derived order.
  const priority = source.metadataProviderPriority.filter(isProviderSource)
  return {
    instanceName: source.instanceName,
    registrationMode: source.registrationMode,
    defaultLocale: isSupportedLocale(source.defaultLocale)
      ? source.defaultLocale
      : DEFAULT_SETTINGS.defaultLocale,
    metadataProviderPriority:
      priority.length > 0 ? priority : DEFAULT_SETTINGS.metadataProviderPriority,
    availableMetadataProviders: available,
    environmentLabel: loadEnv().ENVIRONMENT_LABEL ?? null,
    traktConfigured: Boolean(loadEnv().TRAKT_CLIENT_ID && loadEnv().TRAKT_CLIENT_SECRET),
    backupsConfigured: Boolean(loadEnv().BACKUP_DIR),
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
      400: {
        description:
          'metadataProviderPriority names a provider this instance has no credentials for',
      },
      403: { description: 'Admin only' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const db = c.get('db')

    if (body.metadataProviderPriority) {
      // Zod's own metadataProviderSourceSchema already rejects a value
      // outside the type; this is the further "must be configured on
      // *this* instance" check that can't be expressed declaratively.
      const available = new Set(availableProviderSources(loadEnv()))
      const unknown = body.metadataProviderPriority.filter((source) => !available.has(source))
      if (unknown.length > 0) {
        return c.json({ error: `Not configured on this instance: ${unknown.join(', ')}` }, 400)
      }
    }

    const [updated] = await db
      .insert(instanceSettings)
      .values({ id: 1, ...DEFAULT_SETTINGS, ...body })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { ...body, updatedAt: new Date() } })
      .returning()
    if (!updated) throw new Error('Failed to update instance settings')
    return c.json(serializeSettings(updated))
  },
)
