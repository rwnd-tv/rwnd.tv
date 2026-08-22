/**
 * Trakt's own "I don't remember when" sentinel — used app-wide for a play
 * with no known watch date (see HistoryPage.tsx's UNKNOWN_DATE_KEY,
 * apps/api/src/routes/library.ts's hasUnknownWatchDate, and
 * WatchDateDialog.tsx's "Unknown date" option). A fixed, exact timestamp
 * rather than just "some day in 1900" so it can be compared for equality,
 * not just year-extracted — apps/api/src/routes/plays.ts uses this to
 * reject logging a second unknown-date watch for an episode that already
 * has one. Shared between web and api (rather than only living in
 * apps/web/src/lib/date.ts, its original home) so both sides compare
 * against the exact same value.
 */
export const UNKNOWN_WATCHED_AT = '1900-01-01T00:00:00.000Z'
