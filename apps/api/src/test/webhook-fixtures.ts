import { webhookAccountLinks } from '@rwnd/db'
import type { CreateApiTokenResponse, WebhookSource } from '@rwnd/shared'
import { extractCookie, json, testDb } from './helpers.js'
import type { createApp } from '../app.js'
import type { MetadataProvider } from '../providers/types.js'

const db = testDb()

async function createUserAndCookie(
  app: ReturnType<typeof createApp>,
  email = 'watcher@example.com',
) {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', displayName: 'W' }),
  })
  return extractCookie(res)!
}

export function fakeTmdb(): MetadataProvider {
  return {
    source: 'tmdb',
    async searchMulti() {
      return []
    },
    async getMovie(externalId) {
      if (externalId !== '603') throw new Error(`Unexpected movie lookup: ${externalId}`)
      return {
        externalId,
        title: 'The Matrix',
        year: 1999,
        runtimeMinutes: 136,
        overview: null,
        posterPath: null,
        genres: [],
        voteAverage: null,
        imdbId: null,
        releaseDate: null,
        releaseDates: null,
      }
    },
    async getShow(externalId) {
      if (externalId !== '1396') throw new Error(`Unexpected show lookup: ${externalId}`)
      return {
        externalId,
        title: 'Breaking Bad',
        year: 2008,
        overview: null,
        posterPath: null,
        status: null,
        genres: [],
        voteAverage: null,
        seasons: [],
        imdbId: null,
      }
    },
    async getEpisode() {
      throw new Error('Not used — webhook episode resolution goes through getSeason')
    },
    async getSeason(externalId, seasonNumber) {
      if (externalId !== '1396' || seasonNumber !== 1) {
        throw new Error(`Unexpected season lookup: ${externalId} season ${seasonNumber}`)
      }
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: [
          {
            title: 'Pilot',
            seasonNumber: 1,
            episodeNumber: 1,
            runtimeMinutes: 58,
            firstAired: '2008-01-20',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
            imdbId: null,
          },
        ],
      }
    },
    async findByExternalId() {
      return null
    },
  }
}

/** Simulates TvdbProvider.getShow's own episode-id fallback (see tvdb.ts):
 * externalId '11569546' actually identifies an episode, not the show
 * itself, so getShow redirects and returns the real show under a
 * *different* externalId ('387219') — live-verified 2026-08-24 via a real
 * Plex webhook for an F1 qualifying session. getSeason asserts it's called
 * with the corrected id, not the original one the webhook carried — the
 * regression this guards against (resolveShow forwarding the wrong id to
 * every downstream episode/season lookup). */
export function fakeTvdbWithEpisodeRedirect(): MetadataProvider {
  return {
    source: 'tvdb',
    async searchMulti() {
      return []
    },
    async getMovie() {
      throw new Error('Not used')
    },
    async getShow(externalId) {
      // '387219' is the show's own real id (no redirect needed) — accepted
      // too so a test can first resolve the show normally, then separately
      // exercise the episode-id-redirect path against an *already-known*
      // show (see webhooks.test.ts's "does not create a duplicate show"
      // test).
      if (externalId !== '11569546' && externalId !== '387219') {
        throw new Error(`Unexpected show lookup: ${externalId}`)
      }
      return {
        externalId: '387219',
        title: 'Formula 1',
        year: 2018,
        overview: null,
        posterPath: null,
        status: null,
        genres: [],
        voteAverage: null,
        seasons: [],
        imdbId: null,
      }
    },
    async getEpisode() {
      throw new Error('Not used — webhook episode resolution goes through getSeason')
    },
    async getSeason(externalId, seasonNumber) {
      if (externalId !== '387219' || seasonNumber !== 2026) {
        throw new Error(`Unexpected season lookup: ${externalId} season ${seasonNumber}`)
      }
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: [
          {
            title: 'Netherlands (Qualifying)',
            seasonNumber: 2026,
            episodeNumber: 66,
            runtimeMinutes: 60,
            firstAired: '2026-08-22',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
            imdbId: null,
          },
          {
            title: 'Netherlands (Practice)',
            seasonNumber: 2026,
            episodeNumber: 65,
            runtimeMinutes: 60,
            firstAired: '2026-08-21',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
            imdbId: null,
          },
        ],
      }
    },
    async findByExternalId() {
      return null
    },
  }
}

export async function createTokenAndCookie(app: ReturnType<typeof createApp>) {
  const cookie = await createUserAndCookie(app)
  const res = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'webhook token' }),
  })
  const { id: tokenId, token } = await json<CreateApiTokenResponse>(res)
  return { cookie, token, tokenId }
}

/** For tests about what happens *after* an account is already linked —
 * pre-seeds the link directly (bypassing the link route itself, which
 * has its own dedicated tests in tokens.test.ts) so these tests can focus
 * purely on webhook behavior. `externalAccountId`/`externalAccountName`
 * default to a Plex-shaped account; pass real values for a Jellyfin/Emby
 * fixture's own account shape. */
export async function createLinkedTokenAndCookie(
  app: ReturnType<typeof createApp>,
  source: WebhookSource = 'plex',
  externalAccountId = '1',
  externalAccountName = 'james',
) {
  const { cookie, token, tokenId } = await createTokenAndCookie(app)
  const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
  const { id: userId } = await json<{ id: string }>(meRes)
  await db.insert(webhookAccountLinks).values({
    tokenId,
    source,
    externalAccountId,
    externalAccountName,
    userId,
  })
  return { cookie, token, tokenId }
}

export async function postMultipartWebhook(
  app: ReturnType<typeof createApp>,
  source: WebhookSource,
  token: string,
  field: string,
  payload: unknown,
) {
  const form = new FormData()
  form.append(field, JSON.stringify(payload))
  return app.request(`/api/v1/webhooks/${source}/${token}`, { method: 'POST', body: form })
}

export async function postJsonWebhook(
  app: ReturnType<typeof createApp>,
  source: WebhookSource,
  token: string,
  payload: unknown,
) {
  return app.request(`/api/v1/webhooks/${source}/${token}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
