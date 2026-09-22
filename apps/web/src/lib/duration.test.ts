import { describe, expect, it } from 'vitest'
import { formatDuration } from './duration.js'

/** Mirrors the real i18next keys' shape (stats.duration.{days,hours,minutes}
 * with a {{count}}) without pulling in the real translation bundle — this
 * file is testing the unit-selection/rounding logic, not the English copy. */
function fakeT(key: string, options?: Record<string, unknown>): string {
  const count = options?.count as number
  const unit = key.split('.').pop()
  return `${count} ${unit}`
}

describe('formatDuration', () => {
  it('shows days and hours once at least a day has passed', () => {
    // 3 days, 4 hours = 3*1440 + 4*60 = 4560
    expect(formatDuration(4560, fakeT)).toBe('3 days, 4 hours')
  })

  it('drops a zero hours component when the duration is a whole number of days', () => {
    expect(formatDuration(2880, fakeT)).toBe('2 days')
  })

  it('shows hours and minutes under a day', () => {
    expect(formatDuration(542, fakeT)).toBe('9 hours, 2 minutes')
  })

  it('drops a zero minutes component when the duration is a whole number of hours', () => {
    expect(formatDuration(180, fakeT)).toBe('3 hours')
  })

  it('shows minutes alone under an hour', () => {
    expect(formatDuration(42, fakeT)).toBe('42 minutes')
  })

  it('shows zero minutes for a zero or negative duration', () => {
    expect(formatDuration(0, fakeT)).toBe('0 minutes')
    expect(formatDuration(-5, fakeT)).toBe('0 minutes')
  })

  it('rounds a fractional minute count', () => {
    expect(formatDuration(42.6, fakeT)).toBe('43 minutes')
  })
})
