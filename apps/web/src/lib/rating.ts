/**
 * Pure 1-10-rating <-> 5-star maths shared by RatingPicker.tsx and the
 * gallery's poster-tile rating display — pulled out as plain functions, no
 * React, same reasoning as library-filter.ts's own doc comment: worth
 * unit-testing on its own, independent of how RatingPicker renders it.
 */
export const STAR_COUNT = 5

/** Nearest whole star for a stored 1-10 rating, rounding half up — display
 * only, never used to rewrite the stored value. A Trakt-imported odd rating
 * (e.g. 7) always shows rounded (4★) and stays 7 until re-rated, at which
 * point clicking a star writes its even equivalent. */
export function ratingToStars(rating: number): number {
  return Math.min(STAR_COUNT, Math.max(1, Math.round(rating / 2)))
}

/** Star count (1-5) -> the stored 1-10 value. The widget only ever writes
 * even values — see ratingToStars above for the odd-value display case. */
export function starsToRating(stars: number): number {
  return stars * 2
}

/**
 * Average of a season's rated episodes' own ratings, in star units (one
 * decimal, e.g. 4.6) — SeasonDetailPage.tsx's read-only summary next to the
 * episode grid. Averages the raw 1-10 values first, then converts to stars,
 * rather than averaging each episode's already-rounded star count — more
 * precise, and consistent with ratingToStars only ever being a *display*
 * rounding, never a value to compute further from. Unrated episodes are
 * excluded entirely, not counted as 0 — same "no basis to place it" rule
 * library-filter.ts's range functions use. `null` when nothing in the
 * season has been rated yet, so the caller can hide the stat rather than
 * show a meaningless 0.0.
 */
export function averageEpisodeRatingStars(episodes: { myRating: number | null }[]): number | null {
  const rated = episodes.map((episode) => episode.myRating).filter((r): r is number => r !== null)
  if (rated.length === 0) return null
  const averageRawRating = rated.reduce((sum, r) => sum + r, 0) / rated.length
  return averageRawRating / 2
}
