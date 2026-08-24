import { metadataProviderSourceSchema, type MetadataProviderSource } from '@rwnd/shared'

/** Narrows a free-form string (a DB column's wider `external_id_source`
 * value, or admin-submitted JSON) to the two-value `MetadataProviderSource`
 * union — shared by apps/api/src/routes/settings.ts (validating/narrowing
 * `metadataProviderPriority`) and apps/api/src/routes/library.ts (narrowing
 * `shows.metadataSource`/`movies.metadataSource`), so both stay in sync
 * with metadataProviderSourceSchema (packages/shared/src/schemas/common.ts)
 * automatically rather than duplicating the check. */
export function isProviderSource(value: string): value is MetadataProviderSource {
  return metadataProviderSourceSchema.safeParse(value).success
}
