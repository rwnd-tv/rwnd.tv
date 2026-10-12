import { describe, expect, it } from 'vitest'
import { providerRef } from './provider-ref.js'

describe('providerRef', () => {
  it("prefers the id of the provider the page's metadata came from", () => {
    expect(providerRef({ tmdbId: '1', tvdbId: '2', metadataSource: 'tvdb' })).toEqual({
      source: 'tvdb',
      externalId: '2',
    })
    expect(providerRef({ tmdbId: '1', tvdbId: '2', metadataSource: 'tmdb' })).toEqual({
      source: 'tmdb',
      externalId: '1',
    })
  })

  it('falls back to a TVDB id when there is no TMDB id (regression: Formula 1)', () => {
    expect(providerRef({ tmdbId: null, tvdbId: '387219', metadataSource: 'tmdb' })).toEqual({
      source: 'tvdb',
      externalId: '387219',
    })
    expect(providerRef({ tmdbId: null, tvdbId: '387219', metadataSource: null })).toEqual({
      source: 'tvdb',
      externalId: '387219',
    })
  })

  it('returns null only when there is no provider id at all', () => {
    expect(providerRef({ tmdbId: null, tvdbId: null, metadataSource: 'tvdb' })).toBeNull()
  })
})
