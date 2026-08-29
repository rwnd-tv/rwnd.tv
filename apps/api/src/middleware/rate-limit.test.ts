import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits, tryConsume } from './rate-limit.js'

describe('tryConsume', () => {
  beforeEach(() => resetRateLimits())
  afterEach(() => vi.useRealTimers())

  it('allows up to the limit, then rejects', () => {
    expect(tryConsume('k', 3, 60_000)).toBe(true)
    expect(tryConsume('k', 3, 60_000)).toBe(true)
    expect(tryConsume('k', 3, 60_000)).toBe(true)
    expect(tryConsume('k', 3, 60_000)).toBe(false)
    expect(tryConsume('k', 3, 60_000)).toBe(false)
  })

  it('tracks separate keys independently', () => {
    expect(tryConsume('a', 1, 60_000)).toBe(true)
    expect(tryConsume('a', 1, 60_000)).toBe(false)
    // A different key's budget is untouched by 'a' being exhausted.
    expect(tryConsume('b', 1, 60_000)).toBe(true)
  })

  it('resets once the window elapses', () => {
    vi.useFakeTimers()
    expect(tryConsume('k', 2, 1_000)).toBe(true)
    expect(tryConsume('k', 2, 1_000)).toBe(true)
    expect(tryConsume('k', 2, 1_000)).toBe(false)

    vi.advanceTimersByTime(1_001)

    expect(tryConsume('k', 2, 1_000)).toBe(true)
  })

  it('resetRateLimits() clears every key', () => {
    expect(tryConsume('k', 1, 60_000)).toBe(true)
    expect(tryConsume('k', 1, 60_000)).toBe(false)
    resetRateLimits()
    expect(tryConsume('k', 1, 60_000)).toBe(true)
  })
})
