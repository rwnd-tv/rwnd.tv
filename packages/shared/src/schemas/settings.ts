import { z } from 'zod'
import { localeSchema } from './common.js'

export const registrationModeSchema = z.enum(['open', 'invite', 'closed'])
export type RegistrationMode = z.infer<typeof registrationModeSchema>

export const instanceSettingsSchema = z.object({
  instanceName: z.string(),
  registrationMode: registrationModeSchema,
  defaultLocale: localeSchema,
})
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>

export const updateInstanceSettingsRequestSchema = instanceSettingsSchema.partial()
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>
