import { describe, expect, it } from 'vitest'
import { airedEpisode, hasAired } from './aired.js'

describe('hasAired', () => {
  it('is false for a null firstAired', () => {
    expect(hasAired(null)).toBe(false)
  })

  it('is false for a date strictly after now', () => {
    expect(hasAired('2099-01-01', new Date('2026-01-01T00:00:00.000Z'))).toBe(false)
  })

  it('is true for a date exactly at now (UTC midnight boundary)', () => {
    expect(hasAired('2026-01-01', new Date('2026-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('is true for a date strictly before now', () => {
    expect(hasAired('2020-01-01', new Date('2026-01-01T00:00:00.000Z'))).toBe(true)
  })
})

describe('airedEpisode', () => {
  it('narrows firstAired to a non-null string when true', () => {
    const episode: { firstAired: string | null } = { firstAired: '2020-01-01' }
    const now = new Date('2026-01-01T00:00:00.000Z')
    if (airedEpisode(episode, now)) {
      // Type-level assertion: this line only compiles if firstAired narrowed to `string`.
      const firstAired: string = episode.firstAired
      expect(firstAired).toBe('2020-01-01')
    } else {
      throw new Error('expected airedEpisode to be true')
    }
  })

  it('is false for a null firstAired', () => {
    expect(airedEpisode({ firstAired: null })).toBe(false)
  })
})
