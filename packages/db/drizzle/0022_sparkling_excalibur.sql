CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"cover_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- One Default watchlist per existing user — same role
-- apps/api/src/lib/watchlists.ts's ensureDefaultWatchlist() gives every new
-- user going forward. "Default" here is the real, permanent list name shown
-- in the UI, not a placeholder.
INSERT INTO "watchlists" ("user_id", "name", "is_default")
SELECT "id", 'Default', true FROM "users";
--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_name_idx" ON "watchlists" USING btree ("user_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_default_idx" ON "watchlists" USING btree ("user_id") WHERE "watchlists"."is_default";
--> statement-breakpoint
-- Hand-edited from here down: drizzle-kit generated a plain NOT NULL
-- ADD COLUMN, which fails outright against existing watchlist_items rows.
-- Same add-nullable -> backfill -> SET NOT NULL shape as
-- 0004_same_iron_patriot.sql's slug backfill.
ALTER TABLE "watchlist_items" ADD COLUMN "watchlist_id" uuid;
--> statement-breakpoint
UPDATE "watchlist_items" wi
SET "watchlist_id" = w."id"
FROM "watchlists" w
WHERE w."user_id" = wi."user_id" AND w."is_default";
--> statement-breakpoint
ALTER TABLE "watchlist_items" ALTER COLUMN "watchlist_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_cover_item_id_watchlist_items_id_fk" FOREIGN KEY ("cover_item_id") REFERENCES "public"."watchlist_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "watchlist_items_user_entity_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_watchlist_entity_idx" ON "watchlist_items" USING btree ("watchlist_id","entity_type","entity_id");
