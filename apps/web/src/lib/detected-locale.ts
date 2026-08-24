import { SUPPORTED_LOCALES, type Locale } from '@rwnd/shared'

/**
 * Narrows i18next's resolved `i18n.language` (RegisterPage.tsx/SetupPage.tsx)
 * to a `Locale` for the new-account `locale` field — i18next's own
 * `LanguageDetector` already exact-matched the browser's language against
 * `SUPPORTED_LOCALES` (falling back to `fallbackLng` otherwise, see
 * apps/web/src/i18n/index.ts), so this only narrows the type rather than
 * re-detecting anything. Always returns a real locale in practice, since
 * `i18n.language` can't resolve outside `supportedLngs` — the `undefined`
 * case just lets the request schema's own default apply if that ever
 * changes.
 */
export function detectedLocale(language: string): Locale | undefined {
  return (SUPPORTED_LOCALES as readonly string[]).includes(language)
    ? (language as Locale)
    : undefined
}
