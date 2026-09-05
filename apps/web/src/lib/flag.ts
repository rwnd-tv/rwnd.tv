/**
 * The `flag-icons` (index.css) class name pair for a two-letter region
 * code (e.g. 'GB' → 'fi fi-gb'), or null for anything that isn't exactly
 * two letters. Real SVG flags, not a Unicode flag-emoji sequence —
 * Windows' emoji font ships no flag glyphs at all (a deliberate Microsoft
 * omission), so a flag emoji would render as bare letters there
 * regardless of browser. See index.css's `flag-icons` import comment.
 */
export function regionFlagClassName(region: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(region)) return null
  return `fi fi-${region.toLowerCase()}`
}
