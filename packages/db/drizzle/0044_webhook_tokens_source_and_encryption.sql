ALTER TABLE "api_tokens" ADD COLUMN "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "source" "webhook_source";--> statement-breakpoint
-- Backfill: an existing token has no stored source of its own, but most
-- have already received at least one real webhook delivery, which does
-- say which source it's for (webhook_account_links.source). Picks each
-- token's most-recently-seen source, not just any — a token could in
-- principle have delivered from more than one (see apiTokens.source's own
-- doc comment, schema.ts). A token that's never received a delivery yet
-- stays null; there's no evidence to backfill from, and Settings lets it
-- be set once via PATCH /tokens/{id}. Hand-written — drizzle-kit only
-- generates the column additions above.
UPDATE "api_tokens" t
SET "source" = sub.source
FROM (
  SELECT DISTINCT ON (token_id) token_id, source
  FROM "webhook_account_links"
  ORDER BY token_id, last_seen_at DESC
) sub
WHERE t.id = sub.token_id AND t.source IS NULL;