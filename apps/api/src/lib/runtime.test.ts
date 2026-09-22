import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EPISODE_RUNTIME_MINUTES,
  DEFAULT_MOVIE_RUNTIME_MINUTES,
  runtimeForRow,
} from './runtime.js'

describe('runtimeForRow', () => {
  it("prefers a movie row's own runtime", () => {
    const row = { movieRuntimeMinutes: 142, episodeRuntimeMinutes: null, showId: null }
    expect(runtimeForRow(row, new Map())).toBe(142)
  })

  it('falls back to the flat movie default when a movie has no runtime', () => {
    const row = { movieRuntimeMinutes: null, episodeRuntimeMinutes: null, showId: null }
    expect(runtimeForRow(row, new Map())).toBe(DEFAULT_MOVIE_RUNTIME_MINUTES)
  })

  it("prefers an episode row's own runtime", () => {
    const row = { movieRuntimeMinutes: null, episodeRuntimeMinutes: 42, showId: 'show-1' }
    expect(runtimeForRow(row, new Map([['show-1', 25]]))).toBe(42)
  })

  it('falls back to the show median when an episode has no runtime', () => {
    const row = { movieRuntimeMinutes: null, episodeRuntimeMinutes: null, showId: 'show-1' }
    expect(runtimeForRow(row, new Map([['show-1', 25]]))).toBe(25)
  })

  it('falls back to the flat episode default when neither the episode nor its show median is known', () => {
    const row = { movieRuntimeMinutes: null, episodeRuntimeMinutes: null, showId: 'show-1' }
    expect(runtimeForRow(row, new Map())).toBe(DEFAULT_EPISODE_RUNTIME_MINUTES)
  })
})
