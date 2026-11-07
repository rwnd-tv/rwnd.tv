import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  episodes,
  externalIds,
  movies,
  pendingWebhookEvents,
  plays,
  shows,
  webhookAccountLinks,
} from '@rwnd/db'
import { createLocalUser, json, resetDb, testDb } from './helpers.js'
import {
  createLinkedTokenAndCookie,
  createTokenAndCookie,
  fakeTmdb,
  fakeTvdbWithEpisodeRedirect,
  postMultipartWebhook,
} from './webhook-fixtures.js'
import { createApp } from '../app.js'
import type { MetadataProvider } from '../providers/types.js'

const db = testDb()

/** Reproduces a real collision: TVDB id 411857 belongs to "1990" S1E1 as an
 * episode, and TMDB's cross-reference data also lists it as the series id of
 * the unrelated show "Sisbro". TMDB's `/find` reports the episode's show. */
function fakeTmdbWithEpisodeIdCollision(): MetadataProvider {
  const titles: Record<string, { title: string; year: number; episode: string }> = {
    '13380': { title: '1990', year: 1977, episode: 'Creed of Slaves' },
    '138346': { title: 'Sisbro', year: 2021, episode: 'Episode 1' },
  }
  return {
    ...fakeTmdb(),
    async getShow(externalId) {
      const show = titles[externalId]
      if (!show) throw new Error(`No show with id ${externalId}`)
      return {
        externalId,
        title: show.title,
        year: show.year,
        overview: null,
        posterPath: null,
        status: null,
        genres: [],
        voteAverage: null,
        seasons: [],
        imdbId: null,
      }
    },
    async getSeason(externalId) {
      const show = titles[externalId]
      if (!show) throw new Error(`No show with id ${externalId}`)
      return {
        overview: null,
        voteAverage: null,
        externalId: null,
        episodes: [
          {
            title: show.episode,
            seasonNumber: 1,
            episodeNumber: 1,
            runtimeMinutes: 50,
            firstAired: '2000-01-01',
            overview: null,
            stillPath: null,
            voteAverage: null,
            externalId: null,
            imdbId: null,
          },
        ],
      }
    },
    async findByExternalId(_entityType, source, externalId) {
      return source === 'tvdb' && externalId === '411857' ? '13380' : null
    },
  }
}

function plexEpisodeEvent(showTitle: string, guids: string[]) {
  return {
    event: 'media.scrobble',
    Account: DEFAULT_ACCOUNT,
    Metadata: {
      type: 'episode',
      ratingKey: '7001',
      grandparentTitle: showTitle,
      parentIndex: 1,
      index: 1,
      Guid: guids.map((id) => ({ id })),
    },
  }
}

async function loggedShowTitles() {
  const rows = await db
    .select({ title: shows.title })
    .from(plays)
    .innerJoin(episodes, eq(plays.episodeId, episodes.id))
    .innerJoin(shows, eq(episodes.showId, shows.id))
  return rows.map((row) => row.title)
}

/** Account id "1" carries no special meaning any more — Plex's own docs
 * claim it's always the server owner, but that doesn't hold for real
 * payloads (see `resolveWebhookAccount`'s doc comment), so every
 * account, including this one, starts unlinked like any other. Tests
 * that aren't specifically exercising the unlinked/link flow use
 * `createLinkedTokenAndCookie` instead, which pre-links it. */
const DEFAULT_ACCOUNT = { id: 1, title: 'james' }

function plexMoviePayload(account: Record<string, unknown> = DEFAULT_ACCOUNT) {
  return {
    event: 'media.scrobble',
    Account: account,
    Metadata: { type: 'movie', ratingKey: '5001', Guid: [{ id: 'tmdb://603' }] },
  }
}

function plexEpisodePayload(account: Record<string, unknown> = DEFAULT_ACCOUNT) {
  return {
    event: 'media.scrobble',
    Account: account,
    Metadata: {
      type: 'episode',
      ratingKey: '5002',
      grandparentTitle: 'Breaking Bad',
      parentIndex: 1,
      index: 1,
      Guid: [{ id: 'tmdb://1396' }],
    },
  }
}

function postWebhook(app: ReturnType<typeof createApp>, token: string, payload: unknown) {
  return postMultipartWebhook(app, 'plex', token, 'payload', payload)
}

