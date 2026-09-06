import { describe, expect, it } from 'vitest'
import { formatCalendarDayHeading } from './date.js'

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
