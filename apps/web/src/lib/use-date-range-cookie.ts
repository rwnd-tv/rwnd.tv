import { useState } from 'react'
import { getCookie, setSessionCookie } from './cookies.js'

export interface DateRange {
  /** Inclusive "YYYY-MM-DD" bound, or `null` for unbounded. */
  after: string | null
  before: string | null
}

const EMPTY_RANGE: DateRange = { after: null, before: null }

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parseStoredRange(raw: string | undefined): DateRange {
  if (!raw) return EMPTY_RANGE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY_RANGE
    const after = isDateString((parsed as Partial<DateRange>).after)
      ? (parsed as DateRange).after
      : null
    const before = isDateString((parsed as Partial<DateRange>).before)
      ? (parsed as DateRange).before
      : null
    return { after, before }
  } catch {
    return EMPTY_RANGE
  }
}

/**
 * Same session-cookie approach as use-sort-cookie.ts/
 * use-activity-kind-filter-cookie.ts — remembered while browsing, cleared
 * when the browser closes. Unlike use-year-range-cookie.ts, there's no
 * min/max to clamp against (the account's actual date range isn't known
 * client-side, and isn't needed — an inverted or empty-result range is a
 * normal, recoverable state here, same as the kind filter narrowing to
 * zero: HistoryPage.tsx's existing "no matches" empty state already
 * handles it, and Reset/editing a date gets back out).
 */
export function useDateRangeCookie(cookieName: string): [DateRange, (next: DateRange) => void] {
  const [range, setRange] = useState<DateRange>(() => parseStoredRange(getCookie(cookieName)))

  function update(next: DateRange) {
    setRange(next)
    setSessionCookie(cookieName, JSON.stringify(next))
  }

  return [range, update]
}
