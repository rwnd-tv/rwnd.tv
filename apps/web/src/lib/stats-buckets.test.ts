import { describe, expect, it } from 'vitest'
import { availableYearsFrom, bucketByMonth, bucketByYear, weekHourMatrix } from './stats-buckets.js'

/** Local `new Date(y, m, d, h)` -> epoch minutes, matching stats-buckets.ts's
 * own doc comment on why these tests avoid hardcoded UTC timestamps. */
function epochMinutes(year: number, month: number, day: number, hour = 12): number {
  return Math.floor(new Date(year, month, day, hour).getTime() / 60_000)
}

describe('availableYearsFrom', () => {
  it('returns every local year present across both arrays, newest first', () => {
    const episodePlays = [epochMinutes(2024, 5, 1), epochMinutes(2025, 0, 1)]
    const moviePlays = [epochMinutes(2023, 11, 31), epochMinutes(2025, 0, 1)]
    expect(availableYearsFrom(episodePlays, moviePlays)).toEqual([2025, 2024, 2023])
  })

  it('returns an empty array for no plays', () => {
    expect(availableYearsFrom([], [])).toEqual([])
  })
})

describe('bucketByMonth', () => {
  it('counts plays per local month for the requested year only', () => {
    const plays = [
      epochMinutes(2025, 0, 15), // Jan 2025
      epochMinutes(2025, 0, 20), // Jan 2025
      epochMinutes(2025, 5, 1), // Jun 2025
      epochMinutes(2024, 11, 31), // Dec 2024 — different year, excluded
    ]
    const buckets = bucketByMonth(plays, 2025)
    expect(buckets).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])
  })

  it('returns twelve zero buckets for a year with no plays', () => {
    expect(bucketByMonth([], 2025)).toEqual(new Array(12).fill(0))
  })
})

describe('bucketByYear', () => {
  it('counts plays per local year', () => {
    const plays = [
      epochMinutes(2023, 0, 1),
      epochMinutes(2024, 5, 15),
      epochMinutes(2024, 5, 16),
      epochMinutes(2025, 11, 31),
    ]
    expect(bucketByYear(plays)).toEqual(
      new Map([
        [2023, 1],
        [2024, 2],
        [2025, 1],
      ]),
    )
  })

  it('returns an empty map for no plays', () => {
    expect(bucketByYear([])).toEqual(new Map())
  })
})

describe('weekHourMatrix', () => {
  it('counts plays by local day-of-week and hour, restricted to the requested year', () => {
    // 2025-06-01 is a Sunday, 2025-06-02 the following Monday.
    const plays = [
      epochMinutes(2025, 5, 2, 14), // Mon 14:00
      epochMinutes(2025, 5, 2, 14), // Mon 14:00 again
      epochMinutes(2025, 5, 1, 9), // Sun 09:00
      epochMinutes(2024, 5, 2, 14), // same weekday/hour, different year — excluded
    ]
    const matrix = weekHourMatrix(plays, 2025)

    expect(matrix).toHaveLength(7)
    expect(matrix.every((row) => row.length === 24)).toBe(true)
    expect(matrix[1]![14]).toBe(2) // Monday 14:00
    expect(matrix[0]![9]).toBe(1) // Sunday 09:00
    expect(matrix.flat().reduce((sum, n) => sum + n, 0)).toBe(3)
  })

  it("includes every year's plays when year is 'all'", () => {
    // 2024-06-03 and 2025-06-02 are both Mondays.
    const plays = [epochMinutes(2025, 5, 2, 14), epochMinutes(2024, 5, 3, 14)]
    const matrix = weekHourMatrix(plays, 'all')
    expect(matrix[1]![14]).toBe(2)
  })

  it('returns an all-zero 7x24 matrix for no plays', () => {
    const matrix = weekHourMatrix([], 'all')
    expect(matrix).toHaveLength(7)
    expect(matrix.flat().every((n) => n === 0)).toBe(true)
  })
})
