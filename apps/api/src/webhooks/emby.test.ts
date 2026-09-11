import { describe, expect, it } from 'vitest'
import { parseEmbyPayload } from './emby.js'

function stopPayload(itemOverrides: Record<string, unknown> = {}, event = 'playback.stop') {
  return {
    Event: event,
    User: { Id: 'user-1', Name: 'root' },
    Item: {
      Type: 'Movie',
      Id: '12',
      ProviderIds: { Tmdb: '11176', Imdb: 'tt0079588', Tvdb: '5790' },
      ...itemOverrides,
    },
    PlaybackInfo: { PlayedToCompletion: true },
  }
}

describe('parseEmbyPayload', () => {
  it('parses a completed movie playback stop', () => {
    const event = parseEmbyPayload(stopPayload())
    expect(event).toEqual({
      ids: { tmdb: '11176', imdb: 'tt0079588', tvdb: '5790' },
      ratingKey: '12',
      account: { externalId: 'user-1', name: 'root' },
      media: { type: 'movie' },
    })
  })

  it('parses a completed episode playback stop', () => {
    const event = parseEmbyPayload(
      stopPayload({
        Type: 'Episode',
        Id: 'ep-1',
        SeriesName: 'Severance',
        ParentIndexNumber: 1,
        IndexNumber: 1,
        // Real-world casing is inconsistent between content types
        // (live-verified 2026-09-11) — an episode had no `Tmdb` key at
        // all, an all-caps `IMDB`, and an unrelated `Official Website`
        // key that must be ignored.
        ProviderIds: { Tvdb: '8891221', IMDB: 'tt11650328', 'Official Website': 'https://x' },
      }),
    )
    expect(event).toEqual({
      ids: { tvdb: '8891221', imdb: 'tt11650328' },
      ratingKey: 'ep-1',
      account: { externalId: 'user-1', name: 'root' },
      media: { type: 'episode', showTitle: 'Severance', seasonNumber: 1, episodeNumber: 1 },
    })
  })

  it('parses a second (non-owner) user', () => {
    const payload = stopPayload()
    payload.User = { Id: 'user-2', Name: 'kid-profile' }
    expect(parseEmbyPayload(payload)?.account).toEqual({
      externalId: 'user-2',
      name: 'kid-profile',
    })
  })

  it('lowercases all-caps ProviderIds keys the same as capitalized-first ones', () => {
    const event = parseEmbyPayload(
      stopPayload({ ProviderIds: { TMDB: '603', TVDB: '81189', imdb: 'tt0133093' } }),
    )
    expect(event?.ids).toEqual({ tmdb: '603', tvdb: '81189', imdb: 'tt0133093' })
  })

  it('ignores playback.start', () => {
    expect(parseEmbyPayload(stopPayload({}, 'playback.start'))).toBeNull()
  })

  it('ignores playback.pause and playback.unpause', () => {
    expect(parseEmbyPayload(stopPayload({}, 'playback.pause'))).toBeNull()
    expect(parseEmbyPayload(stopPayload({}, 'playback.unpause'))).toBeNull()
  })

  it("ignores the plugin's own system.webhooktest payload", () => {
    expect(
      parseEmbyPayload({
        Title: 'Test Notification',
        Event: 'system.webhooktest',
        User: { Name: 'root', Id: 'user-1' },
        Server: { Name: 'test', Id: 'srv-1' },
      }),
    ).toBeNull()
  })

  it('ignores a playback.stop that did not complete', () => {
    const payload = stopPayload()
    payload.PlaybackInfo = { PlayedToCompletion: false }
    expect(parseEmbyPayload(payload)).toBeNull()
  })

  it('returns null (and logs a diagnostic) when PlaybackInfo has no PlayedToCompletion field', () => {
    const payload: Record<string, unknown> = stopPayload()
    delete payload.PlaybackInfo
    expect(parseEmbyPayload(payload)).toBeNull()
  })

  it('returns null when no provider id is present at all', () => {
    const event = parseEmbyPayload(
      stopPayload({ ProviderIds: { 'Official Website': 'https://x' } }),
    )
    expect(event).toBeNull()
  })

  it('returns null for an episode missing season/episode numbers', () => {
    expect(parseEmbyPayload(stopPayload({ Type: 'Episode', SeriesName: 'Severance' }))).toBeNull()
  })

  it('returns null when Item.Id is missing', () => {
    expect(parseEmbyPayload(stopPayload({ Id: undefined }))).toBeNull()
  })

  it('returns null for an unsupported item type', () => {
    expect(parseEmbyPayload(stopPayload({ Type: 'Series' }))).toBeNull()
    expect(parseEmbyPayload(stopPayload({ Type: 'Audio' }))).toBeNull()
  })

  it('returns null when User is missing entirely', () => {
    const payload: Record<string, unknown> = stopPayload()
    delete payload.User
    expect(parseEmbyPayload(payload)).toBeNull()
  })

  it('returns null when Item is missing entirely', () => {
    const payload: Record<string, unknown> = stopPayload()
    delete payload.Item
    expect(parseEmbyPayload(payload)).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(parseEmbyPayload(null)).toBeNull()
    expect(parseEmbyPayload('not json')).toBeNull()
    expect(parseEmbyPayload(undefined)).toBeNull()
  })
})
