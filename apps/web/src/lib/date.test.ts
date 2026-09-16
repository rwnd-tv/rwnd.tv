import { describe, expect, it } from 'vitest'
import { formatCalendarDayHeading, parseLocalDay } from './date.js'

// A trivial stand-in for react-i18next's `t` — this is a lib-level unit
// test, not a component render, so the real i18next instance (which
// component tests boot via src/test/setup.ts) isn't in play here; the
// three keys formatDashboardDate itself calls are all this needs.
const t = (key: string): string =>
  ({ 'common.today': 'Today', 'common.yesterday': 'Yesterday', 'common.tomorrow': 'Tomorrow' })[
    key
  ] ?? key

function daysFromNow(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

describe('formatCalendarDayHeading', () => {
  it('labels today, yesterday, and tomorrow', () => {
    expect(formatCalendarDayHeading(daysFromNow(0), 'en-GB', t)).toBe('Today')
    expect(formatCalendarDayHeading(daysFromNow(-1), 'en-GB', t)).toBe('Yesterday')
    expect(formatCalendarDayHeading(daysFromNow(1), 'en-GB', t)).toBe('Tomorrow')
  })

  it('labels a day within the coming week by weekday name', () => {
    const date = daysFromNow(5)
    const expected = date.toLocaleDateString('en-GB', { weekday: 'long' })
    expect(formatCalendarDayHeading(date, 'en-GB', t)).toBe(expected)
  })

  it('labels a day 5 days in the past by day/month, not a weekday name', () => {
    // formatDashboardDate's own weekdayWithinDays branch only fires for a
    // *future* day beyond tomorrow (dayDiff > 1) — a past day beyond
    // yesterday falls through to its plain day/month fallback instead.
    // formatCalendarDayHeading inherits that asymmetry rather than
    // reimplementing a symmetric window.
    const date = daysFromNow(-5)
    const expected = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    expect(formatCalendarDayHeading(date, 'en-GB', t)).toBe(expected)
  })

  it('falls back to a full date (including year) beyond the weekday window', () => {
    const date = daysFromNow(60)
    const expected = date.toLocaleDateString('en-GB', { dateStyle: 'full' })
    expect(formatCalendarDayHeading(date, 'en-GB', t)).toBe(expected)
  })
})

describe('parseLocalDay', () => {
  it('parses year/month/day as local midnight, matching new Date(y, m-1, d)', () => {
    const parsed = parseLocalDay('2026-03-15')
    const expected = new Date(2026, 2, 15)
    expect(parsed.getTime()).toBe(expected.getTime())
  })

  it('does not shift a January 1st date to the previous day (the UTC-midnight bug this exists to avoid)', () => {
    const parsed = parseLocalDay('2026-01-01')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(0)
    expect(parsed.getDate()).toBe(1)
  })

  it('does not shift a December 31st date to the next day', () => {
    const parsed = parseLocalDay('2025-12-31')
    expect(parsed.getFullYear()).toBe(2025)
    expect(parsed.getMonth()).toBe(11)
    expect(parsed.getDate()).toBe(31)
  })
})
