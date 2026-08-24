import { eq } from 'drizzle-orm'
import type { Database } from '@rwnd/db'
import { apiTokens } from '@rwnd/db'
import { hashSecret } from './tokens.js'

/**
 * Resolves a long-lived API token (`apps/api/src/routes/tokens.ts`) to
 * the token's own id — the webhook-ingestion counterpart of
 * `session.ts`'s `resolveSession`. Unlike a session, no expiry: API
 * tokens are meant to sit in a Plex/Tautulli/etc. config indefinitely
 * until explicitly revoked. Updates `lastUsedAt` on every successful
 * resolve (nowhere else in the app writes this column — `routes/
 * tokens.ts` only ever reads it for display).
 *
 * Deliberately doesn't resolve the token's *owner* — a webhook request
 * doesn't necessarily belong to them at all, since the media server the
 * token's webhook is registered against can have several of its own
 * users (see `apps/api/src/lib/webhook-accounts.ts`'s
 * `resolveWebhookAccount`, which is what actually determines the
 * rwnd.tv user for a given event, from `tokenId` plus the event's own
 * external account).
 */
export async function resolveApiToken(
  db: Database,
  token: string,
): Promise<{ tokenId: string } | null> {
  const tokenHash = hashSecret(token)
  const [row] = await db
    .select({ tokenId: apiTokens.id })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, tokenHash))
    .limit(1)

  if (!row) return null
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId))
  return { tokenId: row.tokenId }
}
