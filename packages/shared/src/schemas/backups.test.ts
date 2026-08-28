import { describe, expect, it } from 'vitest'
import { backupRatingSchema, backupWatchlistItemSchema, backupWatchSchema } from './backups.js'

const ref = { source: 'tmdb' as const, externalId: '1' }

describe('backupWatchSchema', () => {
  it('accepts a movie entry with no season/episode', () => {
    expect(
      backupWatchSchema.safeParse({
        movie: ref,
        watchedAt: new Date().toISOString(),
        source: 'manual',
        sourceRef: null,
      }).success,
    ).toBe(true)
  })

  it('accepts a show entry with both season and episode', () => {
    expect(
      backupWatchSchema.safeParse({
        show: ref,
        season: 1,
        episode: 2,
        watchedAt: new Date().toISOString(),
        source: 'manual',
        sourceRef: null,
      }).success,
    ).toBe(true)
  })

  it('rejects a show entry missing season/episode — a watch is always episode-level', () => {
    expect(
      backupWatchSchema.safeParse({
        show: ref,
        watchedAt: new Date().toISOString(),
        source: 'manual',
        sourceRef: null,
      }).success,
    ).toBe(false)
  })

  it('rejects providing both movie and show', () => {
    expect(
      backupWatchSchema.safeParse({
        movie: ref,
        show: ref,
        season: 1,
        episode: 2,
        watchedAt: new Date().toISOString(),
        source: 'manual',
        sourceRef: null,
      }).success,
    ).toBe(false)
  })
})

// Regression coverage for a gap the Stage 3 code review found: unlike
// backupWatchSchema above, these two schemas legitimately allow a show-level
// entry (show set, no season/episode) alongside an episode-level one (show +
// both) — a rating/watchlist entry can target a whole show, a watch cannot.
// The original refine only checked "season and episode both present or both
// absent" without tying that to movie vs show, so a movie entry carrying a
// season/episode (which can't exist — movies have neither) parsed
// successfully. See backups.ts's own refines for the fix.
describe.each([
  ['backupRatingSchema', backupRatingSchema, { rating: 5, ratedAt: new Date().toISOString() }],
  [
    'backupWatchlistItemSchema',
    backupWatchlistItemSchema,
    { listedAt: new Date().toISOString(), notes: null, list: 'Default' },
  ],
] as const)('%s', (_name, schema, extra) => {
  it('accepts a movie entry with no season/episode', () => {
    expect(schema.safeParse({ movie: ref, ...extra }).success).toBe(true)
  })

  it('accepts a show-level entry (show set, no season/episode)', () => {
    expect(schema.safeParse({ show: ref, ...extra }).success).toBe(true)
  })

  it('accepts an episode-level entry (show + season + episode)', () => {
    expect(schema.safeParse({ show: ref, season: 1, episode: 2, ...extra }).success).toBe(true)
  })

  it('rejects a movie entry carrying a season/episode — a movie has neither (regression)', () => {
    expect(schema.safeParse({ movie: ref, season: 1, episode: 2, ...extra }).success).toBe(false)
  })

  it('rejects a show entry with only one of season/episode', () => {
    expect(schema.safeParse({ show: ref, season: 1, ...extra }).success).toBe(false)
  })

  it('rejects providing both movie and show', () => {
    expect(
      schema.safeParse({ movie: ref, show: ref, season: 1, episode: 2, ...extra }).success,
    ).toBe(false)
  })

  it('rejects providing neither movie nor show', () => {
    expect(schema.safeParse({ ...extra }).success).toBe(false)
  })
})
