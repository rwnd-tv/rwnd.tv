import { describe, expect, it } from 'vitest'
import { parsePlexPayload } from './plex.js'

function scrobblePayload(metadata: Record<string, unknown>, account?: Record<string, unknown>) {
  return {
    event: 'media.scrobble',
    Account: account ?? { id: 1, title: 'james' },
    Metadata: metadata,
  }
}

describe('parsePlexPayload', () => {
  it('parses a movie scrobble', () => {
    const event = parsePlexPayload(
      scrobblePayload({
        type: 'movie',
        ratingKey: '12345',
        Guid: [{ id: 'tmdb://603' }, { id: 'imdb://tt0133093' }],
      }),
    )
    expect(event).toEqual({
      ids: { tmdb: '603', imdb: 'tt0133093' },
      ratingKey: '12345',
      account: { externalId: '1', name: 'james' },
      media: { type: 'movie' },
    })
  })

  it('parses an episode scrobble', () => {
    const event = parsePlexPayload(
      scrobblePayload({
        type: 'episode',
        ratingKey: '67890',
        grandparentTitle: 'Breaking Bad',
        parentIndex: 1,
        index: 3,
        Guid: [{ id: 'tvdb://81189' }],
      }),
    )
    expect(event).toEqual({
      ids: { tvdb: '81189' },
      ratingKey: '67890',
      account: { externalId: '1', name: 'james' },
      media: { type: 'episode', showTitle: 'Breaking Bad', seasonNumber: 1, episodeNumber: 3 },
    })
  })

  it('parses a managed user account (a non-owner id)', () => {
    const event = parsePlexPayload(
      scrobblePayload(
        { type: 'movie', ratingKey: '1', Guid: [{ id: 'tmdb://603' }] },
        { id: 2, title: 'kid-profile' },
      ),
    )
    expect(event?.account).toEqual({ externalId: '2', name: 'kid-profile' })
  })

  it('ignores a non-scrobble event', () => {
    const event = parsePlexPayload({
      event: 'media.play',
      Account: { id: 1, title: 'james' },
      Metadata: { type: 'movie', ratingKey: '1', Guid: [{ id: 'tmdb://603' }] },
    })
    expect(event).toBeNull()
  })

  it('returns null when Account is missing entirely', () => {
    const event = parsePlexPayload({
      event: 'media.scrobble',
      Metadata: { type: 'movie', ratingKey: '1', Guid: [{ id: 'tmdb://603' }] },
    })
    expect(event).toBeNull()
  })

  it('returns null when Account has no usable id or title', () => {
    const event = parsePlexPayload(
      scrobblePayload(
        { type: 'movie', ratingKey: '1', Guid: [{ id: 'tmdb://603' }] },
        { title: 'james' },
      ),
    )
    expect(event).toBeNull()
  })

  it('returns null for a scrobble with no Guid array at all (older Plex agent)', () => {
    const event = parsePlexPayload(
      scrobblePayload({ type: 'movie', ratingKey: '1', title: 'Some Movie' }),
    )
    expect(event).toBeNull()
  })

  it('returns null for a scrobble whose Guid entries carry no recognized scheme', () => {
    const event = parsePlexPayload(
      scrobblePayload({
        type: 'movie',
        ratingKey: '1',
        Guid: [{ id: 'agent://something-plex-internal' }],
      }),
    )
    expect(event).toBeNull()
  })

  it('returns null for an episode missing season/episode numbers', () => {
    const event = parsePlexPayload(
      scrobblePayload({
        type: 'episode',
        ratingKey: '1',
        grandparentTitle: 'Breaking Bad',
        Guid: [{ id: 'tvdb://81189' }],
      }),
    )
    expect(event).toBeNull()
  })

  it('returns null for a scrobble missing ratingKey', () => {
    const event = parsePlexPayload(scrobblePayload({ type: 'movie', Guid: [{ id: 'tmdb://603' }] }))
    expect(event).toBeNull()
  })

  it('returns null for an unrecognized media type', () => {
    const event = parsePlexPayload(
      scrobblePayload({ type: 'track', ratingKey: '1', Guid: [{ id: 'tmdb://603' }] }),
    )
    expect(event).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(parsePlexPayload(null)).toBeNull()
    expect(parsePlexPayload('not json')).toBeNull()
    expect(parsePlexPayload(undefined)).toBeNull()
  })

  it('returns null when Metadata is missing', () => {
    expect(
      parsePlexPayload({ event: 'media.scrobble', Account: { id: 1, title: 'james' } }),
    ).toBeNull()
  })
})
