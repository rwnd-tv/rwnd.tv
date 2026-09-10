import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETENTION_TIERS,
  selectDumpsToKeep,
  type RetentionTiers,
} from '../lib/database-backup.js'

// No filesystem, no DB — selectDumpsToKeep is pure, so these run everywhere
// (unlike database-backup.test.ts's pg_dump round-trip, which skips on
// Windows).

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-10T12:00:00Z')

function dumpAgedDays(days: number): { name: string; createdAt: Date } {
  return {
    name: `age-${days}`,
    createdAt: new Date(NOW.getTime() - days * DAY_MS),
  }
}

describe('selectDumpsToKeep', () => {
  it('keeps every dump within the daily window outright', () => {
    const dumps = [0, 1, 2, 3, 4, 5, 6].map(dumpAgedDays)
    const keep = selectDumpsToKeep(dumps, NOW, DEFAULT_RETENTION_TIERS)
    expect(keep).toEqual(new Set(dumps.map((d) => d.name)))
  })

  it('thins the weekly window to one dump per 7-day bucket', () => {
    // Daily window is 7 days; the weekly window covers days 7-35. One dump
    // per day across it should collapse to one survivor per 7-day bucket —
    // 4 weekly buckets.
    const dumps = Array.from({ length: 28 }, (_, i) => dumpAgedDays(7 + i))
    const keep = selectDumpsToKeep(dumps, NOW, DEFAULT_RETENTION_TIERS)
    expect(keep.size).toBe(4)
    // The newest dump in each bucket survives (bucket 0 = days 7-13, its
    // newest is day 7).
    expect(keep.has('age-7')).toBe(true)
    expect(keep.has('age-14')).toBe(true)
    expect(keep.has('age-21')).toBe(true)
    expect(keep.has('age-28')).toBe(true)
  })

  it('thins the monthly window to one dump per 30-day bucket', () => {
    // Weekly window ends at day 7 + 4*7 = 35. Monthly window covers
    // days 35-395 (12 * 30 more days).
    const dumps = [dumpAgedDays(40), dumpAgedDays(60), dumpAgedDays(65)]
    const keep = selectDumpsToKeep(dumps, NOW, DEFAULT_RETENTION_TIERS)
    // 40 and 60 fall in different 30-day buckets from the 35-day boundary
    // (bucket 0 = 35-65, bucket 1 = 65-95) — 40 and 60 share bucket 0
    // (newest, 40, survives), 65 starts bucket 1.
    expect(keep).toEqual(new Set(['age-40', 'age-65']))
  })

  it('drops anything at or past the monthly boundary', () => {
    const dumps = [dumpAgedDays(400), dumpAgedDays(1000)]
    const keep = selectDumpsToKeep(dumps, NOW, DEFAULT_RETENTION_TIERS)
    expect(keep.size).toBe(0)
  })

  it('skips a zeroed tier entirely', () => {
    const tiers: RetentionTiers = {
      dailyRetentionDays: 7,
      weeklyRetentionWeeks: 0,
      monthlyRetentionMonths: 4,
    }
    // Day 10 would have landed in the weekly tier under the default
    // config, but with weeklyRetentionWeeks: 0 the weekly window has zero
    // width, so day 10 falls straight into the monthly tier instead.
    const dumps = [dumpAgedDays(5), dumpAgedDays(10)]
    const keep = selectDumpsToKeep(dumps, NOW, tiers)
    expect(keep).toEqual(new Set(['age-5', 'age-10']))
  })

  it('supports "daily backups, kept for a year, nothing else"', () => {
    const tiers: RetentionTiers = {
      dailyRetentionDays: 365,
      weeklyRetentionWeeks: 0,
      monthlyRetentionMonths: 0,
    }
    const dumps = [dumpAgedDays(0), dumpAgedDays(200), dumpAgedDays(364), dumpAgedDays(366)]
    const keep = selectDumpsToKeep(dumps, NOW, tiers)
    expect(keep).toEqual(new Set(['age-0', 'age-200', 'age-364']))
  })
})