describe('POST /webhooks/plex/:token', () => {
  beforeEach(() => resetDb(db))

  it('rejects a missing or invalid token', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const res = await postWebhook(app, 'not-a-real-token', plexMoviePayload())
    expect(res.status).toBe(401)
  })

  it('logs a movie watch end to end for an already-linked account', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('plex')
  })

  it('logs an episode watch end to end, resolving the show then the episode', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, plexEpisodePayload())
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Breaking Bad'))
    expect(show).toBeDefined()
  })

  it("replaces an existing 'import' play for the same movie with a live Plex webhook (origin outranks import)", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app)
    const meRes = await app.request('/api/v1/auth/me', { headers: { cookie } })
    const { id: userId } = await json<{ id: string }>(meRes)

    // First delivery resolves and creates the movie locally, then is
    // deleted — isolates the cross-source check from the webhook's own
    // sourceRef-based idempotency, which would otherwise mask it.
    await postWebhook(app, token, plexMoviePayload())
    const [movie] = await db.select().from(movies).where(eq(movies.title, 'The Matrix')).limit(1)
    await db.delete(plays).where(eq(plays.userId, userId))

    // Simulates Trakt's own separate Plex scrobbling already having
    // logged this same real watch via a Trakt import, same day.
    await db.insert(plays).values({
      userId,
      movieId: movie!.id,
      watchedAt: new Date(),
      source: 'import',
      sourceRef: 'trakt-history-item-1',
    })

    const res = await postWebhook(app, token, plexMoviePayload())
    expect(res.status).toBe(200)

    // Origin sources always win over import (apps/api/src/lib/plays.ts's
    // reconcilePlayDuplicates) — the live webhook is direct evidence of
    // the watch, so it replaces the relayed import row rather than
    // deferring to it.
    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)
    expect(history[0]?.source).toBe('plex')
  })

  it('resolves a show whose own native id actually identifies one of its episodes (TVDB id-space collision regression)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTvdbWithEpisodeRedirect()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32915',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 66,
        Guid: [{ id: 'tvdb://11569546' }],
      },
    })
    expect(res.status).toBe(200)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: Array<{ source: string }> }>(historyRes)
    expect(history).toHaveLength(1)

    const [show] = await db.select().from(shows).where(eq(shows.title, 'Formula 1'))
    expect(show).toBeDefined()
  })

  it('does not log an episode against a stored show whose series id equals the episode id', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdbWithEpisodeIdCollision()] })
    const { token } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexEpisodeEvent('Sisbro', ['tmdb://138346']))
    const [sisbro] = await db.select().from(shows).where(eq(shows.title, 'Sisbro'))
    await db
      .insert(externalIds)
      .values({ entityType: 'show', entityId: sisbro!.id, source: 'tvdb', externalId: '411857' })

    const res = await postWebhook(
      app,
      token,
      plexEpisodeEvent('1990', ['tmdb://498066', 'tvdb://411857']),
    )
    expect(res.status).toBe(200)

    expect((await loggedShowTitles()).sort()).toEqual(['1990', 'Sisbro'])
  })

  it("does not record an episode event's ids as ids of the show", async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdbWithEpisodeIdCollision()] })
    const { token } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexEpisodeEvent('1990', ['tmdb://498066', 'tvdb://411857']))

    expect(await loggedShowTitles()).toEqual(['1990'])
    const showIds = await db
      .select({ source: externalIds.source, externalId: externalIds.externalId })
      .from(externalIds)
      .where(eq(externalIds.entityType, 'show'))
    expect(showIds).toEqual([{ source: 'tmdb', externalId: '13380' }])
  })

  it('still logs against the stored show when the media server titles it differently, given an id that corroborates it', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdbWithEpisodeIdCollision()] })
    const { token } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexEpisodeEvent('1990', ['tvdb://411857']))
    await postWebhook(app, token, plexEpisodeEvent('Nineteen Ninety', ['tvdb://411857']))

    expect(await db.select().from(shows)).toHaveLength(1)
    expect(await loggedShowTitles()).toEqual(['1990'])
  })

  it('ignores a trailing qualifier when comparing titles', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexEpisodeEvent('Breaking Bad (2008)', ['tmdb://1396']))

    expect(await loggedShowTitles()).toEqual(['Breaking Bad'])
  })

  it('prefers a cross-referenced id over an episode tmdb id that is also a real show', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdbWithEpisodeIdCollision()] })
    const { token } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexEpisodeEvent('1990', ['tmdb://138346', 'tvdb://411857']))

    expect(await loggedShowTitles()).toEqual(['1990'])
    expect(await db.select().from(shows).where(eq(shows.title, 'Sisbro'))).toHaveLength(0)
  })

  it('logs nothing rather than guess when a lone id names a show with a different title', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdbWithEpisodeIdCollision()] })
    const { token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, plexEpisodeEvent('1990', ['tmdb://138346']))
    expect(res.status).toBe(200)

    expect(await loggedShowTitles()).toEqual([])
    expect(await db.select().from(shows)).toHaveLength(0)
  })

  it('does not create a duplicate show when a later event redirects to an id already known under its own', async () => {
    const app = createApp({ db, metadataProviders: [fakeTvdbWithEpisodeRedirect()] })
    const { cookie, token } = await createLinkedTokenAndCookie(app)

    // First delivery resolves the show via its own real id (no redirect
    // needed) — same as an ordinary earlier watch.
    const first = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32914',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 65,
        Guid: [{ id: 'tvdb://387219' }],
      },
    })
    expect(first.status).toBe(200)

    // Second delivery, a different episode, arrives with an id that
    // redirects to the *same* show (387219) — before the fix, resolveShow
    // couldn't tell this was already-known and created a second "Formula
    // 1" show with the wrong (uncorrected) external id, live-verified
    // 2026-08-24.
    const second = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '32915',
        grandparentTitle: 'Formula 1',
        parentIndex: 2026,
        index: 66,
        Guid: [{ id: 'tvdb://11569546' }],
      },
    })
    expect(second.status).toBe(200)

    const formula1Shows = await db.select().from(shows).where(eq(shows.title, 'Formula 1'))
    expect(formula1Shows).toHaveLength(1)

    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(2)
  })

  it('is idempotent — the same scrobble delivered twice logs one play, not two', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, cookie } = await createLinkedTokenAndCookie(app)

    await postWebhook(app, token, plexMoviePayload())
    await postWebhook(app, token, plexMoviePayload())

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(1)
    const historyRes = await app.request('/api/v1/plays', { headers: { cookie } })
    const { plays: history } = await json<{ plays: unknown[] }>(historyRes)
    expect(history).toHaveLength(1)
  })

  it('200s without logging anything when no configured provider recognizes the title', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: { type: 'movie', ratingKey: '9999', Guid: [{ id: 'tmdb://404404' }] },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('200s as a no-op for a non-scrobble event', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.play',
      Metadata: { type: 'movie', ratingKey: '5001', Guid: [{ id: 'tmdb://603' }] },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)
  })

  it('200s without logging anything for an episode not found in the resolved season', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token } = await createLinkedTokenAndCookie(app)

    const res = await postWebhook(app, token, {
      event: 'media.scrobble',
      Account: DEFAULT_ACCOUNT,
      Metadata: {
        type: 'episode',
        ratingKey: '5003',
        grandparentTitle: 'Breaking Bad',
        parentIndex: 1,
        index: 99,
        Guid: [{ id: 'tmdb://1396' }],
      },
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(episodes)
    expect(rows).toHaveLength(1) // the season's one real episode, resolved; no phantom row for #99
  })
})

