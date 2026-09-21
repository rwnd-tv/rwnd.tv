/**
 * Whether an episode/season row with this `firstAired` date has aired as
 * of `now` — the one rule this app applies everywhere it decides whether
 * something can be rated, watched, or counted as "upcoming" for an
 * episode. Shared between `apps/api` and `apps/web` (rather than living
 * api-only) because both sides needed their own copy before this existed —
 * same "both compare against the exact same value" reasoning as
 * `UNKNOWN_WATCHED_AT` above.
 *
 * `firstAired` is a bare `'YYYY-MM-DD'` day (this app's `date()` column
 * convention), so `new Date(firstAired)` is UTC midnight on that day on
 * both the server and any browser, regardless of the reader's own
 * timezone — deliberately not the same question `calendar/build.ts`'s SQL
 * form asks, which resolves "today" against the *user's* timezone and can
 * disagree with this by up to a day (accepted there, documented in that
 * file). Also deliberately not what `findNextAiringEpisode` needs (the
 * *upcoming*, not aired, question, boundaried at local midnight) or what a
 * movie's release-date check needs (the opposite null rule: TVDB movies
 * never carry a release date at all, so null means "unknown", not
 * "unaired" - see `apps/api/src/routes/library/ratings.ts`/`plays.ts`).
 */
export function hasAired(firstAired: string | null, now: Date = new Date()): boolean {
  return firstAired !== null && new Date(firstAired) <= now
}

/** Type-narrowing form of `hasAired`, for a filter/some/every call that
 * needs the result typed as "definitely has a non-null firstAired"
 * afterward (e.g. `apps/api/src/routes/library/shared.ts`'s
 * `logMissingWatches`, which reads `episode.firstAired` as a plain string
 * once filtered). */
export function airedEpisode<T extends { firstAired: string | null }>(
  episode: T,
  now: Date = new Date(),
): episode is T & { firstAired: string } {
  return hasAired(episode.firstAired, now)
}
