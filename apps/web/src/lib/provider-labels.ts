import type { MetadataProviderSource } from '@rwnd/shared'

/** Display name for a metadata provider source — shared by the Settings
 * page's provider-priority list (InstanceSettingsPanel.tsx) and the
 * show/movie detail pages' "Metadata: TMDB" provenance indicator. Not
 * translated: these are proper nouns (product names), same convention as
 * the TMDB attribution logo/link elsewhere in the app. */
export const PROVIDER_LABELS: Record<MetadataProviderSource, string> = {
  tmdb: 'TMDB',
  tvdb: 'TVDB',
}