describe('POST /webhooks/plex/:token — multi-user attribution', () => {
  beforeEach(() => resetDb(db))

  const MANAGED_ACCOUNT = { id: 2, title: 'kid-profile' }

  it('account id 1 is not auto-linked — regression guard for the flawed "owner is always 1" assumption', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload(DEFAULT_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.externalAccountId).toBe('1')
    expect(link?.userId).toBeNull()
  })

  it('creates an unlinked link and a pending event, logging nothing, for an account seen for the first time', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const [link] = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(link?.externalAccountId).toBe('2')
    expect(link?.externalAccountName).toBe('kid-profile')
    expect(link?.userId).toBeNull()

    const [pending] = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending?.externalAccountId).toBe('2')
    expect(pending?.event.media).toEqual({ type: 'movie' })
    expect(pending?.event.ids).toEqual({ tmdb: '603' })
  })

  it('still logs nothing on a second event from the same still-unlinked account (no duplicate link row, one more pending event)', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)

    await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select().from(plays)
    expect(rows).toHaveLength(0)

    const links = await db
      .select()
      .from(webhookAccountLinks)
      .where(eq(webhookAccountLinks.tokenId, tokenId))
    expect(links).toHaveLength(1)

    const pending = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.tokenId, tokenId))
    expect(pending).toHaveLength(2)
  })

  it('logs against the linked user, with their own locale, once linked', async () => {
    const app = createApp({ db, metadataProviders: [fakeTmdb()] })
    const { token, tokenId } = await createTokenAndCookie(app)
    const managedUserId = await createLocalUser(
      db,
      'managed@example.com',
      'correct-horse-battery-staple',
    )

    // First event discovers the account, unlinked.
    await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    // Simulates the Settings UI's link action (the link route's own
    // replay behavior is covered in tokens.test.ts).
    await db
      .update(webhookAccountLinks)
      .set({ userId: managedUserId })
      .where(eq(webhookAccountLinks.tokenId, tokenId))

    const res = await postWebhook(app, token, plexMoviePayload(MANAGED_ACCOUNT))
    expect(res.status).toBe(200)

    const rows = await db.select({ userId: plays.userId }).from(plays)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.userId).toBe(managedUserId)
  })
})
