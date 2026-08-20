ALTER TABLE "shows" ADD COLUMN "slug" text;--> statement-breakpoint
WITH base AS (
	SELECT
		id,
		regexp_replace(
			regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'),
			'(^-+|-+$)', '', 'g'
		) || COALESCE('-' || year::text, '') AS base_slug
	FROM "shows"
), numbered AS (
	SELECT id, base_slug, row_number() OVER (PARTITION BY base_slug ORDER BY id) AS rn
	FROM base
)
UPDATE "shows"
SET "slug" = CASE WHEN numbered.rn = 1 THEN numbered.base_slug ELSE numbered.base_slug || '-' || numbered.rn::text END
FROM numbered
WHERE "shows"."id" = numbered.id;--> statement-breakpoint
ALTER TABLE "shows" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_slug_unique" UNIQUE("slug");
