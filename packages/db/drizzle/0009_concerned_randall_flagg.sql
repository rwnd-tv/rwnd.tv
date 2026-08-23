ALTER TABLE "movies" ADD COLUMN "slug" text;--> statement-breakpoint
WITH base AS (
	SELECT
		id,
		regexp_replace(
			regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'),
			'(^-+|-+$)', '', 'g'
		) || COALESCE('-' || year::text, '') AS base_slug
	FROM "movies"
), numbered AS (
	SELECT id, base_slug, row_number() OVER (PARTITION BY base_slug ORDER BY id) AS rn
	FROM base
)
UPDATE "movies"
SET "slug" = CASE WHEN numbered.rn = 1 THEN numbered.base_slug ELSE numbered.base_slug || '-' || numbered.rn::text END
FROM numbered
WHERE "movies"."id" = numbered.id;--> statement-breakpoint
ALTER TABLE "movies" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "movies_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "genres" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "vote_average" real;
