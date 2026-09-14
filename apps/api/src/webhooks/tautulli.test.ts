import { describe, expect, it } from 'vitest'
import { parseTautulliPayload } from './tautulli.js'

// Field values here are drawn from real captured Tautulli deliveries
// (2026-09-14, an ephemeral instance pointed read-only at a real Plex
// server — see docs/TODO_ARCHIVE.md), not invented.
function watchedMoviePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'watched',
    media_type: 'movie',
    show_name: '',
    season_num: '0',
    episode_num: '0',
    imdb_id: '',
    themoviedb_id: '62',
    thetvdb_id: '',
    rating_key: '24139',
    user_id: '274494',
    user: 'jamesbulman',
    username: 'jamesbulman',
    server_machine_id: '932dc209d6cb670070dd44e997cfae83102d5793',
    ...overrides,
  }
}

function watchedEpisodePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'watched',
    media_type: 'episode',
    show_name: '1990',
    season_num: '1',
    episode_num: '1',
    imdb_id: 'tt0075469',
    themoviedb_id: '13380',
    thetvdb_id: '83913',
    rating_key: '19105',
    user_id: '274494',
    user: 'jamesbulman',
    username: 'jamesbulman',
    server_machine_id: '932dc209d6cb670070dd44e997cfae83102d5793',
    ...overrides,
  }
}

describe('parseTautulliPayload', () => {
  it('parses a watched movie', () => {
    const event = parseTautulliPayload(watchedMoviePayload())
    expect(event).toEqual({
      ids: { tmdb: '62' },
      ratingKey: '24139',
      serverId: '932dc209d6cb670070dd44e997cfae83102d5793',
      account: { externalId: '274494', name: 'jamesbulman' },
      media: { type: 'movie' },
    })
  })

  it('parses a watched episode', () => {
    const event = parseTautulliPayload(watchedEpisodePayload())
    expect(event).toEqual({
      ids: { tmdb: '13380', tvdb: '83913', imdb: 'tt0075469' },
      ratingKey: '19105',
      serverId: '932dc209d6cb670070dd44e997cfae83102d5793',
      account: {
        externalId: '274494',
        name: 'jamesbulman',
      },
      media: { type: 'episode', showTitle: '1990', seasonNumber: 1, episodeNumber: 1 },
    })
  })

  it('parses season 0 (a real TV special) as a genuine value, not absent', () => {
    const event = parseTautulliPayload(watchedEpisodePayload({ season_num: '0' }))
    expect(event?.media).toEqual({
      type: 'episode',
      showTitle: '1990',
      seasonNumber: 0,
      episodeNumber: 1,
    })
  })

  it('falls back from a blank {user} friendly name to {username}', () => {
    const event = parseTautulliPayload(watchedMoviePayload({ user: '', username: 'jbulman' }))
    expect(event?.account.name).toBe('jbulman')
  })

  it('treats an unsubstituted literal token as absent, not as its own id/name', () => {
    const event = parseTautulliPayload(
      watchedMoviePayload({ imdb_id: '{imdb_id}', thetvdb_id: '{thetvdb_id}' }),
    )
    // themoviedb_id ('62') is still a real substituted value, so the event
    // still has a usable id overall — only the two literal tokens are
    // stripped, not the whole event.
    expect(event?.ids).toEqual({ tmdb: '62' })
  })

  it('ignores an event whose action is not "watched" (e.g. the template pasted into the wrong trigger)', () => {
    expect(parseTautulliPayload(watchedMoviePayload({ action: 'play' }))).toBeNull()
    expect(parseTautulliPayload(watchedMoviePayload({ action: 'stop' }))).toBeNull()
    expect(parseTautulliPayload(watchedMoviePayload({ action: '{action}' }))).toBeNull()
  })

  it('returns null when the account id or name is missing entirely', () => {
    expect(
      parseTautulliPayload(watchedMoviePayload({ user_id: '', user: '', username: '' })),
    ).toBeNull()
    expect(parseTautulliPayload(watchedMoviePayload({ user_id: '' }))).toBeNull()
  })

  it('returns null when rating_key is missing', () => {
    expect(parseTautulliPayload(watchedMoviePayload({ rating_key: '' }))).toBeNull()
  })

  it('returns null (and logs a diagnostic) when no usable external id is present at all', () => {
    expect(
      parseTautulliPayload(watchedMoviePayload({ imdb_id: '', themoviedb_id: '', thetvdb_id: '' })),
    ).toBeNull()
  })

  it('returns null for an episode missing season/episode numbers', () => {
    expect(
      parseTautulliPayload(
        watchedEpisodePayload({ season_num: '{season_num}', episode_num: '{episode_num}' }),
      ),
    ).toBeNull()
  })

  it('returns null for an unrecognized media type', () => {
    expect(parseTautulliPayload(watchedMoviePayload({ media_type: 'track' }))).toBeNull()
    expect(parseTautulliPayload(watchedMoviePayload({ media_type: 'clip' }))).toBeNull()
  })

  it('has no serverId when server_machine_id is unsubstituted or absent', () => {
    expect(
      parseTautulliPayload(watchedMoviePayload({ server_machine_id: '{server_machine_id}' }))
        ?.serverId,
    ).toBeNull()
    const { server_machine_id: _unused, ...withoutServerId } = watchedMoviePayload()
    expect(parseTautulliPayload(withoutServerId)?.serverId).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(parseTautulliPayload(null)).toBeNull()
    expect(parseTautulliPayload('not json')).toBeNull()
    expect(parseTautulliPayload(undefined)).toBeNull()
  })

  it('returns null for an empty object (e.g. a malformed custom body)', () => {
    expect(parseTautulliPayload({})).toBeNull()
  })
})
