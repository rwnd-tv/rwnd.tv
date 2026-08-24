import type { Database } from '@rwnd/db'
import { instanceSettings } from '@rwnd/db'
import type { MetadataProvider } from './types.js'

/**
 * The instance's providers in admin-configured priority order (Settings —
 * see docs/adr/0006). Unknown or unconfigured entries in the stored list
 * are dropped (an admin's saved priority can outlive the credentials that
 * made it valid, e.g. an API key removed from the environment); any
 * available provider the list doesn't mention is appended at the end, so
 * adding a new provider's credentials to a deployment doesn't leave it
 * invisible until someone remembers to edit this setting. Never returns an
 * empty array — `providers` itself is guaranteed non-empty by
 * createMetadataProviders() at boot, so there's always at least the
 * appended tail even if the stored list is garbage.
 *
 * Only consulted where fallback across providers already matters — the
 * metadata refresher and Trakt import matching (both re-read this per run,
 * not once at boot, so a priority change takes effect without a restart).
 * Search, resolve, and episode/season fetches still use the single primary
 * provider from AppEnv — see apps/api/src/types.ts's doc comment.
 */
export async function orderedProviders(
  db: Database,
  providers: MetadataProvider[],
): Promise<MetadataProvider[]> {
  const [row] = await db
    .select({ metadataProviderPriority: instanceSettings.metadataProviderPriority })
    .from(instanceSettings)
    .limit(1)
  const stored = row?.metadataProviderPriority ?? []

  const bySource = new Map(providers.map((provider) => [provider.source, provider]))
  const ordered: MetadataProvider[] = []
  for (const source of stored) {
    const provider = bySource.get(source as MetadataProvider['source'])
    if (provider) {
      ordered.push(provider)
      bySource.delete(provider.source)
    }
  }
  // Whatever's left wasn't in the stored list at all — append in
  // createMetadataProviders()'s own order rather than dropping it.
  for (const provider of providers) {
    if (bySource.has(provider.source)) ordered.push(provider)
  }
  return ordered
}
