import { describe, expect, it } from 'vitest'
import { redactUrl } from './redact-url.js'

describe('redactUrl', () => {
  it('redacts api_key', () => {
    const result = redactUrl(
      'https://api.themoviedb.org/3/movie/603?api_key=secret123&language=en-GB',
    )
    expect(result).not.toContain('secret123')
    expect(result).toContain('api_key=%5Bredacted%5D')
    expect(result).toContain('language=en-GB')
  })

  it('redacts token and key params too', () => {
    const result = redactUrl('https://example.com/?token=abc&key=def&other=fine')
    expect(result).not.toContain('abc')
    expect(result).not.toContain('def')
    expect(result).toContain('other=fine')
  })

  it('leaves a URL with no sensitive params untouched', () => {
    const result = redactUrl('https://example.com/path?foo=bar')
    expect(result).toBe('https://example.com/path?foo=bar')
  })

  it('accepts a URL object, not just a string', () => {
    const result = redactUrl(new URL('https://example.com/?api_key=secret'))
    expect(result).not.toContain('secret')
  })

  it('falls back to the raw input for something that is not a valid URL, rather than throwing', () => {
    expect(redactUrl('not a url at all')).toBe('not a url at all')
  })
})
