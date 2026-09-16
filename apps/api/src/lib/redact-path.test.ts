import { describe, expect, it } from 'vitest'
import { redactPath } from './redact-path.js'

describe('redactPath', () => {
  it('redacts a webhook token segment, keeping the source segment', () => {
    const result = redactPath('/api/v1/webhooks/plex/rwnd_super-secret-token')
    expect(result).toBe('/api/v1/webhooks/plex/[redacted]')
  })

  it('redacts a calendar feed token, keeping /feed.ics', () => {
    const result = redactPath('/api/v1/calendar/rwndcal_super-secret-token/feed.ics')
    expect(result).toBe('/api/v1/calendar/[redacted]/feed.ics')
  })

  it('redacts a rwnd_/rwndcal_ segment even at a path matching neither exact shape (malformed or 404 case)', () => {
    // A typo'd extension misses CALENDAR_FEED_PATH's exact shape, but the
    // token segment still needs scrubbing — this is what the prefix sweep
    // (layer 2) exists for.
    expect(redactPath('/api/v1/calendar/rwndcal_super-secret-token/feed.ic')).toBe(
      '/api/v1/calendar/[redacted]/feed.ic',
    )
    expect(redactPath('/api/v1/webhooks/plex/rwnd_super-secret-token/extra')).toBe(
      '/api/v1/webhooks/plex/[redacted]/extra',
    )
  })

  it('leaves an ordinary path untouched, including one that merely contains the word token', () => {
    expect(redactPath('/api/v1/library/shows/breaking-bad')).toBe(
      '/api/v1/library/shows/breaking-bad',
    )
    expect(redactPath('/api/v1/tokens')).toBe('/api/v1/tokens')
  })

  it('truncates a pathologically long path', () => {
    const long = `/api/v1/library/shows/${'a'.repeat(300)}`
    const result = redactPath(long)
    expect(result.length).toBeLessThan(long.length)
    expect(result.endsWith('…')).toBe(true)
  })
})
