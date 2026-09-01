import { describe, expect, it } from 'vitest'
import { imdbTitleUrl } from './imdb.js'

describe('imdbTitleUrl', () => {
  it('builds a title URL with a trailing slash', () => {
    expect(imdbTitleUrl('tt0133093')).toBe('https://www.imdb.com/title/tt0133093/')
  })
})
