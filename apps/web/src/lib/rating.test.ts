import { describe, expect, it } from 'vitest'
import { averageEpisodeRatingStars, ratingToStars, starsToRating } from './rating.js'

describe('starsToRating', () => {
  it('doubles the star count onto the stored 1-10 scale', () => {
    expect(starsToRating(1)).toBe(2)
    expect(starsToRating(2)).toBe(4)
    expect(starsToRating(3)).toBe(6)
    expect(starsToRating(4)).toBe(8)
    expect(starsToRating(5)).toBe(10)
  })
})

describe('ratingToStars', () => {
  it('maps every even value exactly', () => {
    expect(ratingToStars(2)).toBe(1)
    expect(ratingToStars(4)).toBe(2)
    expect(ratingToStars(6)).toBe(3)
    expect(ratingToStars(8)).toBe(4)
    expect(ratingToStars(10)).toBe(5)
  })

  // A Trakt-imported odd rating never lands on a whole star — rounds half
  // up, the decision made for this feature (never a half-filled star).
  it('rounds an odd (Trakt-imported) value half up', () => {
    expect(ratingToStars(1)).toBe(1)
    expect(ratingToStars(3)).toBe(2)
    expect(ratingToStars(5)).toBe(3)
    expect(ratingToStars(7)).toBe(4)
    expect(ratingToStars(9)).toBe(5)
  })

  it('clamps within 1-5 regardless of input', () => {
    expect(ratingToStars(1)).toBeGreaterThanOrEqual(1)
    expect(ratingToStars(10)).toBeLessThanOrEqual(5)
  })
})

describe('averageEpisodeRatingStars', () => {
  it('returns null when nothing in the season is rated', () => {
    expect(averageEpisodeRatingStars([{ myRating: null }, { myRating: null }])).toBeNull()
  })

  it('excludes unrated episodes entirely rather than counting them as 0', () => {
    // (8 + 10) / 2 episodes = 9 raw, / 2 = 4.5 stars — not (8 + 10 + 0) / 3.
    expect(averageEpisodeRatingStars([{ myRating: 8 }, { myRating: null }, { myRating: 10 }])).toBe(
      4.5,
    )
  })

  it('averages raw values before converting to stars, not each episode’s rounded star count', () => {
    // Averaging the raw values first: (7 + 9) / 2 = 8, / 2 = 4 stars.
    // Averaging each episode's already-rounded star count instead
    // (ratingToStars(7)=4, ratingToStars(9)=5) would give 4.5 — a different,
    // less precise answer this function deliberately avoids.
    expect(averageEpisodeRatingStars([{ myRating: 7 }, { myRating: 9 }])).toBe(4)
  })

  it('handles a single rated episode', () => {
    expect(averageEpisodeRatingStars([{ myRating: 6 }])).toBe(3)
  })
})
