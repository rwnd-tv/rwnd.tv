import { describe, expect, it } from 'vitest'
import { apiPath } from './api-path.js'

describe('apiPath', () => {
  it("leaves the template's own / separators alone while encoding each value", () => {
    expect(apiPath`/tv/${'1396'}/season/${1}/episode/${1}`).toBe('/tv/1396/season/1/episode/1')
  })

  it('encodes a legitimate numeric id to itself, so existing fixtures still match', () => {
    expect(apiPath`/movie/${'603'}`).toBe('/movie/603')
    expect(apiPath`/find/${'tt0133093'}`).toBe('/find/tt0133093')
  })

  it('encodes /, ?, # and .. so an injected id can never leave its own segment', () => {
    expect(apiPath`/movie/${'603/../../tv/1396'}`).toBe('/movie/603%2F..%2F..%2Ftv%2F1396')
    expect(apiPath`/tv/${'1396?append_to_response=account_states'}`).toBe(
      '/tv/1396%3Fappend_to_response%3Daccount_states',
    )
    expect(apiPath`/tv/${'1396#fragment'}`).toBe('/tv/1396%23fragment')
  })
})
