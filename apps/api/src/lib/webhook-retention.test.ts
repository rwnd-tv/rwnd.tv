import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { apiTokens, pendingWebhookEvents } from '@rwnd/db'
import { createLocalUser, resetDb, testDb } from '../test/helpers.js'
import { pruneStalePendingWebhookEvents } from './webhook-retention.js'

const db = testDb()

async function createToken(): Promise<string> {
  const userId = await createLocalUser(db, 'watcher@example.com', 'correct-horse-battery-staple')
  const [token] = await db
    .insert(apiTokens)
    .values({ userId, name: 'test token', tokenHash: `hash-${crypto.randomUUID()}` })
    .returning()
  return token!.id
}

async function insertPendingEvent(tokenId: string, createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(pendingWebhookEvents)
    .values({
      tokenId,
      source: 'plex',
      externalAccountId: 'external-account-1',
      watchedAt: createdAt,
      event: { ids: {}, ratingKey: '1', media: { type: 'movie' } },
      createdAt,
    })
    .returning()
  return row!.id
}

describe('pruneStalePendingWebhookEvents', () => {
  beforeEach(() => resetDb(db))

  it('deletes an unlinked event older than the 90-day retention window', async () => {
    const tokenId = await createToken()
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)
    const eventId = await insertPendingEvent(tokenId, ninetyOneDaysAgo)

    const deletedCount = await pruneStalePendingWebhookEvents(db)
    expect(deletedCount).toBe(1)

    const remaining = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.id, eventId))
    expect(remaining).toHaveLength(0)
  })

  it('leaves a recent event untouched', async () => {
    const tokenId = await createToken()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const eventId = await insertPendingEvent(tokenId, yesterday)

    const deletedCount = await pruneStalePendingWebhookEvents(db)
    expect(deletedCount).toBe(0)

    const remaining = await db
      .select()
      .from(pendingWebhookEvents)
      .where(eq(pendingWebhookEvents.id, eventId))
    expect(remaining).toHaveLength(1)
  })
})
