import { describe, expect, it } from 'vitest'
import { parseJellyfinPayload } from './jellyfin.js'

function stopPayload(overrides: Record<string, unknown> = {}) {
  return {
    NotificationType: 'PlaybackStop',
    ItemType: 'Movie',
    ItemId: 'abc123',
    Name: 'The Muppet Movie',
    PlayedToCompletion: true,
    UserId: 'user-1',
    NotificationUsername: 'root',
    Provider_tmdb: '11176',
    Provider_imdb: 'tt0079588',
    ...overrides,
  }
}

describe('parseJellyfinPayload', () => {
  it('parses a completed movie playback stop', () => {
    const event = parseJellyfinPayload(stopPayload())
    expect(event).toEqual({
      ids: { tmdb: '11176', imdb: 'tt0079588' },
      ratingKey: 'abc123',
      account: { externalId: 'user-1', name: 'root' },
      media: { type: 'movie' },
    })
  })

  it('parses a completed episode playback stop', () => {
    const event = parseJellyfinPayload(
      stopPayload({
        ItemType: 'Episode',
        ItemId: 'ep-1',
        SeriesName: 'Severance',
        SeasonNumber: 1,
        EpisodeNumber: 1,
        Provider_tmdb: undefined,
        Provider_tvdb: '8891221',
      }),
    )
    expect(event).toEqual({
      ids: { tvdb: '8891221', imdb: 'tt0079588' },
      ratingKey: 'ep-1',
      account: { externalId: 'user-1', name: 'root' },
      media: { type: 'episode', showTitle: 'Severance', seasonNumber: 1, episodeNumber: 1 },
    })
  })

  it('parses a second (non-owner) user', () => {
    const event = parseJellyfinPayload(
      stopPayload({ UserId: 'user-2', NotificationUsername: 'kid-profile' }),
    )
    expect(event?.account).toEqual({ externalId: 'user-2', name: 'kid-profile' })
  })

  it('accepts values as quoted strings, matching the documented Handlebars template', () => {
    const event = parseJellyfinPayload(stopPayload({ PlayedToCompletion: 'True' }))
    expect(event).not.toBeNull()
  })

  it('treats empty-string fields as absent, matching a template with no matching data', () => {
    const event = parseJellyfinPayload(stopPayload({ Provider_tmdb: '', Provider_imdb: '' }))
    expect(event).toBeNull()
  })

  it('ignores PlaybackStart', () => {
    expect(parseJellyfinPayload(stopPayload({ NotificationType: 'PlaybackStart' }))).toBeNull()
  })

  it('ignores PlaybackProgress', () => {
    expect(parseJellyfinPayload(stopPayload({ NotificationType: 'PlaybackProgress' }))).toBeNull()
  })

  it('ignores a PlaybackStop that did not complete', () => {
    expect(parseJellyfinPayload(stopPayload({ PlayedToCompletion: false }))).toBeNull()
  })

  it('returns null when no provider id is present at all', () => {
    expect(
      parseJellyfinPayload(stopPayload({ Provider_tmdb: undefined, Provider_imdb: undefined })),
    ).toBeNull()
  })

  it('returns null for an episode missing season/episode numbers', () => {
    expect(
      parseJellyfinPayload(
        stopPayload({ ItemType: 'Episode', SeriesName: 'Severance', Provider_tvdb: '1' }),
      ),
    ).toBeNull()
  })

  it('returns null when ItemId is missing', () => {
    expect(parseJellyfinPayload(stopPayload({ ItemId: undefined }))).toBeNull()
  })

  it('returns null for an unsupported item type', () => {
    expect(parseJellyfinPayload(stopPayload({ ItemType: 'Series' }))).toBeNull()
    expect(parseJellyfinPayload(stopPayload({ ItemType: 'Audio' }))).toBeNull()
  })

  it('returns null when the account is missing entirely', () => {
    expect(
      parseJellyfinPayload(stopPayload({ UserId: undefined, NotificationUsername: undefined })),
    ).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(parseJellyfinPayload(null)).toBeNull()
    expect(parseJellyfinPayload('not json')).toBeNull()
    expect(parseJellyfinPayload(undefined)).toBeNull()
  })
})
