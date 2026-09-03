ALTER TABLE "invites" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
-- Every invite already marked used (`used_by IS NOT NULL`) is backfilled to
-- its own `created_at` -- the exact original redemption time was never
-- recorded, but the precise value doesn't matter for correctness (only
-- whether it's null), and this instance's own invite list never displays it
-- anyway (packages/shared/src/schemas/invites.ts). See invites' doc comment
-- in schema.ts for why this column exists.
UPDATE "invites" SET "used_at" = "created_at" WHERE "used_by" IS NOT NULL;