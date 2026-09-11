/** Shared string/number/boolean coercion for the Jellyfin and Emby
 * parsers. Both need to tolerate a value arriving as either its native
 * JSON type or a string: Jellyfin's Generic webhook destination is
 * admin-templated (a hand-written Handlebars template quotes every value
 * as a string to stay valid JSON — see jellyfin.ts's doc comment), while
 * Emby's built-in Webhooks plugin sends native types but is otherwise
 * unpredictable enough (see emby.ts) to be worth the same tolerance. */

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number') return String(value)
  return undefined
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return undefined
}
