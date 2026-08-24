ALTER TABLE "movies" ADD COLUMN "metadata_source" "external_id_source";--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "metadata_source" "external_id_source";--> statement-breakpoint
-- Backfill: every existing row was in fact resolved via TMDB (the only
-- provider that has ever existed), so this is unambiguous, not a guess.
-- Hand-written — drizzle-kit only generates the column additions above.
UPDATE "movies" SET "metadata_source" = 'tmdb'
WHERE EXISTS (
  SELECT 1 FROM "external_ids" e
  WHERE e.entity_type = 'movie' AND e.entity_id = "movies"."id" AND e.source = 'tmdb'
);--> statement-breakpoint
UPDATE "shows" SET "metadata_source" = 'tmdb'
WHERE EXISTS (
  SELECT 1 FROM "external_ids" e
  WHERE e.entity_type = 'show' AND e.entity_id = "shows"."id" AND e.source = 'tmdb'
);