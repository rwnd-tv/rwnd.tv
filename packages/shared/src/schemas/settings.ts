import { z } from 'zod'
import { localeSchema } from './common.js'

export const registrationModeSchema = z.enum(['open', 'invite', 'closed'])
export type RegistrationMode = z.infer<typeof registrationModeSchema>

export const instanceSettingsSchema = z.object({
  instanceName: z.string(),
  registrationMode: registrationModeSchema,
  defaultLocale: localeSchema,
  // Set via the ENVIRONMENT_LABEL env var at deploy time, not admin-editable
  // here — see apps/api/src/env.ts.
  environmentLabel: z.string().nullable(),
})
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>

export const updateInstanceSettingsRequestSchema = instanceSettingsSchema
  .omit({ environmentLabel: true })
  .partial()
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>
